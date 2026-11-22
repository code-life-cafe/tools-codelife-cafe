// image-merge.ts — 複数画像の結合（縦・横・グリッド）コアロジック（純粋関数中心）
// 処理はすべてブラウザ内（Canvas API）で完結し、サーバーへの送信は行わない。

import {
	BATCH_MAX_FILE_COUNT,
	BATCH_TOTAL_SIZE_LIMIT_BYTES,
	BYTES_PER_MB,
	FILE_SIZE_LIMITS_MB,
} from '../constants.ts';
import { mimeForFormat } from '../image-canvas.ts';

export { mimeForFormat };

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export type MergeMode = 'vertical' | 'horizontal' | 'grid';
export type FitPolicy = 'original' | 'fit-width' | 'uniform-cell';
export type OutputFormat = 'png' | 'jpeg' | 'webp';

export type MergeOptions = {
	mode: MergeMode;
	columns: number;
	gap: number;
	padding: number;
	background: string;
	fit: FitPolicy;
	align: 'start' | 'center' | 'end';
	output: OutputFormat;
	quality: number;
};

export type Cell = { x: number; y: number; w: number; h: number };

export type MergeLayout = {
	width: number;
	height: number;
	cells: Cell[];
};

export type ImageSize = { width: number; height: number };

export type ImageInputValidation =
	| { ok: true; format: 'png' | 'jpeg' | 'webp' | 'gif' }
	| {
			ok: false;
			reason:
				| 'unsupported-type'
				| 'too-large'
				| 'too-many-files'
				| 'total-size-exceeded';
			message: string;
	  };

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const SUPPORTED_TYPES: Record<string, 'png' | 'jpeg' | 'webp' | 'gif'> = {
	'image/png': 'png',
	'image/jpeg': 'jpeg',
	'image/webp': 'webp',
	'image/gif': 'gif',
};

export const MAX_FILE_SIZE = FILE_SIZE_LIMITS_MB.IMAGE_MERGE * BYTES_PER_MB;
export const MAX_FILE_COUNT = BATCH_MAX_FILE_COUNT;
export const MAX_TOTAL_SIZE = BATCH_TOTAL_SIZE_LIMIT_BYTES;
export const MAX_CANVAS_DIMENSION = 16384;
export const DEFAULT_QUALITY = 85;

export const DEFAULT_MERGE_OPTIONS: MergeOptions = {
	mode: 'vertical',
	columns: 2,
	gap: 0,
	padding: 0,
	background: '#ffffff',
	fit: 'fit-width',
	align: 'center',
	output: 'png',
	quality: DEFAULT_QUALITY,
};

// ---------------------------------------------------------------------------
// バリデーション（純粋関数）
// ---------------------------------------------------------------------------

export function validateImageFile(
	file: Pick<File, 'type' | 'size'>,
): ImageInputValidation {
	const format = SUPPORTED_TYPES[file.type];
	if (!format) {
		return {
			ok: false,
			reason: 'unsupported-type',
			message:
				'対応していない形式です。PNG / JPEG / WebP / GIF 画像を選択してください。',
		};
	}
	if (file.size > MAX_FILE_SIZE) {
		return {
			ok: false,
			reason: 'too-large',
			message: 'ファイルサイズが50MBを超えています。',
		};
	}
	return { ok: true, format };
}

export function validateBatch(
	count: number,
	totalSize: number,
): ImageInputValidation {
	if (count > MAX_FILE_COUNT) {
		return {
			ok: false,
			reason: 'too-many-files',
			message: `一度に処理できるのは${MAX_FILE_COUNT}ファイルまでです。`,
		};
	}
	if (totalSize > MAX_TOTAL_SIZE) {
		return {
			ok: false,
			reason: 'total-size-exceeded',
			message: '選択ファイルの合計サイズが300MBを超えています。',
		};
	}
	return { ok: true, format: 'png' };
}

// ---------------------------------------------------------------------------
// レイアウト計算（純粋関数 — unit test 対象）
// ---------------------------------------------------------------------------

