// bg-remove.worker.ts — 背景削除推論を Web Worker に隔離
// Transformers.js v4 の background-removal パイプラインを使用
import { env, pipeline } from '@huggingface/transformers';

// --- モデル配信設定 ---
// Cloudflare R2 (models.tools.codelife.cafe) からモデルを配信。
// ローカル開発時は HuggingFace CDN にフォールバック。
if (typeof location !== 'undefined' && location.hostname !== 'localhost') {
	env.remoteHost = 'https://models.tools.codelife.cafe';
}
env.allowLocalModels = false;
env.useBrowserCache = true;

// フェッチが中断された場合などのWorker内未処理拒否をサイレントに抑制
self.addEventListener('unhandledrejection', (event) => {
	event.preventDefault();
});

// --- モデルレジストリ ---
const MODELS = {
	fast: {
		id: 'onnx-community/modnet-webnn',
		dtype: 'fp32' as const, // float32: ~25.9MB（高精度化）
	},
	high: {
		id: 'onnx-community/BEN2-ONNX',
		dtype: 'fp16' as const, // fp16: ~209MB
	},
} as const;

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
// biome-ignore lint/suspicious/noExplicitAny: Transformers.js pipeline type is complex
let remover: any = null;
let currentMode: ModelMode | null = null;

async function ensurePipeline(mode: ModelMode) {
	if (remover && currentMode === mode) return remover;

	const model = MODELS[mode];

	// Worker 内は WebGPU 不安定を避け wasm 固定
	remover = await pipeline('background-removal', model.id, {
		device: 'wasm',
		dtype: model.dtype,
		progress_callback: (p: {
			status: string;
			progress?: number;
			loaded?: number;
			total?: number;
			file?: string;
		}) => {
			self.postMessage({
				type: 'progress',
				payload: p,
			} satisfies WorkerProgressMessage);
		},
	});

	currentMode = mode;
	return remover;
}

// --- メッセージハンドラ ---
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
	const { id, mode, imageData, mimeType, preloadOnly } = e.data;

	try {
		const pipe = await ensurePipeline(mode);

		// preload のみ: パイプライン初期化だけして終了
		if (preloadOnly) {
			self.postMessage({ type: 'ready', id } satisfies WorkerReadyMessage);
			return;
		}

		if (!imageData) {
			throw new Error('画像データが指定されていません');
		}

		// Blob → URL → pipeline に渡す
		const blob = new Blob([imageData], {
			type: mimeType ?? 'application/octet-stream',
		});
		const url = URL.createObjectURL(blob);

		try {
			// background-removal パイプラインは RawImage (RGBA) を返す
			const output = await pipe(url);

			// RawImage から RGBA ピクセルデータを取得
			const { width, height, data } = output;

			// ArrayBuffer として transferable 送信
			const buffer = (data as Uint8ClampedArray).buffer.slice(0) as ArrayBuffer;

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
		} finally {
			URL.revokeObjectURL(url);
		}
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		self.postMessage({
			type: 'error',
			id,
			message,
		} satisfies WorkerErrorMessage);
	}
};
