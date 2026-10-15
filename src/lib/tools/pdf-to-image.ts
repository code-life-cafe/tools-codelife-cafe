// pdf-to-image.ts — PDF→JPG/PNG 変換のコアロジック（DOM非依存）
// ページ範囲・形式・dpi・品質の検証、出力画素数の上限確認、連番ファイル名、
// 逐次変換（キャンセル・保持容量の上限つき）を担う。ページ描画は PageImageRenderer
// （src/lib/pdf/render.ts の PDF.js 実装）を注入して行う。

import {
	DPI_OPTIONS,
	type Dpi,
	isDpi,
	isJpegQuality,
	type JpegQuality,
	type PageSizePt,
	PdfToolError,
	type PixelSize,
	pixelSizeForPage,
	throwIfAborted,
	validatePageCount,
	validatePixelLimit,
} from '../pdf/common.ts';
import { parsePageRanges } from './pdf.ts';

export type ImageFormat = 'jpeg' | 'png';

export type PdfToImageSettings = {
	format: ImageFormat;
	dpi: Dpi;
	jpegQuality: JpegQuality;
};

export const DEFAULT_PDF_TO_IMAGE_SETTINGS: PdfToImageSettings = {
	format: 'jpeg',
	dpi: 144,
	jpegQuality: 85,
};

/**
 * 1回の変換で保持する画像の合計サイズ上限（200MiB）。超えた時点で変換を止め、
 * それまでの画像だけを返す（ブラウザのメモリ不足でタブが落ちるのを避ける）。
 */
export const MAX_RESULT_BYTES = 200 * 1024 * 1024;

function isImageFormat(value: unknown): value is ImageFormat {
	return value === 'jpeg' || value === 'png';
}

/** useToolSettings 用の検証関数。許可値のみ採用する（ページ範囲は入力のため保持しない） */
export function sanitizePdfToImageSettings(
	value: unknown,
	defaults: PdfToImageSettings,
): PdfToImageSettings {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return { ...defaults };
	}
	const v = value as Record<string, unknown>;
	return {
		format: isImageFormat(v.format) ? v.format : defaults.format,
		dpi: isDpi(v.dpi) ? v.dpi : defaults.dpi,
		jpegQuality: isJpegQuality(v.jpegQuality)
			? v.jpegQuality
			: defaults.jpegQuality,
	};
}

export function validateToImageSettings(
	settings: PdfToImageSettings,
): PdfToolError | null {
	if (!isImageFormat(settings.format)) {
		return new PdfToolError(
			'invalid-option',
			'出力形式はJPGまたはPNGから選択してください。',
		);
	}
	if (!isDpi(settings.dpi)) {
		return new PdfToolError(
			'invalid-option',
			`解像度は${DPI_OPTIONS.join(' / ')}dpiから選択してください。`,
		);
	}
	if (!isJpegQuality(settings.jpegQuality)) {
		return new PdfToolError(
			'invalid-option',
			'JPEG品質の指定が正しくありません。',
		);
	}
	return null;
}

export type PageSelection =
	| { ok: true; pages: number[] }
	| {
			ok: false;
			errors: Array<{ token: string; index: number; message: string }>;
	  };

/**
 * 「1-3,5,8-」形式のページ指定を、重複を除いた昇順のページ番号へ変換する。
 * 書式・範囲の検証は PDF分割と同じ parsePageRanges に従う。
 */
export function resolvePageSelection(
	input: string,
	pageCount: number,
): PageSelection {
	const parsed = parsePageRanges(input, pageCount);
	if (!parsed.ok) return { ok: false, errors: parsed.errors };
	const pages = [...new Set(parsed.ranges.flat())].sort((a, b) => a - b);
	return { ok: true, pages };
}

/** 全ページを表すページ指定（例: 1-12） */
export function allPagesInput(pageCount: number): string {
	return pageCount <= 1 ? '1' : `1-${pageCount}`;
}

