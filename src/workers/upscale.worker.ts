// upscale.worker.ts — 画像アップスケール推論を Web Worker に隔離
// onnxruntime-web（Real-ESRGAN ONNX）を遅延ロードし、OffscreenCanvas でタイル分割推論・結合を行う。
// メインスレッドは Blob 入出力のみで UI を固めない。

import { modelFile } from '../lib/model-assets/manifest.ts';
import { UPSCALE_WASM_BASE_PATH } from '../lib/model-assets/runtime-manifest.ts';
import { fetchVerifiedBytes } from '../lib/model-assets/verified-fetch.ts';
import {
	computeOutputDimensions,
	MODELS,
	type ProgressInfo,
	planTiles,
	type QualityMode,
	type UpscaleOptions,
	validateResolution,
} from '../lib/tools/upscale-core';

const modelCache =
	typeof caches === 'undefined'
		? Promise.resolve(null)
		: caches.open('codelife-verified-upscale-models-v1').catch(() => null);

// --- メッセージ型 ---
export interface UpscaleWorkerRequest {
	id: string;
	imageData: ArrayBuffer;
	mimeType: string;
	options: UpscaleOptions;
}

export interface UpscaleProgressMessage {
	type: 'progress';
	payload: ProgressInfo;
}

export interface UpscaleResultMessage {
	type: 'result';
	id: string;
	width: number;
	height: number;
	data: ArrayBuffer; // RGBA Uint8ClampedArray (transferable)
}

export interface UpscaleErrorMessage {
	type: 'error';
	id: string;
	message: string;
}

export type UpscaleWorkerResponse =
	| UpscaleProgressMessage
	| UpscaleResultMessage
	| UpscaleErrorMessage;

self.addEventListener('unhandledrejection', (event) => {
	event.preventDefault();
});

// --- onnxruntime-web 遅延ロード ---
// biome-ignore lint/suspicious/noExplicitAny: onnxruntime-web has no bundled types entry here
type Ort = any;
type OrtRuntime = 'wasm' | 'webgpu';
const ortPromises = new Map<OrtRuntime, Promise<Ort>>();

function configureOrt(ort: Ort): Ort {
	ort.env.wasm.wasmPaths = UPSCALE_WASM_BASE_PATH;
	ort.env.wasm.numThreads = 1; // SharedArrayBuffer 不要（COOP/COEP 変更なし）
	ort.env.wasm.simd = true;
	ort.env.wasm.proxy = false;
	return ort;
}

function loadOrt(runtime: OrtRuntime): Promise<Ort> {
	const cached = ortPromises.get(runtime);
	if (cached) return cached;

	const promise = (
		runtime === 'webgpu'
			? import('onnxruntime-web/webgpu')
			: import('onnxruntime-web/wasm')
	).then(configureOrt);
	ortPromises.set(runtime, promise);
	return promise;
}

// --- セッションキャッシュ ---
type SessionEntry = { session: Ort; ort: Ort; quality: QualityMode };
const sessions = new Map<QualityMode, SessionEntry>();

async function getSession(
	quality: QualityMode,
	onProgress: (p: ProgressInfo) => void,
): Promise<SessionEntry> {
	const cached = sessions.get(quality);
	if (cached) return cached;

	const spec = MODELS[quality];
	const ort = await loadOrt(spec.device);
	onProgress({ status: 'loading', progress: 0 });
	const asset =
		quality === 'fast'
			? modelFile('realesr-general-x4v3', 'realesr-general-x4v3.onnx')
			: modelFile('realesrgan-x4plus', 'real-esrgan-x4plus-128.onnx');
	const modelBuf = await fetchVerifiedBytes(asset, {
		origin: location.origin,
		cache: await modelCache,
		onProgress: (loaded, total) =>
			onProgress({ status: 'loading', progress: loaded / total }),
	});
	const providers = spec.device === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
	const session = await ort.InferenceSession.create(modelBuf, {
		executionProviders: providers,
		graphOptimizationLevel: 'all',
	});
	const entry: SessionEntry = { session, ort, quality };
	sessions.set(quality, entry);
	return entry;
}

// --- Canvas / テンソル ユーティリティ ---
function makeCanvas(w: number, h: number): OffscreenCanvas {
	return new OffscreenCanvas(w, h);
}

function ctx2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('Canvas 2D コンテキストの取得に失敗しました');
	return ctx;
}

/** ImageData(RGBA) → Float32 NCHW [0,1] */
function toNCHW(data: Uint8ClampedArray, w: number, h: number): Float32Array {
	const plane = w * h;
	const out = new Float32Array(3 * plane);
	for (let i = 0; i < plane; i++) {
		out[i] = data[i * 4] / 255;
		out[plane + i] = data[i * 4 + 1] / 255;
		out[2 * plane + i] = data[i * 4 + 2] / 255;
	}
	return out;
}

/** Float32 NCHW [0,1] → ImageData(RGBA) */
function fromNCHW(arr: ArrayLike<number>, w: number, h: number): ImageData {
	const plane = w * h;
	const out = new Uint8ClampedArray(plane * 4);
	for (let i = 0; i < plane; i++) {
		out[i * 4] = arr[i] * 255;
		out[i * 4 + 1] = arr[plane + i] * 255;
		out[i * 4 + 2] = arr[2 * plane + i] * 255;
		out[i * 4 + 3] = 255;
	}
	return new ImageData(out, w, h);
}

