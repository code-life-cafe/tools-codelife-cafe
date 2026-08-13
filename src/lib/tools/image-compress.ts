// image-compress.ts — 画像の圧縮・リサイズ・形式変換のコアロジック（純粋関数中心）
// 処理はすべてブラウザ内（Canvas API）で完結し、サーバーへの送信は行わない。
// 再エンコードにより EXIF・GPS 等のメタデータは自動的に除去される。
//
// canvas 依存の関数（compressImage / compressToTargetSize）はブラウザ専用。
// 寸法計算・品質二分探索・形式解決などの純粋ロジックは個別にエクスポートし unit test 対象とする。

import {
	BATCH_MAX_FILE_COUNT,
	BYTES_PER_MB,
	FILE_SIZE_LIMITS_MB,
} from '../constants.ts';

export type ResizeMode =
	| { type: 'none' }
	| { type: 'max-width'; value: number }
	| { type: 'max-height'; value: number }
	| { type: 'long-edge'; value: number }
	| { type: 'percent'; value: number };

export type CompressFormat = 'jpeg' | 'webp' | 'png' | 'keep';

export type CompressOptions = {
	format: CompressFormat;
	quality: number; // 0–1, jpeg/webp のみ有効
	resize: ResizeMode;
	background: string; // PNG透過→JPEG変換時の背景色（デフォルト '#ffffff'）
};

export type CompressWarning = 'target-not-reached' | 'format-fallback';

export type CompressResult = {
	blob: Blob;
	fileName: string; // {basename}_compressed.{ext}
	width: number;
	height: number;
	originalSize: number;
	compressedSize: number;
	warning?: CompressWarning;
};

export type ImageInputValidation =
	| { ok: true }
	| { ok: false; reason: ImageCompressErrorCode; message: string };

export type ImageCompressErrorCode =
	| 'unsupported-format'
	| 'too-large-file'
	| 'too-many-files';

// 対応形式は JPEG / PNG / WebP のみ（GIF / SVG は対象外）
export const SUPPORTED_INPUT_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
] as const;

export const MAX_FILE_SIZE = FILE_SIZE_LIMITS_MB.IMAGE_COMPRESS * BYTES_PER_MB; // 50MB/枚
export const MAX_FILE_COUNT = BATCH_MAX_FILE_COUNT; // 30枚/回
export const DEFAULT_QUALITY = 0.8;
export const DEFAULT_BACKGROUND = '#ffffff';
export const TARGET_MIN_QUALITY = 0.3;
export const TARGET_MAX_ITERATIONS = 8;

// ---------------------------------------------------------------------------
// 純粋ロジック（unit test 対象）
// ---------------------------------------------------------------------------

/** 1ファイルの形式・サイズを検証する（寸法はデコードが必要なため対象外） */
export function validateImageFile(
	file: Pick<File, 'type' | 'size'>,
): ImageInputValidation {
	if (!(SUPPORTED_INPUT_TYPES as readonly string[]).includes(file.type)) {
		return {
			ok: false,
			reason: 'unsupported-format',
			message:
				'対応していない形式です。JPEG / PNG / WebP 画像を選択してください（GIF・SVGは非対応）。',
		};
	}
	if (file.size > MAX_FILE_SIZE) {
		return {
			ok: false,
			reason: 'too-large-file',
			message: 'ファイルサイズが50MBを超えています。',
		};
	}
	return { ok: true };
}

/** 選択枚数の上限（30枚）を検証する */
export function validateFileCount(count: number): ImageInputValidation {
	if (count > MAX_FILE_COUNT) {
		return {
			ok: false,
			reason: 'too-many-files',
			message: `一度に処理できるのは${MAX_FILE_COUNT}枚までです。`,
		};
	}
	return { ok: true };
}

/**
 * リサイズ後の出力寸法を計算する（縦横比は常に維持・拡大はしない）。
 * percent は指定倍率をそのまま適用する。
 */
export function computeTargetDimensions(
	width: number,
	height: number,
	resize: ResizeMode,
): { width: number; height: number } {
	const scaled = (scale: number) => ({
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	});
	switch (resize.type) {
		case 'none':
			return { width, height };
		case 'max-width':
			return width <= resize.value
				? { width, height }
				: scaled(resize.value / width);
		case 'max-height':
			return height <= resize.value
				? { width, height }
				: scaled(resize.value / height);
		case 'long-edge': {
			const longEdge = Math.max(width, height);
			return longEdge <= resize.value
				? { width, height }
				: scaled(resize.value / longEdge);
		}
		case 'percent':
			return scaled(resize.value / 100);
	}
}

const EXT_BY_MIME: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
};

