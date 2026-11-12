// image-canvas.ts — 画像ツールで共用する Canvas まわりの小さなヘルパー。
// OffscreenCanvas が使える環境ではそれを優先し、なければ <canvas> 要素へフォールバックする。

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/** ラスター出力形式（PNG / JPEG / WebP） */
export type RasterOutputFormat = 'png' | 'jpeg' | 'webp';

/** 指定サイズの canvas を作る（OffscreenCanvas 優先） */
export function createCanvas(width: number, height: number): AnyCanvas {
	if (typeof OffscreenCanvas !== 'undefined') {
		return new OffscreenCanvas(width, height);
	}
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

/**
 * canvas を指定MIME・品質で Blob にする。
 * エンコードできなかった場合は例外にせず null を返す（呼び出し側でフォールバックを判断する）。
 */
export function canvasToBlob(
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

/** 出力形式の MIME タイプを返す */
export function mimeForFormat(format: RasterOutputFormat): string {
	switch (format) {
		case 'jpeg':
			return 'image/jpeg';
		case 'webp':
			return 'image/webp';
		case 'png':
			return 'image/png';
	}
}