// --- メイン推論 ---
async function processImage(
	req: UpscaleWorkerRequest,
	onProgress: (p: ProgressInfo) => void,
): Promise<{ width: number; height: number; data: ArrayBuffer }> {
	const { options } = req;
	const { ort, session } = await getSession(options.quality, onProgress);
	const spec = MODELS[options.quality];

	// デコード
	const blob = new Blob([req.imageData], { type: req.mimeType });
	const bitmap = await createImageBitmap(blob);
	const inW = bitmap.width;
	const inH = bitmap.height;

	const resCheck = validateResolution(inW, inH);
	if (!resCheck.ok) {
		bitmap.close();
		throw new Error(resCheck.message);
	}

	// 入力ピクセル
	const srcCanvas = makeCanvas(inW, inH);
	const srcCtx = ctx2d(srcCanvas);
	srcCtx.drawImage(bitmap, 0, 0);
	bitmap.close();

	const nativeScale = spec.nativeScale;
	const outNativeW = inW * nativeScale;
	const outNativeH = inH * nativeScale;
	const outCanvas = makeCanvas(outNativeW, outNativeH);
	const outCtx = ctx2d(outCanvas);

	const inputName: string = session.inputNames[0];
	const outputName: string = session.outputNames[0];

	const tiles = planTiles(inW, inH, spec.core, spec.overlap);
	let done = 0;
	onProgress({
		status: 'processing',
		progress: 0,
		tile: { done, total: tiles.length },
	});

	for (const t of tiles) {
		// 読み取り領域を取得（fixed モデルは core までパディング）
		const readW = spec.fixed ? spec.core : t.sw;
		const readH = spec.fixed ? spec.core : t.sh;
		const tileCanvas = makeCanvas(readW, readH);
		const tCtx = ctx2d(tileCanvas);
		tCtx.drawImage(srcCanvas, t.sx, t.sy, t.sw, t.sh, 0, 0, t.sw, t.sh);
		const tileData = tCtx.getImageData(0, 0, readW, readH);

		// 推論
		const input = new ort.Tensor(
			'float32',
			toNCHW(tileData.data, readW, readH),
			[1, 3, readH, readW],
		);
		const feeds: Record<string, unknown> = {};
		feeds[inputName] = input;
		const result = await session.run(feeds);
		const output = result[outputName];
		const [, , oh, ow] = output.dims as number[];
		const outImage = fromNCHW(output.data as Float32Array, ow, oh);
		input.dispose?.();
		output.dispose?.();

		// 出力タイルを一旦 Canvas 化し、中核領域のみを outCanvas へ転写
		const tileOut = makeCanvas(ow, oh);
		ctx2d(tileOut).putImageData(outImage, 0, 0);
		const srcX = (t.kx - t.sx) * nativeScale;
		const srcY = (t.ky - t.sy) * nativeScale;
		const srcW = t.kw * nativeScale;
		const srcH = t.kh * nativeScale;
		outCtx.drawImage(
			tileOut,
			srcX,
			srcY,
			srcW,
			srcH,
			t.kx * nativeScale,
			t.ky * nativeScale,
			srcW,
			srcH,
		);

		done++;
		onProgress({
			status: 'processing',
			progress: done / tiles.length,
			tile: { done, total: tiles.length },
		});
	}

	// 目標倍率へ調整（ネイティブ x4 → 2x の場合は縮小）
	const target = computeOutputDimensions(inW, inH, options.scale);
	let finalCanvas: OffscreenCanvas = outCanvas;
	if (target.width !== outNativeW || target.height !== outNativeH) {
		const scaled = makeCanvas(target.width, target.height);
		const sCtx = ctx2d(scaled);
		sCtx.imageSmoothingEnabled = true;
		sCtx.imageSmoothingQuality = 'high';
		sCtx.drawImage(outCanvas, 0, 0, target.width, target.height);
		finalCanvas = scaled;
	}

	// ノイズ除去 OFF の場合は、元画像のバイキュービック拡大とブレンドして
	// テクスチャ（粒状感）をより保持する（モデル出力は強めに平滑化されるため）。
	if (!options.denoise) {
		const blendCtx = ctx2d(finalCanvas);
		blendCtx.globalAlpha = 0.3;
		blendCtx.imageSmoothingEnabled = true;
		blendCtx.imageSmoothingQuality = 'high';
		blendCtx.drawImage(srcCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
		blendCtx.globalAlpha = 1;
	}

	const finalCtx = ctx2d(finalCanvas);
	const finalImage = finalCtx.getImageData(
		0,
		0,
		finalCanvas.width,
		finalCanvas.height,
	);
	const buffer = finalImage.data.buffer.slice(0) as ArrayBuffer;
	return { width: finalCanvas.width, height: finalCanvas.height, data: buffer };
}

// --- メッセージハンドラ ---
self.onmessage = async (e: MessageEvent<UpscaleWorkerRequest>) => {
	const req = e.data;
	const post = (msg: UpscaleWorkerResponse, transfer?: Transferable[]) =>
		transfer ? self.postMessage(msg, { transfer }) : self.postMessage(msg);

	try {
		const { width, height, data } = await processImage(req, (payload) =>
			post({ type: 'progress', payload }),
		);
		post({ type: 'result', id: req.id, width, height, data }, [data]);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		post({ type: 'error', id: req.id, message });
	}
};
