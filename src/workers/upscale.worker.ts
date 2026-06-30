// upscale.worker.ts — 画像アップスケール推論を Web Worker に隔離
// onnxruntime-web（Real-ESRGAN ONNX）を遅延ロードし、OffscreenCanvas でタイル分割推論・結合を行う。
// メインスレッドは Blob 入出力のみで UI を固めない。

import {
	computeOutputDimensions,
	MODELS,
	type ProgressInfo,
	planTiles,
	type QualityMode,
	type UpscaleOptions,
	validateResolution,
} from '../lib/tools/upscale-core';

// onnxruntime-web の wasm 配信元（package.json の pin と同期させること）。
// bg-remove と同様 cdn.jsdelivr.net を使用（CSP script-src/connect-src で許可済み）。
const ORT_VERSION = '1.27.0';
const ORT_WASM_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

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
let ortPromise: Promise<Ort> | null = null;

function loadOrt(): Promise<Ort> {
	if (!ortPromise) {
		ortPromise = import('onnxruntime-web/wasm').then((ort: Ort) => {
			ort.env.wasm.wasmPaths = ORT_WASM_BASE;
			ort.env.wasm.numThreads = 1; // SharedArrayBuffer 不要（COOP/COEP 変更なし）
			ort.env.wasm.simd = true;
			ort.env.wasm.proxy = false;
			return ort;
		});
	}
	return ortPromise;
}

// --- セッションキャッシュ ---
type SessionEntry = { session: Ort; ort: Ort; quality: QualityMode };
const sessions = new Map<QualityMode, SessionEntry>();

async function fetchModel(
	url: string,
	onProgress: (p: number) => void,
): Promise<ArrayBuffer> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`モデルの取得に失敗しました（${res.status}）`);
	}
	const total = Number(res.headers.get('content-length') ?? 0);
	if (!res.body || !total) {
		return res.arrayBuffer();
	}
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			received += value.length;
			onProgress(Math.min(1, received / total));
		}
	}
	const out = new Uint8Array(received);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out.buffer;
}

async function getSession(
	quality: QualityMode,
	onProgress: (p: ProgressInfo) => void,
): Promise<SessionEntry> {
	const cached = sessions.get(quality);
	if (cached) return cached;

	const ort = await loadOrt();
	const spec = MODELS[quality];
	onProgress({ status: 'loading', progress: 0 });
	const modelBuf = await fetchModel(spec.url, (p) =>
		onProgress({ status: 'loading', progress: p }),
	);
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
