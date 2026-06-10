// image-common.ts — 画像ツール共通ユーティリティ
// 読み込み・バリデーション・縮小・エクスポート・座標変換を提供する純粋関数群
// （image-mosaic / image-text で共用）

export const SUPPORTED_IMAGE_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
] as const;

/** 最大ファイルサイズ: 20MB */
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** 読み込み可能な最大辺長（これを超える画像は拒否） */
export const MAX_DIMENSION = 8192;

/** 編集時の作業解像度上限（これを超える場合はユーザー確認の上で縮小） */
export const DOWNSCALE_EDGE = 4096;

export type ImageErrorCode =
	| 'unsupported-format'
	| 'too-large-file'
	| 'too-large-dimension'
	| 'decode-failed';

export type ImageValidationResult =
	| { ok: true }
	| { ok: false; code: ImageErrorCode; message: string };

/** 画像読み込み時の型付きエラー */
export class ImageLoadError extends Error {
	readonly code: ImageErrorCode;

	constructor(code: ImageErrorCode, message: string) {
		super(message);
		this.name = 'ImageLoadError';
		this.code = code;
	}
}

/**
 * ファイルの同期バリデーション（MIMEタイプ・ファイルサイズ）。
 * 寸法チェックはデコードが必要なため loadImageFile / needsDownscale が担う。
 */
export function validateImageFile(file: File): ImageValidationResult {
	if (!(SUPPORTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
		return {
			ok: false,
			code: 'unsupported-format',
			message:
				'対応していない形式です。PNG / JPEG / WebP 画像を選択してください。',
		};
	}
	if (file.size > MAX_FILE_SIZE) {
		return {
			ok: false,
			code: 'too-large-file',
			message: 'ファイルサイズが20MBを超えています。',
		};
	}
	return { ok: true };
}

/**
 * 画像ファイルを HTMLImageElement として読み込む。
 * 8192pxを超える画像は ImageLoadError(too-large-dimension) を投げる。
 */
export async function loadImageFile(file: File): Promise<HTMLImageElement> {
	const validation = validateImageFile(file);
	if (!validation.ok) {
		throw new ImageLoadError(validation.code, validation.message);
	}

	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.src = url;
		try {
			await img.decode();
		} catch {
			throw new ImageLoadError(
				'decode-failed',
				'画像の読み込みに失敗しました。ファイルが破損している可能性があります。',
			);
		}
		if (img.naturalWidth > MAX_DIMENSION || img.naturalHeight > MAX_DIMENSION) {
			throw new ImageLoadError(
				'too-large-dimension',
				`画像サイズが大きすぎます（最大 ${MAX_DIMENSION}px）。`,
			);
		}
		return img;
	} finally {
		// decode() 完了後はビットマップが保持されるため revoke してよい
		URL.revokeObjectURL(url);
	}
}

/** 長辺が作業解像度上限（4096px）を超えているか */
export function needsDownscale(img: HTMLImageElement): boolean {
	return Math.max(img.naturalWidth, img.naturalHeight) > DOWNSCALE_EDGE;
}

/**
 * 長辺が maxEdge に収まるよう縮小した Canvas を返す。
 * 以後の編集はこの Canvas を source として扱う。
 */
export function downscaleImage(
	img: HTMLImageElement,
	maxEdge: number = DOWNSCALE_EDGE,
): HTMLCanvasElement {
	const scale = Math.min(
		1,
		maxEdge / Math.max(img.naturalWidth, img.naturalHeight),
	);
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(img.naturalWidth * scale);
	canvas.height = Math.round(img.naturalHeight * scale);
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('Canvas 2D コンテキストの取得に失敗しました');
	}
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
	return canvas;
}

export type ExportFormat = 'png' | 'jpeg';

export type ExportOptions = {
	format: ExportFormat;
	/** JPEG品質 0.1–1.0（デフォルト 0.92）。PNGでは無視 */
	quality?: number;
};

export const DEFAULT_JPEG_QUALITY = 0.92;

/**
 * Canvas を PNG / JPEG の Blob に変換する。
 * JPEG は透過非対応のため白背景に合成してから書き出す。
 */
export function exportCanvas(
	canvas: HTMLCanvasElement,
	options: ExportOptions,
): Promise<Blob> {
	const { format } = options;
	const quality = Math.min(
		1,
		Math.max(0.1, options.quality ?? DEFAULT_JPEG_QUALITY),
	);

	let target = canvas;
	if (format === 'jpeg') {
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
			format === 'jpeg' ? 'image/jpeg' : 'image/png',
			format === 'jpeg' ? quality : undefined,
		);
	});
}

/** 元ファイル名から `{basename}_edited.{ext}` 形式のファイル名を作る */
export function buildExportFilename(
	originalName: string,
	format: ExportFormat,
): string {
	const base = originalName.replace(/\.[^.]+$/, '') || 'image';
	const ext = format === 'jpeg' ? 'jpg' : 'png';
	return `${base}_edited.${ext}`;
}

/** Blob をファイルとしてダウンロードさせる */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	// click 直後の revoke はダウンロード失敗の原因になるため遅延させる
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * レイヤー・領域用のID生成。
 * crypto.randomUUID は Safari 15.4 未満に存在しないためフォールバックを持つ
 * （ぼかしの stack blur フォールバックがカバーする旧Safariと整合させる）。
 */
export function createId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * クライアント座標（pointer イベント）を canvas の内部解像度座標へ変換する。
 * canvas は内部解像度 = 元画像サイズで、CSSにより縮小表示されている前提。
 */
export function clientToImage(
	canvas: HTMLCanvasElement,
	clientX: number,
	clientY: number,
): { x: number; y: number } {
	const rect = canvas.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) {
		return { x: 0, y: 0 };
	}
	return {
		x: clamp(
			((clientX - rect.left) * canvas.width) / rect.width,
			0,
			canvas.width,
		),
		y: clamp(
			((clientY - rect.top) * canvas.height) / rect.height,
			0,
			canvas.height,
		),
	};
}
