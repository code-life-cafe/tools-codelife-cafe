// common.ts — PDF圧縮・PDF→画像で共有する上限・入力検証・画素計算（DOM非依存の純粋関数）
// 処理はすべてブラウザ内で完結し、ファイル内容やファイル名を外部へ送信しない。

import { ENCRYPTED_PDF_MESSAGE, hasPdfSignature } from '../tools/pdf.ts';

/** 1ファイルの入力上限（50MiB） */
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;
/** 1ファイルのページ数上限 */
export const MAX_PAGES = 100;
/** 1ページの描画画素数上限（16メガピクセル。Safariのcanvas面積上限 4096×4096 未満） */
export const MAX_PIXELS_PER_PAGE = 16_000_000;
/** 選択できる解像度（dpi） */
export const DPI_OPTIONS = [72, 96, 144] as const;
/** 選択できるJPEG品質（%） */
export const JPEG_QUALITY_OPTIONS = [50, 70, 85, 92] as const;

export type Dpi = (typeof DPI_OPTIONS)[number];
export type JpegQuality = (typeof JPEG_QUALITY_OPTIONS)[number];

/** PDFの1pt = 1/72インチ */
const POINTS_PER_INCH = 72;

export type PdfToolErrorCode =
	| 'empty'
	| 'not-pdf'
	| 'too-large'
	| 'encrypted'
	| 'corrupt'
	| 'no-pages'
	| 'too-many-pages'
	| 'too-many-pixels'
	| 'signed'
	| 'form'
	| 'invalid-option'
	| 'cancelled';

/** 利用者へそのまま表示できる日本語メッセージを持つエラー */
export class PdfToolError extends Error {
	readonly code: PdfToolErrorCode;

	constructor(code: PdfToolErrorCode, message: string) {
		super(message);
		this.name = 'PdfToolError';
		this.code = code;
	}
}

export const CORRUPT_PDF_MESSAGE =
	'PDFを読み込めませんでした。ファイルが破損しているか、PDF形式ではない可能性があります。';
export const CANCELLED_MESSAGE = '処理をキャンセルしました。';

export function encryptedError(): PdfToolError {
	return new PdfToolError('encrypted', ENCRYPTED_PDF_MESSAGE);
}

export function corruptError(): PdfToolError {
	return new PdfToolError('corrupt', CORRUPT_PDF_MESSAGE);
}

export function isCancelledError(error: unknown): boolean {
	return error instanceof PdfToolError && error.code === 'cancelled';
}

/** signal が中断済みならキャンセルエラーを投げる */
export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new PdfToolError('cancelled', CANCELLED_MESSAGE);
	}
}

/**
 * ファイルのメタ情報と先頭バイトから、読み込み前に判定できる入力エラーを返す（問題なければ null）。
 * 拡張子・MIMEのいずれかがPDFで、かつ `%PDF-` シグネチャを持つことを求める。
 */
export function validatePdfInput(input: {
	name: string;
	type: string;
	size: number;
	head: Uint8Array;
}): PdfToolError | null {
	const looksPdf =
		input.type === 'application/pdf' ||
		input.name.toLowerCase().endsWith('.pdf');
	if (!looksPdf) {
		return new PdfToolError(
			'not-pdf',
			'PDFファイル（.pdf）を選択してください。',
		);
	}
	if (input.size === 0) {
		return new PdfToolError('empty', 'ファイルが空です（0バイト）。');
	}
	if (input.size > MAX_INPUT_BYTES) {
		return new PdfToolError(
			'too-large',
			'ファイルサイズが50MBを超えています。50MB以下のPDFを選択してください。',
		);
	}
	if (!hasPdfSignature(input.head)) {
		return corruptError();
	}
	return null;
}

/** ページ数の上限・下限を検証する */
export function validatePageCount(pageCount: number): PdfToolError | null {
	if (pageCount < 1) {
		return new PdfToolError('no-pages', 'ページが含まれていないPDFです。');
	}
	if (pageCount > MAX_PAGES) {
		return new PdfToolError(
			'too-many-pages',
			`ページ数が多すぎます（全${pageCount}ページ）。${MAX_PAGES}ページ以下のPDFを選択してください。`,
		);
	}
	return null;
}

export function isDpi(value: unknown): value is Dpi {
	return (DPI_OPTIONS as readonly unknown[]).includes(value);
}

export function isJpegQuality(value: unknown): value is JpegQuality {
	return (JPEG_QUALITY_OPTIONS as readonly unknown[]).includes(value);
}

/** PDF.js が文書から読み取る構造上の特徴（暗号化・署名・フォーム） */
export type PdfDocumentFlags = {
	encrypted: boolean;
	signatures: boolean;
	acroForm: boolean;
	xfa: boolean;
};

export type PageSizePt = { widthPt: number; heightPt: number };
export type PixelSize = { width: number; height: number };

/**
 * 表示上のページ寸法（回転適用後のpt）と dpi から出力画素数を求める。
 * 端数は四捨五入し、最低1pxとする。
 */
export function pixelSizeForPage(page: PageSizePt, dpi: Dpi): PixelSize {
	const scale = dpi / POINTS_PER_INCH;
	return {
		width: Math.max(1, Math.round(page.widthPt * scale)),
		height: Math.max(1, Math.round(page.heightPt * scale)),
	};
}

/**
 * 各ページの出力画素数が上限内か検証する。超過した最初のページを日本語で示す。
 * pages は [ページ番号(1始まり), 寸法] の組。
 */
export function validatePixelLimit(
	pages: ReadonlyArray<{ pageNumber: number; size: PageSizePt }>,
	dpi: Dpi,
): PdfToolError | null {
	for (const { pageNumber, size } of pages) {
		const px = pixelSizeForPage(size, dpi);
		if (px.width * px.height > MAX_PIXELS_PER_PAGE) {
			const megaPixels = ((px.width * px.height) / 1_000_000).toFixed(1);
			return new PdfToolError(
				'too-many-pixels',
				`${pageNumber}ページ目は${dpi}dpiで${px.width}×${px.height}px（約${megaPixels}メガピクセル）になり、1ページの上限（16メガピクセル）を超えます。解像度を下げてください。`,
			);
		}
	}
	return null;
}

/** 拡張子 .pdf を除いた出力用のベース名 */
export function pdfBaseName(fileName: string): string {
	const base = fileName.replace(/\.pdf$/i, '').trim();
	return base === '' ? 'document' : base;
}

/** 削減率（%）。元より大きい・同じ場合は 0 */
export function reductionPercent(original: number, output: number): number {
	if (original <= 0 || output >= original) return 0;
	return Math.round(((original - output) / original) * 1000) / 10;
}
