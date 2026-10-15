// bg-remove.worker.ts — 背景削除推論を Web Worker に隔離
// Transformers.js v4 の background-removal パイプラインを使用
import { env, pipeline, RawImage } from '@huggingface/transformers';
import { modelAsset } from '../lib/model-assets/manifest.ts';
import { createPipelineLifecycle } from '../lib/model-assets/pipeline-lifecycle.ts';
import {
	createVerifiedModelFetch,
	fetchVerifiedAsset,
} from '../lib/model-assets/verified-fetch.ts';
import { ONNX_WASM_BASE_PATH } from '../lib/transcribe/model-manifest.ts';

// 同一originの固定資産のみ。内蔵キャッシュ/外部フォールバックを無効化。
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/bg-remove/';
env.useFS = false;
env.useFSCache = false;
env.useBrowserCache = false;
env.useCustomCache = false;
env.useWasmCache = false;
env.experimental_useCrossOriginStorage = false;
// --- モデルレジストリ ---
const MODELS = {
	fast: {
		assetName: 'modnet',
		id: `modnet/${modelAsset('modnet').revision}`,
		dtype: 'fp32' as const, // float32: ~25.9MB（高精度化）
	},
	high: {
		assetName: 'birefnet-lite-512',
		id: `birefnet-lite-512/${modelAsset('birefnet-lite-512').revision}`,
		dtype: 'fp16' as const, // fp16: 約98.5MB（10進）
	},
} as const;

// 旧版配信用BEN2は新Workerの取得許可に含めない。
const modelFiles = Object.values(MODELS).flatMap(
	(model) => modelAsset(model.assetName).files,
);
const cachePromise =
	typeof caches === 'undefined'
		? Promise.resolve(null)
		: caches.open('codelife-verified-bg-models-v1').catch(() => null);
let assetLoadError: string | null = null;
let loadingRequestId = '';
env.fetch = async (input, init) => {
	try {
		return await createVerifiedModelFetch(modelFiles, {
			origin: location.origin,
			cache: await cachePromise,
			onProgress: (loaded, total) =>
				self.postMessage({
					type: 'progress',
					id: loadingRequestId,
					payload: {
						status: 'progress',
						loaded,
						total,
						progress: (100 * loaded) / total,
					},
				}),
		})(input, init);
	} catch (error) {
		assetLoadError =
			error instanceof Error ? error.message : 'モデル資産を取得できません。';
		throw error;
	}
};
const wasmBackend = env.backends.onnx.wasm;
if (wasmBackend) {
	wasmBackend.numThreads = 1;
	wasmBackend.simd = true;
	wasmBackend.proxy = false;
	const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
	const base = isSafari
		? 'ort-wasm-simd-threaded'
		: 'ort-wasm-simd-threaded.asyncify';
	wasmBackend.wasmPaths = {
		mjs: `${ONNX_WASM_BASE_PATH}${base}.mjs`,
		wasm: `${ONNX_WASM_BASE_PATH}${base}.wasm`,
	};
}

// フェッチが中断された場合などのWorker内未処理拒否をサイレントに抑制
self.addEventListener('unhandledrejection', (event) => {
	event.preventDefault();
});

export type ModelMode = 'fast' | 'high';

// --- メッセージ型定義 ---
export interface WorkerRequest {
	id: string;
	mode: ModelMode;
	imageData?: ArrayBuffer;
	mimeType?: string;
	preloadOnly?: boolean;
}

export interface WorkerProgressMessage {
	type: 'progress';
	// どのリクエスト（id）に紐づく進捗かを示す。preload と本処理が並行しても
	// ラッパー側で自分宛て以外の進捗を無視できるようにするため必須。
	id: string;
	payload: {
		status: string;
		progress?: number;
		loaded?: number;
		total?: number;
		file?: string;
	};
}

export interface WorkerResultMessage {
	type: 'result';
	id: string;
	width: number;
	height: number;
	data: ArrayBuffer; // RGBA Uint8ClampedArray as transferable
}

export interface WorkerErrorMessage {
	type: 'error';
	id: string;
	message: string;
}

export interface WorkerReadyMessage {
	type: 'ready';
	id: string;
}

export type WorkerResponse =
	| WorkerProgressMessage
	| WorkerResultMessage
	| WorkerErrorMessage
	| WorkerReadyMessage;

// --- パイプライン管理 ---
async function loadPipeline(mode: ModelMode, id: string) {
	const model = MODELS[mode];
	assetLoadError = null;
	loadingRequestId = id;
	// 任意扱いの設定ファイルも先に検証し、ライブラリのoptional fallbackを許さない。
	const asset = modelAsset(model.assetName);
	for (const file of asset.files.filter((file) =>
		file.path.endsWith('.json'),
	)) {
		const response = await fetchVerifiedAsset(file, {
			origin: location.origin,
			cache: await cachePromise,
		});
		await response.body?.cancel();
	}

	// env.fetchが取得進捗を通知する。library側progress_callbackは指定せず、
	// 検証済みResponse.arrayBuffer()から同じbufferを受け取り再確保を避ける。
	// Worker 内は WebGPU 不安定を避け wasm 固定
	const createRemover = () =>
		pipeline('background-removal', model.id, {
			device: 'wasm',
			dtype: model.dtype,
		});
	let remover: Awaited<ReturnType<typeof createRemover>>;
	try {
		remover = await createRemover();
	} catch {
		throw new Error(assetLoadError ?? 'モデルの読み込みに失敗しました。');
	}
	if (assetLoadError) {
		await remover.dispose();
		throw new Error(assetLoadError);
	}
	return remover;
}

const lifecycle = createPipelineLifecycle(loadPipeline);

// --- メッセージハンドラ ---
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
	const { id, mode, imageData, mimeType, preloadOnly } = e.data;

	try {
		await lifecycle.run(mode, id, async (pipe) => {
			// キャッシュ済みの場合は progress_callback が発火しないため、
			// 毎回 'ready' を送って UI の loading→processing 遷移を保証する
			self.postMessage({
				type: 'progress',
				id,
				payload: { status: 'ready' },
			} satisfies WorkerProgressMessage);

			// preload のみ: パイプライン初期化だけして終了
			if (preloadOnly) {
				self.postMessage({ type: 'ready', id } satisfies WorkerReadyMessage);
				return;
			}

			if (!imageData) {
				throw new Error('画像データが指定されていません');
			}

			// 入力画像はローカルBlobからRawImageへ変換する
			const blob = new Blob([imageData], {
				type: mimeType ?? 'application/octet-stream',
			});
			const image = await RawImage.fromBlob(blob);

			{
				// background-removal パイプラインは RawImage (RGBA) を返す
				const output = await pipe(image);

				// RawImage から RGBA ピクセルデータを取得
				const { width, height, data } = output;

				// ArrayBuffer として transferable 送信
				const buffer = (data as Uint8ClampedArray).buffer.slice(
					0,
				) as ArrayBuffer;

				self.postMessage(
					{
						type: 'result',
						id,
						width,
						height,
						data: buffer,
					} satisfies WorkerResultMessage,
					{ transfer: [buffer] },
				);
			}
		});
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		self.postMessage({
			type: 'error',
			id,
			message,
		} satisfies WorkerErrorMessage);
	}
};