/** 連番ファイル名（元ファイル名_p001.jpg）。桁数は総ページ数に合わせて0埋めする */
export function imageFileName(
	baseName: string,
	pageNumber: number,
	pageCount: number,
	format: ImageFormat,
): string {
	const digits = Math.max(2, String(pageCount).length);
	const ext = format === 'png' ? 'png' : 'jpg';
	return `${baseName}_p${String(pageNumber).padStart(digits, '0')}.${ext}`;
}

/** ページ画像を描画する実装（PDF.js + canvas）。テストでは差し替える */
export interface PageImageRenderer {
	readonly pageCount: number;
	/** 表示上の寸法（回転適用後、pt） */
	getPageSize(pageNumber: number): Promise<PageSizePt>;
	/** JPEG は白背景、PNG は透過背景で描画した画像 */
	renderImage(
		pageNumber: number,
		size: PixelSize,
		format: ImageFormat,
		quality: number,
		signal?: AbortSignal,
	): Promise<Blob>;
}

export type PageImage = {
	pageNumber: number;
	fileName: string;
	blob: Blob;
	width: number;
	height: number;
};

export type ConvertResult = {
	images: PageImage[];
	/** 保持容量の上限で途中停止した場合、変換しなかった最初のページ番号 */
	stoppedBeforePage: number | null;
};

export type ConvertOptions = {
	signal?: AbortSignal;
	onProgress?: (done: number, total: number) => void;
	/** 上限の差し替え（テスト用） */
	maxResultBytes?: number;
};

/**
 * 選択ページを1枚ずつ描画して画像にする。描画前に全選択ページの画素数上限を確認する。
 * 保持する画像の合計が上限を超えたら、その画像を破棄して停止する。
 */
export async function convertPdfPages(
	renderer: PageImageRenderer,
	pages: readonly number[],
	settings: PdfToImageSettings,
	baseName: string,
	options: ConvertOptions = {},
): Promise<ConvertResult> {
	const { signal, onProgress } = options;
	const maxResultBytes = options.maxResultBytes ?? MAX_RESULT_BYTES;
	const settingsError = validateToImageSettings(settings);
	if (settingsError) throw settingsError;
	const pageCountError = validatePageCount(renderer.pageCount);
	if (pageCountError) throw pageCountError;
	if (pages.length === 0) {
		throw new PdfToolError(
			'invalid-option',
			'ページを1つ以上指定してください。',
		);
	}
	const outOfRange = pages.find(
		(p) => !Number.isInteger(p) || p < 1 || p > renderer.pageCount,
	);
	if (outOfRange !== undefined) {
		throw new PdfToolError(
			'invalid-option',
			`ページ番号 ${outOfRange} は範囲外です（全${renderer.pageCount}ページ）。`,
		);
	}

	const sizes: Array<{ pageNumber: number; size: PageSizePt }> = [];
	for (const pageNumber of pages) {
		throwIfAborted(signal);
		sizes.push({ pageNumber, size: await renderer.getPageSize(pageNumber) });
	}
	const pixelError = validatePixelLimit(sizes, settings.dpi);
	if (pixelError) throw pixelError;

	const images: PageImage[] = [];
	let heldBytes = 0;
	onProgress?.(0, sizes.length);
	for (const [index, { pageNumber, size }] of sizes.entries()) {
		throwIfAborted(signal);
		const px = pixelSizeForPage(size, settings.dpi);
		const blob = await renderer.renderImage(
			pageNumber,
			px,
			settings.format,
			settings.jpegQuality,
			signal,
		);
		throwIfAborted(signal);
		if (heldBytes + blob.size > maxResultBytes) {
			return { images, stoppedBeforePage: pageNumber };
		}
		heldBytes += blob.size;
		images.push({
			pageNumber,
			fileName: imageFileName(
				baseName,
				pageNumber,
				renderer.pageCount,
				settings.format,
			),
			blob,
			width: px.width,
			height: px.height,
		});
		onProgress?.(index + 1, sizes.length);
	}
	return { images, stoppedBeforePage: null };
}