function scaleToWidth(
	size: ImageSize,
	targetWidth: number,
): { w: number; h: number } {
	if (size.width === 0) return { w: 0, h: 0 };
	const scale = targetWidth / size.width;
	return {
		w: Math.round(targetWidth),
		h: Math.max(1, Math.round(size.height * scale)),
	};
}

function scaleToFit(
	size: ImageSize,
	cellW: number,
	cellH: number,
): { w: number; h: number } {
	if (size.width === 0 || size.height === 0) return { w: 0, h: 0 };
	const scale = Math.min(cellW / size.width, cellH / size.height);
	return {
		w: Math.max(1, Math.round(size.width * scale)),
		h: Math.max(1, Math.round(size.height * scale)),
	};
}

function alignOffset(
	cellSize: number,
	contentSize: number,
	align: 'start' | 'center' | 'end',
): number {
	switch (align) {
		case 'start':
			return 0;
		case 'center':
			return Math.round((cellSize - contentSize) / 2);
		case 'end':
			return cellSize - contentSize;
	}
}

export function computeLayout(
	sizes: ImageSize[],
	opts: MergeOptions,
): MergeLayout {
	if (sizes.length === 0) {
		return { width: 0, height: 0, cells: [] };
	}

	const { mode, columns, gap, padding, fit, align } = opts;

	switch (mode) {
		case 'vertical':
			return computeVerticalLayout(sizes, { gap, padding, fit, align });
		case 'horizontal':
			return computeHorizontalLayout(sizes, { gap, padding, fit, align });
		case 'grid':
			return computeGridLayout(sizes, {
				columns,
				gap,
				padding,
				fit,
				align,
			});
	}
}

function computeVerticalLayout(
	sizes: ImageSize[],
	opts: { gap: number; padding: number; fit: FitPolicy; align: string },
): MergeLayout {
	const { gap, padding, fit, align } = opts;
	const alignVal = align as 'start' | 'center' | 'end';

	if (fit === 'original') {
		const maxW = Math.max(...sizes.map((s) => s.width));
		const cells: Cell[] = [];
		let y = padding;
		for (let i = 0; i < sizes.length; i++) {
			if (i > 0) y += gap;
			const s = sizes[i];
			const x = padding + alignOffset(maxW, s.width, alignVal);
			cells.push({ x, y, w: s.width, h: s.height });
			y += s.height;
		}
		return {
			width: maxW + padding * 2,
			height: y + padding,
			cells,
		};
	}

	if (fit === 'fit-width') {
		const maxW = Math.max(...sizes.map((s) => s.width));
		const cells: Cell[] = [];
		let y = padding;
		for (let i = 0; i < sizes.length; i++) {
			if (i > 0) y += gap;
			const scaled = scaleToWidth(sizes[i], maxW);
			const x = padding + alignOffset(maxW, scaled.w, alignVal);
			cells.push({ x, y, w: scaled.w, h: scaled.h });
			y += scaled.h;
		}
		return {
			width: maxW + padding * 2,
			height: y + padding,
			cells,
		};
	}

	// uniform-cell: 全画像を最大幅×最大高さのセルに収める
	const cellW = Math.max(...sizes.map((s) => s.width));
	const cellH = Math.max(...sizes.map((s) => s.height));
	const cells: Cell[] = [];
	let y = padding;
	for (let i = 0; i < sizes.length; i++) {
		if (i > 0) y += gap;
		const fitted = scaleToFit(sizes[i], cellW, cellH);
		const x = padding + alignOffset(cellW, fitted.w, alignVal);
		const yOff = alignOffset(cellH, fitted.h, alignVal);
		cells.push({ x, y: y + yOff, w: fitted.w, h: fitted.h });
		y += cellH;
	}
	return {
		width: cellW + padding * 2,
		height: y + padding,
		cells,
	};
}

