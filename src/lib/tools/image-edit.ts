// image-edit.ts — 画像のクロップ・回転・反転のコアロジック（純粋関数中心）
// 処理はすべてブラウザ内（Canvas API）で完結し、サーバーへの送信は行わない。
// loadBitmap で EXIF Orientation を反映するため、出力には Orientation タグを残さない。

// node --test から直接読み込めるよう、相対パス + 拡張子付きで import する（zip.ts と同じ規約）
import { downloadBlob } from './image-common.ts';
import { buildZip, dedupeZipNames } from './zip.ts';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** クロップ矩形（ピクセル基準、loadBitmap 後の bitmap 座標系） */
export type CropRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type Flip = { horizontal: boolean; vertical: boolean };

export type OutputFormat = 'png' | 'jpeg' | 'webp';

export type EditOps = {
	crop?: CropRect;
	rotateDeg: number;
	flip: Flip;
	output: OutputFormat;
	quality: number; // 0-100（PNGは無視）
	background: string; // 余白・JPEG合成色（既定 '#ffffff'）
};

export type EditResult = {
	fileName: string;
	blob: Blob;
	warnings: string[];
};

export type ImageInputValidation =
	| { ok: true; format: 'png' | 'jpeg' | 'webp' }
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

const SUPPORTED_TYPES: Record<string, 'png' | 'jpeg' | 'webp'> = {
	'image/png': 'png',
	'image/jpeg': 'jpeg',
	'image/webp': 'webp',
};

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB/ファイル
export const MAX_FILE_COUNT = 30;
export const MAX_TOTAL_SIZE = 300 * 1024 * 1024; // 300MB
export const DEFAULT_QUALITY = 85;
export const DEFAULT_BACKGROUND = '#ffffff';

export const DEFAULT_EDIT_OPS: EditOps = {
	rotateDeg: 0,
	flip: { horizontal: false, vertical: false },
	output: 'png',
	quality: DEFAULT_QUALITY,
	background: DEFAULT_BACKGROUND,
};

// ---------------------------------------------------------------------------
// 純粋ロジック（unit test 対象）
// ---------------------------------------------------------------------------

/** 1ファイルの形式・サイズを検証する */
export function validateEditImageFile(
	file: Pick<File, 'type' | 'size'>,
): ImageInputValidation {
	const format = SUPPORTED_TYPES[file.type];
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
			message: 'ファイルサイズが50MBを超えています。',
		};
	}
	return { ok: true, format };
}

/** 一括処理のファイル数・合計サイズを検証する */
export function validateEditBatch(
	files: Pick<File, 'type' | 'size'>[],
): ImageInputValidation {
	if (files.length > MAX_FILE_COUNT) {
		return {
			ok: false,
			reason: 'too-many-files',
			message: `一度に処理できるのは${MAX_FILE_COUNT}ファイルまでです。`,
		};
	}
	const totalSize = files.reduce((sum, f) => sum + f.size, 0);
	if (totalSize > MAX_TOTAL_SIZE) {
		return {
			ok: false,
			reason: 'total-size-exceeded',
			message: '選択ファイルの合計サイズが300MBを超えています。',
		};
	}
	return { ok: true, format: 'png' }; // format はバッチ全体では意味がないため仮値
}

/** 角度をラジアンに変換 */
export function degToRad(deg: number): number {
	return (deg * Math.PI) / 180;
}

/**
 * cos/sin の 0 / 1 近傍の浮動小数点誤差を吸収する。
 * 90°単位の回転で ~1e-16 の誤差が残ると ceil で出力が1px膨らむ
 * （180°/270°で背景色の縁が出る）ため、右角近傍のみ厳密値へスナップする。
 * 任意角度では値を変えない（減算方式だと外接矩形が1px不足し画像が欠けうる）。
 */
function snapTrig(v: number): number {
	const EPS = 1e-12;
	if (v < EPS) return 0;
	if (v > 1 - EPS) return 1;
	return v;
}

/** 任意角度回転後の外接矩形サイズを算出する */
export function computeRotatedSize(
	w: number,
	h: number,
	deg: number,
): { width: number; height: number } {
	const rad = Math.abs(degToRad(deg % 360));
	const cos = snapTrig(Math.abs(Math.cos(rad)));
	const sin = snapTrig(Math.abs(Math.sin(rad)));
	return {
		width: Math.ceil(w * cos + h * sin),
		height: Math.ceil(w * sin + h * cos),
	};
}

/** 出力ファイル名を生成する */
export function buildEditedFilename(
	originalName: string,
	output: OutputFormat,
): string {
	const base = originalName.replace(/\.[^.]+$/, '') || 'image';
	const ext = output === 'jpeg' ? 'jpg' : output;
	return `${base}_edited.${ext}`;
}

/** 出力形式の MIME タイプを返す */
export function mimeForFormat(format: OutputFormat): string {
	switch (format) {
		case 'jpeg':
			return 'image/jpeg';
		case 'webp':
			return 'image/webp';
		case 'png':
			return 'image/png';
	}
}

/** JPEG 出力時は透過を背景色で合成する必要がある */
export function needsBackgroundComposite(format: OutputFormat): boolean {
	return format === 'jpeg';
}

// ---------------------------------------------------------------------------
// ブラウザ依存ロジック（Canvas API）
// ---------------------------------------------------------------------------

/**
 * 画像ファイルを ImageBitmap として読み込む。
 * JPEG は imageOrientation: 'from-image' で EXIF Orientation を自動反映し、
 * 以降の座標系は常に「表示方向」基準になる。
 */
