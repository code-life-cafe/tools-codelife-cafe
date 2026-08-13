// upscale-core.ts — 画像アップスケールの純粋ロジック（DOM 非依存）
// メインスレッド（UI）と Web Worker の双方から import される。
// 検証・寸法・タイル分割・ファイル名・モデル定義など、推論を伴わない処理を集約する。

import { BYTES_PER_MB, FILE_SIZE_LIMITS_MB } from '../constants.ts';

// --- 定数 ---
export const SUPPORTED_INPUT_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
] as const;

/** 入力ファイルサイズ上限: 20MB */
export const MAX_FILE_SIZE = FILE_SIZE_LIMITS_MB.UPSCALE * BYTES_PER_MB;

/** 入力解像度の長辺上限。これを超えると出力が巨大化・処理が非現実的になるため拒否する。 */
export const MAX_INPUT_EDGE = 2000;

// --- 型 ---
export type Scale = 2 | 4;

/**
 * 品質モード。
 * - fast: realesr-general-x4v3（軽量 SRVGGNetCompact）。WASM で全端末実用的。
 * - max : RealESRGAN_x4plus（RRDBNet）。最高品質だが重く、WebGPU 利用時のみ実用的。
 */
export type QualityMode = 'fast' | 'max';

export type OutputFormat = 'png' | 'webp';

export type UpscaleOptions = {
	scale: Scale;
	denoise: boolean;
	output: OutputFormat;
	quality: QualityMode;
};

export type ImageInputValidation =
	| { ok: true; format: 'png' | 'jpeg' | 'webp' }
	| {
			ok: false;
			reason: 'unsupported-type' | 'too-large' | 'resolution-too-high';
			message: string;
	  };

/** 推論モデルの定義 */
export type ModelSpec = {
	/** モデル ONNX の取得 URL（self ホスト or HF CDN。CSP connect-src で許可済み） */
	url: string;
	/** モデルが拡大する倍率（両モデルとも x4 ネイティブ） */
	nativeScale: 4;
	/** タイルの中核サイズ（出力結合の単位） */
	core: number;
	/** タイル周囲に付与する重なり（境界アーティファクト低減） */
	overlap: number;
	/** 入力サイズが core 固定か（true の場合は端を core までパディングする） */
	fixed: boolean;
	/** 推奨実行デバイス */
	device: 'wasm' | 'webgpu';
};

// --- モデルレジストリ ---
// fast は public/models 同梱（~5MB, BSD-3-Clause）。max は HF CDN から取得（~67MB, WebGPU 推奨）。
export const MODELS: Record<QualityMode, ModelSpec> = {
	fast: {
		url: '/models/realesr-general-x4v3.onnx',
		nativeScale: 4,
		core: 224,
		overlap: 16,
		fixed: false,
		device: 'wasm',
	},
	max: {
		url: 'https://huggingface.co/bukuroo/RealESRGAN-ONNX/resolve/main/real-esrgan-x4plus-128.onnx',
		nativeScale: 4,
		core: 128,
		overlap: 0,
		fixed: true,
		device: 'webgpu',
	},
};

export type ProgressInfo = {
	status: 'loading' | 'processing' | 'ready';
	/** 0–1 */
	progress: number;
	/** タイル進捗 */
	tile?: { done: number; total: number };
};

// --- 純粋関数 ---

function extToFormat(type: string): 'png' | 'jpeg' | 'webp' | null {
	switch (type) {
		case 'image/png':
			return 'png';
		case 'image/jpeg':
			return 'jpeg';
		case 'image/webp':
			return 'webp';
		default:
			return null;
	}
}

/** 入力ファイルの形式・サイズを検証する（解像度はデコード後に validateResolution が担う）。 */
export function validateImageFile(file: {
	type: string;
	size: number;
}): ImageInputValidation {
	const format = extToFormat(file.type);
	if (!format) {
		return {
			ok: false,
			reason: 'unsupported-type',
			message:
				'対応していない形式です。PNG / JPEG / WebP 画像を選択してください。',
		};
	}
	if (file.size > MAX_FILE_SIZE) {
		return {
			ok: false,
			reason: 'too-large',
			message: 'ファイルサイズが20MBを超えています。',
		};
	}
	return { ok: true, format };
}

/** デコード後の解像度が上限内かを検証する。 */
export function validateResolution(
	width: number,
	height: number,
): ImageInputValidation {
	if (Math.max(width, height) > MAX_INPUT_EDGE) {
		return {
			ok: false,
			reason: 'resolution-too-high',
			message: `入力画像が大きすぎます（長辺 ${MAX_INPUT_EDGE}px まで）。縮小してからお試しください。`,
		};
	}
	return { ok: true, format: 'png' };
}

/** 倍率を適用した出力寸法を返す。 */
export function computeOutputDimensions(
	width: number,
	height: number,
	scale: Scale,
): { width: number; height: number } {
	return {
		width: Math.round(width * scale),
		height: Math.round(height * scale),
	};
}

/** 出力ファイル名 `{base}_upscaled_{scale}x.{ext}` を生成する。 */
export function buildUpscaledFilename(
	originalName: string,
	scale: Scale,
	format: OutputFormat,
): string {
	const base = originalName.replace(/\.[^.]+$/, '') || 'image';
	return `${base}_upscaled_${scale}x.${format}`;
}

/** タイル1枚の読み取り領域（重なり込み）と、出力へ採用する中核領域（入力座標）。 */
export type Tile = {
	/** 読み取り領域（モデル入力。重なりを含む。fixed モデルでは別途 core までパディング） */
	sx: number;
	sy: number;
	sw: number;
	sh: number;
	/** 採用する中核領域（重なりを除いた、出力に貼り付ける範囲） */
	kx: number;
	ky: number;
	kw: number;
	kh: number;
};

/**
 * 画像をタイルに分割する純粋関数。
 * 中核サイズ `core` で格子状に分割し、各タイルの読み取り領域に上下左右 `overlap` の
 * 重なりを付与する（画像端でクランプ）。出力結合時は中核領域 kx..kw のみを採用するため
 * 継ぎ目が出にくい。
 */
export function planTiles(
	width: number,
	height: number,
	core: number,
	overlap: number,
): Tile[] {
	const tiles: Tile[] = [];
	const step = Math.max(1, core);
	for (let ky = 0; ky < height; ky += step) {
		for (let kx = 0; kx < width; kx += step) {
			const kw = Math.min(step, width - kx);
			const kh = Math.min(step, height - ky);
			const sx = Math.max(0, kx - overlap);
			const sy = Math.max(0, ky - overlap);
			const sxEnd = Math.min(width, kx + kw + overlap);
			const syEnd = Math.min(height, ky + kh + overlap);
			tiles.push({
				sx,
				sy,
				sw: sxEnd - sx,
				sh: syEnd - sy,
				kx,
				ky,
				kw,
				kh,
			});
		}
	}
	return tiles;
}

/** WebGPU が利用可能かを判定する（max 品質モードの実用性判定に使用）。 */
export async function isWebGPUAvailable(): Promise<boolean> {
	try {
		// biome-ignore lint/suspicious/noExplicitAny: navigator.gpu may be absent from lib target
		const gpu = (globalThis.navigator as any)?.gpu;
		if (!gpu) return false;
		const adapter = await gpu.requestAdapter();
		return !!adapter;
	} catch {
		return false;
	}
}