function computeHorizontalLayout(
	sizes: ImageSize[],
	opts: { gap: number; padding: number; fit: FitPolicy; align: string },
): MergeLayout {
	const { gap, padding, fit, align } = opts;
	const alignVal = align as 'start' | 'center' | 'end';

	if (fit === 'original') {
		const maxH = Math.max(...sizes.map((s) => s.height));
		const cells: Cell[] = [];
		let x = padding;
		for (let i = 0; i < sizes.length; i++) {
			if (i > 0) x += gap;
			const s = sizes[i];
			const y = padding + alignOffset(maxH, s.height, alignVal);
			cells.push({ x, y, w: s.width, h: s.height });
			x += s.width;
		}
		return {
			width: x + padding,
			height: maxH + padding * 2,
			cells,
		};
	}

	if (fit === 'fit-width') {
		// 横結合のfit-width: 高さを最大高さに合わせてスケール
		const maxH = Math.max(...sizes.map((s) => s.height));
		const cells: Cell[] = [];
		let x = padding;
		for (let i = 0; i < sizes.length; i++) {
			if (i > 0) x += gap;
			const s = sizes[i];
			const scale = maxH / s.height;
			const scaledW = Math.max(1, Math.round(s.width * scale));
			const y = padding + alignOffset(maxH, maxH, alignVal);
			cells.push({ x, y, w: scaledW, h: maxH });
			x += scaledW;
		}
		return {
			width: x + padding,
			height: maxH + padding * 2,
			cells,
		};
	}

	// uniform-cell
	const cellW = Math.max(...sizes.map((s) => s.width));
	const cellH = Math.max(...sizes.map((s) => s.height));
	const cells: Cell[] = [];
	let x = padding;
	for (let i = 0; i < sizes.length; i++) {
		if (i > 0) x += gap;
		const fitted = scaleToFit(sizes[i], cellW, cellH);
		const xOff = alignOffset(cellW, fitted.w, alignVal);
		const y = padding + alignOffset(cellH, fitted.h, alignVal);
		cells.push({ x: x + xOff, y, w: fitted.w, h: fitted.h });
		x += cellW;
	}
	return {
		width: x + padding,
		height: cellH + padding * 2,
		cells,
	};
}

function computeGridLayout(
	sizes: ImageSize[],
	opts: {
		columns: number;
		gap: number;
		padding: number;
		fit: FitPolicy;
		align: string;
	},
): MergeLayout {
	const { columns, gap, padding, fit, align } = opts;
	const alignVal = align as 'start' | 'center' | 'end';
	const cols = Math.max(1, Math.min(columns, sizes.length));
	const rows = Math.ceil(sizes.length / cols);

	if (fit === 'original') {
		// 各列の最大幅、各行の最大高さを算出
		const colWidths = new Array(cols).fill(0) as number[];
		const rowHeights = new Array(rows).fill(0) as number[];
		for (let i = 0; i < sizes.length; i++) {
			const col = i % cols;
			const row = Math.floor(i / cols);
			colWidths[col] = Math.max(colWidths[col], sizes[i].width);
			rowHeights[row] = Math.max(rowHeights[row], sizes[i].height);
		}

		const cells: Cell[] = [];
		for (let i = 0; i < sizes.length; i++) {
			const col = i % cols;
			const row = Math.floor(i / cols);
			const cellX =
				padding +
				colWidths.slice(0, col).reduce((a, b) => a + b, 0) +
				col * gap;
			const cellY =
				padding +
				rowHeights.slice(0, row).reduce((a, b) => a + b, 0) +
				row * gap;
			const s = sizes[i];
			const x = cellX + alignOffset(colWidths[col], s.width, alignVal);
			const y = cellY + alignOffset(rowHeights[row], s.height, alignVal);
			cells.push({ x, y, w: s.width, h: s.height });
		}

		const totalW =
			colWidths.reduce((a, b) => a + b, 0) + (cols - 1) * gap + padding * 2;
		const totalH =
			rowHeights.reduce((a, b) => a + b, 0) + (rows - 1) * gap + padding * 2;
		return { width: totalW, height: totalH, cells };
	}

	// fit-width / uniform-cell: 統一セルサイズ
	const cellW = Math.max(...sizes.map((s) => s.width));
	const cellH = Math.max(...sizes.map((s) => s.height));

	const cells: Cell[] = [];
	for (let i = 0; i < sizes.length; i++) {
		const col = i % cols;
		const row = Math.floor(i / cols);
		const cellX = padding + col * (cellW + gap);
		const cellY = padding + row * (cellH + gap);

		let drawW: number;
		let drawH: number;
		if (fit === 'fit-width') {
			const scaled = scaleToWidth(sizes[i], cellW);
			drawW = scaled.w;
			drawH = Math.min(scaled.h, cellH);
		} else {
			const fitted = scaleToFit(sizes[i], cellW, cellH);
			drawW = fitted.w;
			drawH = fitted.h;
		}

		const x = cellX + alignOffset(cellW, drawW, alignVal);
		const y = cellY + alignOffset(cellH, drawH, alignVal);
		cells.push({ x, y, w: drawW, h: drawH });
	}

	const totalW = cols * cellW + (cols - 1) * gap + padding * 2;
	const totalH = rows * cellH + (rows - 1) * gap + padding * 2;
	return { width: totalW, height: totalH, cells };
}