export async function loadBitmap(file: File): Promise<ImageBitmap> {
	return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/**
 * クロップ → 回転 → 反転 の順に Canvas API で適用し、結果の canvas を返す。
 * Preview と Export で同一関数を使い、出力の一貫性を保証する。
 */
export function renderEditedCanvas(
	source: ImageBitmap,
	edit: EditOps,
): HTMLCanvasElement {
	// 1. クロップ範囲を決定
	const cx = edit.crop?.x ?? 0;
	const cy = edit.crop?.y ?? 0;
	const cw = edit.crop?.width ?? source.width;
	const ch = edit.crop?.height ?? source.height;

	// 2. 回転後のキャンバスサイズを算出
	const rotated = computeRotatedSize(cw, ch, edit.rotateDeg);
	const outW = rotated.width;
	const outH = rotated.height;

	const canvas = document.createElement('canvas');
	canvas.width = outW;
	canvas.height = outH;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('Canvas 2D コンテキストの取得に失敗しました');
	}

	// 3. 背景色で塗りつぶし（任意角度回転の余白 or JPEG合成用）
	ctx.fillStyle = edit.background;
	ctx.fillRect(0, 0, outW, outH);

	// 4. 回転を適用（キャンバス中心を基準に回転）
	ctx.save();
	ctx.translate(outW / 2, outH / 2);
	ctx.rotate(degToRad(edit.rotateDeg));

	// 5. 反転を適用
	const sx = edit.flip.horizontal ? -1 : 1;
	const sy = edit.flip.vertical ? -1 : 1;
	ctx.scale(sx, sy);

	// 6. クロップされた範囲を描画（中心基準で配置）
	ctx.drawImage(source, cx, cy, cw, ch, -cw / 2, -ch / 2, cw, ch);
	ctx.restore();

	return canvas;
}

/**
 * canvas を指定形式の Blob にエンコードする。
 * JPEG 出力時は透過が既に背景色で合成済み（renderEditedCanvas で塗りつぶし済み）。
 */
export function encodeEditedCanvas(
	canvas: HTMLCanvasElement,
	format: OutputFormat,
	quality: number,
): Promise<Blob> {
	const mime = mimeForFormat(format);
	const q =
		format === 'png' ? undefined : Math.min(1, Math.max(0, quality / 100));

	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) {
					resolve(blob);
				} else {
					reject(new Error('画像の書き出しに失敗しました'));
				}
			},
			mime,
			q,
		);
	});
}

/**
 * 1ファイルに対して編集を適用し、結果を返す。
 * renderEditedCanvas + encodeEditedCanvas を合成する。
 */
export async function applyEdit(
	bitmap: ImageBitmap,
	edit: EditOps,
	originalName: string,
): Promise<EditResult> {
	const warnings: string[] = [];

	const canvas = renderEditedCanvas(bitmap, edit);
	const blob = await encodeEditedCanvas(canvas, edit.output, edit.quality);
	const fileName = buildEditedFilename(originalName, edit.output);

	return { fileName, blob, warnings };
}

export type EditProgressCallback = (done: number, total: number) => void;

/**
 * 複数ファイルに共通設定を一括適用する。
 * 2件以上の場合は ZIP 化した Blob を返す。
 */
export async function editBatch(
	files: File[],
	edit: EditOps,
	onProgress?: EditProgressCallback,
): Promise<EditResult[]> {
	const results: EditResult[] = [];

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		const bitmap = await loadBitmap(file);
		try {
			const result = await applyEdit(bitmap, edit, file.name);
			results.push(result);
		} finally {
			bitmap.close();
		}
		onProgress?.(i + 1, files.length);
		// UIスレッドをブロックしないよう1件ごとにyield
		await new Promise((r) => setTimeout(r, 0));
	}

	return results;
}

/**
 * 編集結果を一括ZIPとしてダウンロードする。
 */
export async function downloadEditedZip(results: EditResult[]): Promise<void> {
	const names = dedupeZipNames(results.map((r) => r.fileName));
	const entries = results.map((r, i) => ({
		name: names[i],
		data: r.blob,
	}));
	const zip = await buildZip(entries);
	downloadBlob(zip, 'edited.zip');
}

/**
 * 単一ファイルの編集結果をダウンロードする。
 */
export function downloadEditedFile(result: EditResult): void {
	downloadBlob(result.blob, result.fileName);
}

/**
 * バッチモード用: アスペクト比で中央クロップの CropRect を計算する。
 * ratio = width / height。null の場合はクロップなし。
 */
export function computeCenterCrop(
	imageWidth: number,
	imageHeight: number,
	ratio: number | null,
): CropRect | undefined {
	if (ratio === null || ratio <= 0) return undefined;

	const currentRatio = imageWidth / imageHeight;
	let cropW: number;
	let cropH: number;

	if (currentRatio > ratio) {
		// 画像が比率より横長 → 横を切る
		cropH = imageHeight;
		cropW = Math.round(imageHeight * ratio);
	} else {
		// 画像が比率より縦長 → 縦を切る
		cropW = imageWidth;
		cropH = Math.round(imageWidth / ratio);
	}

	cropW = Math.min(cropW, imageWidth);
	cropH = Math.min(cropH, imageHeight);

	return {
		x: Math.round((imageWidth - cropW) / 2),
		y: Math.round((imageHeight - cropH) / 2),
		width: cropW,
		height: cropH,
	};
}