/** MIME タイプから出力拡張子を返す */
export function extensionForMime(mime: string): string {
	return EXT_BY_MIME[mime] ?? 'img';
}

/**
 * 出力形式（'keep' は入力形式を維持）から MIME と拡張子を解決する。
 * 未知の入力形式で 'keep' の場合は JPEG にフォールバックする。
 */
export function resolveOutputFormat(
	format: CompressFormat,
	inputType: string,
): { mime: string; ext: string } {
	let mime: string;
	if (format === 'keep') {
		mime = (SUPPORTED_INPUT_TYPES as readonly string[]).includes(inputType)
			? inputType
			: 'image/jpeg';
	} else if (format === 'jpeg') {
		mime = 'image/jpeg';
	} else if (format === 'webp') {
		mime = 'image/webp';
	} else {
		mime = 'image/png';
	}
	return { mime, ext: extensionForMime(mime) };
}

/** 出力ファイル名 `{basename}_compressed.{ext}` を作る */
export function buildCompressedFilename(
	originalName: string,
	ext: string,
): string {
	const base = originalName.replace(/\.[^.]+$/, '') || 'image';
	return `${base}_compressed.${ext}`;
}

/** JPEG 出力など透過非対応の形式かどうか（背景色での塗りつぶしが必要） */
export function needsBackgroundFill(mime: string): boolean {
	return mime === 'image/jpeg';
}

export interface EncodeProbe {
	blob: Blob;
	size: number;
}

/**
 * 目標バイト数以下に収まる最大品質を二分探索する（純粋・encode を注入）。
 * - まず下限品質を測定し、それでも超過する場合は下限結果を reached:false で返す
 * - 収まる場合は [minQuality, 1] を二分探索して最大品質を探す
 * - encode の総呼び出し回数は maxIterations 以下
 */
export async function searchQualityForTargetSize(
	encode: (quality: number) => Promise<EncodeProbe>,
	targetBytes: number,
	minQuality: number = TARGET_MIN_QUALITY,
	maxIterations: number = TARGET_MAX_ITERATIONS,
): Promise<{ probe: EncodeProbe; quality: number; reached: boolean }> {
	const floor = await encode(minQuality);
	if (floor.size > targetBytes) {
		return { probe: floor, quality: minQuality, reached: false };
	}

	let lo = minQuality;
	let hi = 1;
	let best = { probe: floor, quality: minQuality };
	// 下限測定で1回消費済みのため残りイテレーションで探索する
	for (let i = 0; i < maxIterations - 1; i++) {
		const mid = (lo + hi) / 2;
		const probe = await encode(mid);
		if (probe.size <= targetBytes) {
			best = { probe, quality: mid };
			lo = mid;
		} else {
			hi = mid;
		}
	}
	return { probe: best.probe, quality: best.quality, reached: true };
}

// ---------------------------------------------------------------------------
// canvas 依存（ブラウザ専用）
// ---------------------------------------------------------------------------

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function createCanvas(width: number, height: number): AnyCanvas {
	if (typeof OffscreenCanvas !== 'undefined') {
		return new OffscreenCanvas(width, height);
	}
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

function canvasToBlob(
	canvas: AnyCanvas,
	mime: string,
	quality: number,
): Promise<Blob | null> {
	if ('convertToBlob' in canvas) {
		return canvas.convertToBlob({ type: mime, quality }).catch(() => null);
	}
	return new Promise((resolve) => {
		canvas.toBlob((blob) => resolve(blob), mime, quality);
	});
}

/** ビットマップを目標寸法の canvas に描画する（透過非対応形式は背景色で塗る） */
function drawBitmap(
	bitmap: ImageBitmap,
	width: number,
	height: number,
	mime: string,
	background: string,
): AnyCanvas {
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d') as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!ctx) {
		throw new Error('Canvas 2D コンテキストの取得に失敗しました。');
	}
	ctx.imageSmoothingQuality = 'high';
	if (needsBackgroundFill(mime)) {
		ctx.fillStyle = background || DEFAULT_BACKGROUND;
		ctx.fillRect(0, 0, width, height);
	}
	ctx.drawImage(bitmap, 0, 0, width, height);
	return canvas;
}

/** source canvas を背景色で塗ったキャンバスに合成する（透過→JPEG変換時の黒化防止） */
function compositeOnBackground(
	source: AnyCanvas,
	background: string,
): AnyCanvas {
	const canvas = createCanvas(source.width, source.height);
	const ctx = canvas.getContext('2d') as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!ctx) {
		throw new Error('Canvas 2D コンテキストの取得に失敗しました。');
	}
	ctx.fillStyle = background || DEFAULT_BACKGROUND;
	ctx.fillRect(0, 0, source.width, source.height);
	ctx.drawImage(source as CanvasImageSource, 0, 0);
	return canvas;
}