// ---------------------------------------------------------------------------
// プレビュー用の縮小（#738）
// ---------------------------------------------------------------------------

/**
 * プレビュー描画の画素数の上限。出力（ダウンロード）はこの値に関係なくフル解像度。
 * スマホ写真（4000×3000）を数枚縦に並べると数千万画素になり、余白変更や並び替えのたびに
 * メインスレッドで描き直すと次の描画まで1〜2秒かかっていた（#738）。
 * 描画時間はおおむね描き先の画素数に比例し、モバイル相当（CPU 4倍減速）で
 * 400万画素は約100〜160ms、200万画素は約50〜70msだった。操作後の描画を200ms以内に
 * 収めるため200万画素とする（スマホ表示幅×DPRに対しておおむね足りる確認用の解像度）。
 */
export const PREVIEW_MAX_PIXELS = 2_000_000;

/**
 * 出力サイズ（width×height）をプレビュー用に縮小する倍率（0〜1）。
 * 上限以下なら 1（等倍）。幅・高さが0以下なら 1。
 */
export function computePreviewScale(
	width: number,
	height: number,
	maxPixels: number = PREVIEW_MAX_PIXELS,
): number {
	if (width <= 0 || height <= 0 || maxPixels <= 0) return 1;
	const pixels = width * height;
	if (pixels <= maxPixels) return 1;
	return Math.sqrt(maxPixels / pixels);
}

/**
 * レイアウト全体（キャンバスと各セル）を倍率 scale で縮小する。プレビュー専用。
 * キャンバスの幅・高さは切り捨てて画素数の上限を超えないようにする。
 * セルは左上・右下の座標を丸めて（右下はキャンバス内に収めて）隣接セルとの隙間・重なりの差を
 * 1px以内に抑え、幅・高さは1px以上を保つ。scale >= 1 のときは元のレイアウトをそのまま返す。
 */
export function scaleLayout(layout: MergeLayout, scale: number): MergeLayout {
	if (!(scale > 0) || scale >= 1) return layout;
	const width = Math.max(1, Math.floor(layout.width * scale));
	const height = Math.max(1, Math.floor(layout.height * scale));
	const cells = layout.cells.map((c) => {
		const x = Math.round(c.x * scale);
		const y = Math.round(c.y * scale);
		const right = Math.min(Math.round((c.x + c.w) * scale), width);
		const bottom = Math.min(Math.round((c.y + c.h) * scale), height);
		return {
			x,
			y,
			w: Math.max(1, right - x),
			h: Math.max(1, bottom - y),
		};
	});
	return { width, height, cells };
}

/**
 * プレビュー描画の元にする縮小画像のサイズ。画素数が maxPixels 以下になるよう縦横比を保って縮める。
 * 縮小が不要なら null。プレビューのcanvas全体が maxPixels 以下なので、どのセルも
 * この縮小画像より大きく描かれることはなく、元画像から描く場合と見た目の解像度は変わらない。
 */
export function computePreviewSourceSize(
	width: number,
	height: number,
	maxPixels: number = PREVIEW_MAX_PIXELS,
): ImageSize | null {
	const scale = computePreviewScale(width, height, maxPixels);
	if (scale >= 1) return null;
	return {
		width: Math.max(1, Math.floor(width * scale)),
		height: Math.max(1, Math.floor(height * scale)),
	};
}

/** 合成後のキャンバスが上限を超える場合に日本語メッセージで例外を投げる */
export function assertCanvasWithinLimit(layout: MergeLayout): void {
	if (
		layout.width > MAX_CANVAS_DIMENSION ||
		layout.height > MAX_CANVAS_DIMENSION
	) {
		throw new Error(
			`合成後のキャンバスサイズが上限（${MAX_CANVAS_DIMENSION}px）を超えています。画像数・余白を減らしてください。`,
		);
	}
}

// ---------------------------------------------------------------------------
// 出力ファイル名・MIMEタイプ
// ---------------------------------------------------------------------------

export function buildMergedFilename(format: OutputFormat): string {
	const ext = format === 'jpeg' ? 'jpg' : format;
	return `merged.${ext}`;
}

// ---------------------------------------------------------------------------
// ブラウザ依存ロジック（Canvas API）
// ---------------------------------------------------------------------------

export async function loadImageBitmap(file: File): Promise<ImageBitmap> {
	return createImageBitmap(file);
}

/**
 * プレビュー描画用の縮小ImageBitmapを作る（読み込み時に1回だけ）。縮小不要なら null。
 * 出力（ダウンロード）には使わない。
 */
export async function createPreviewBitmap(
	bitmap: ImageBitmap,
): Promise<ImageBitmap | null> {
	const size = computePreviewSourceSize(bitmap.width, bitmap.height);
	if (!size) return null;
	return createImageBitmap(bitmap, {
		resizeWidth: size.width,
		resizeHeight: size.height,
		resizeQuality: 'high',
	});
}

export function mergeImages(
	bitmaps: ImageBitmap[],
	layout: MergeLayout,
	opts: MergeOptions,
): HTMLCanvasElement {
	assertCanvasWithinLimit(layout);

	const canvas = document.createElement('canvas');
	canvas.width = layout.width;
	canvas.height = layout.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('Canvas 2D コンテキストの取得に失敗しました');
	}
	drawMerged(ctx, bitmaps, layout, opts);
	return canvas;
}

/**
 * 背景を塗り、各画像をレイアウトのセルへ描く。キャンバスのサイズ設定は呼び出し側が行う。
 * 出力（mergeImages）とプレビュー（縮小レイアウト）で同じ描画手順を使う。
 */
export function drawMerged(
	ctx: CanvasRenderingContext2D,
	bitmaps: CanvasImageSource[],
	layout: MergeLayout,
	opts: MergeOptions,
): void {
	// 背景塗り
	if (opts.background === 'transparent') {
		ctx.clearRect(0, 0, layout.width, layout.height);
	} else {
		ctx.fillStyle = opts.background;
		ctx.fillRect(0, 0, layout.width, layout.height);
	}

	// 各画像を描画
	for (let i = 0; i < bitmaps.length; i++) {
		const cell = layout.cells[i];
		if (!cell) continue;
		ctx.drawImage(bitmaps[i], cell.x, cell.y, cell.w, cell.h);
	}
}

export function exportCanvas(
	canvas: HTMLCanvasElement,
	opts: MergeOptions,
): Promise<Blob> {
	const mime = mimeForFormat(opts.output);
	const quality = opts.output === 'png' ? undefined : opts.quality / 100;

	let target = canvas;
	if (opts.output === 'jpeg' && opts.background === 'transparent') {
		// JPEG は透過非対応。白背景で合成。
		const composite = document.createElement('canvas');
		composite.width = canvas.width;
		composite.height = canvas.height;
		const ctx = composite.getContext('2d');
		if (!ctx) {
			return Promise.reject(
				new Error('Canvas 2D コンテキストの取得に失敗しました'),
			);
		}
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, composite.width, composite.height);
		ctx.drawImage(canvas, 0, 0);
		target = composite;
	}

	return new Promise((resolve, reject) => {
		target.toBlob(
			(blob) => {
				if (blob) {
					resolve(blob);
				} else {
					reject(new Error('画像の書き出しに失敗しました'));
				}
			},
			mime,
			quality,
		);
	});
}