/**
 * canvas を指定形式でエンコードする。WebP 非対応環境（toBlob が WebP を返さない）では
 * JPEG にフォールバックし 'format-fallback' 警告を返す。
 */
async function encodeCanvas(
	canvas: AnyCanvas,
	mime: string,
	quality: number,
	background: string,
): Promise<{ blob: Blob; mime: string; warning?: CompressWarning }> {
	const blob = await canvasToBlob(canvas, mime, quality);
	if (blob && blob.type === mime) {
		return { blob, mime };
	}
	// WebP 非対応（旧Safari等）: toBlob が null または別形式を返す → JPEG フォールバック。
	// WebP は透過対応のため drawBitmap で背景を塗っていない。JPEG は透過非対応のため、
	// ここで背景色に合成してから書き出して透過部分の黒化を防ぐ。
	if (mime === 'image/webp') {
		const composite = compositeOnBackground(canvas, background);
		const jpeg = await canvasToBlob(composite, 'image/jpeg', quality);
		if (jpeg) {
			return { blob: jpeg, mime: 'image/jpeg', warning: 'format-fallback' };
		}
	}
	if (blob) {
		return { blob, mime: blob.type || mime };
	}
	throw new Error(
		'画像の書き出しに失敗しました。ブラウザがこの形式に対応していない可能性があります。',
	);
}

async function decodeBitmap(file: File): Promise<ImageBitmap> {
	try {
		return await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		throw new Error(
			'画像のデコードに失敗しました。ファイルが破損しているか、ブラウザが対応していない形式です。',
		);
	}
}

/**
 * 画像を圧縮・リサイズ・形式変換する。
 * - quality は JPEG/WebP のみ有効（PNG では無視）
 * - PNG透過 → JPEG変換時は options.background で背景を塗る
 * - 再エンコードにより EXIF 等のメタデータは除去される
 */
export async function compressImage(
	file: File,
	options: CompressOptions,
): Promise<CompressResult> {
	const { mime } = resolveOutputFormat(options.format, file.type);
	const bitmap = await decodeBitmap(file);
	try {
		const { width, height } = computeTargetDimensions(
			bitmap.width,
			bitmap.height,
			options.resize,
		);
		const canvas = drawBitmap(bitmap, width, height, mime, options.background);
		const encoded = await encodeCanvas(
			canvas,
			mime,
			options.quality,
			options.background,
		);
		const ext = extensionForMime(encoded.mime);
		return {
			blob: encoded.blob,
			fileName: buildCompressedFilename(file.name, ext),
			width,
			height,
			originalSize: file.size,
			compressedSize: encoded.blob.size,
			warning: encoded.warning,
		};
	} finally {
		bitmap.close();
	}
}

/**
 * 目標ファイルサイズ（KB）以下になるよう quality を二分探索して圧縮する。
 * - quality 探索のみ（自動リサイズ・形式変更はしない）
 * - PNG 出力では目標サイズ指定は無効（compressImage と同等の動作にフォールバック）
 * - 下限品質でも目標を超える場合は最小結果を返し warning: 'target-not-reached'
 */
export async function compressToTargetSize(
	file: File,
	targetKB: number,
	options: CompressOptions,
): Promise<CompressResult> {
	const { mime } = resolveOutputFormat(options.format, file.type);
	// PNG はロスレスで quality 概念がないため目標サイズ探索を行わない
	if (mime === 'image/png') {
		return compressImage(file, options);
	}

	const targetBytes = Math.max(1, Math.round(targetKB * 1024));
	const bitmap = await decodeBitmap(file);
	try {
		const { width, height } = computeTargetDimensions(
			bitmap.width,
			bitmap.height,
			options.resize,
		);
		const canvas = drawBitmap(bitmap, width, height, mime, options.background);

		let resolvedMime = mime;
		let fallbackWarning: CompressWarning | undefined;
		const encode = async (quality: number): Promise<EncodeProbe> => {
			const encoded = await encodeCanvas(
				canvas,
				resolvedMime,
				quality,
				options.background,
			);
			resolvedMime = encoded.mime;
			if (encoded.warning === 'format-fallback')
				fallbackWarning = 'format-fallback';
			return { blob: encoded.blob, size: encoded.blob.size };
		};

		const { probe, reached } = await searchQualityForTargetSize(
			encode,
			targetBytes,
		);
		const ext = extensionForMime(resolvedMime);
		return {
			blob: probe.blob,
			fileName: buildCompressedFilename(file.name, ext),
			width,
			height,
			originalSize: file.size,
			compressedSize: probe.blob.size,
			warning: reached ? fallbackWarning : 'target-not-reached',
		};
	} finally {
		bitmap.close();
	}
}
