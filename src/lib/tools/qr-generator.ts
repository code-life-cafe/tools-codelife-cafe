// QRコード生成ロジック

import QRCode from 'qrcode';

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';
export type QRSize = 200 | 400 | 600;
export type OutputFormat = 'png' | 'svg';

export interface QROptions {
	size: QRSize;
	errorCorrection: ErrorCorrectionLevel;
	foregroundColor: string;
	backgroundColor: string;
	/**
	 * 指定時は `size`（px指定）の代わりにモジュールあたりのpx数で生成する。
	 * `resolveQrScale` により8px/モジュール以上の整数に丸められる。
	 * 未指定時は従来通り `size` を使用するため、既存呼び出しの挙動は変わらない。
	 */
	scale?: number;
}

export const defaultOptions: QROptions = {
	size: 400,
	errorCorrection: 'M',
	foregroundColor: '#000000',
	backgroundColor: '#FFFFFF',
};

/** 高密度QR（モジュール数が多い版）でもスキャン耐性を保つための最小スケール（px/モジュール）。 */
export const MIN_QR_SCALE = 8;

/** 要求スケールを8px/モジュール以上の整数に丸める。 */
export function resolveQrScale(requestedScale: number): number {
	return Math.max(MIN_QR_SCALE, Math.round(requestedScale));
}

function resolveSizeOption(
	options: QROptions,
): { width: QRSize } | { scale: number } {
	if (options.scale !== undefined) {
		return { scale: resolveQrScale(options.scale) };
	}
	return { width: options.size };
}

export async function generateQRDataUrl(
	text: string,
	options: QROptions = defaultOptions,
): Promise<string> {
	if (!text.trim()) return '';

	return QRCode.toDataURL(text, {
		...resolveSizeOption(options),
		margin: 2,
		errorCorrectionLevel: options.errorCorrection,
		color: {
			dark: options.foregroundColor,
			light: options.backgroundColor,
		},
	});
}

export async function generateQRSvg(
	text: string,
	options: QROptions = defaultOptions,
): Promise<string> {
	if (!text.trim()) return '';

	return QRCode.toString(text, {
		type: 'svg',
		...resolveSizeOption(options),
		margin: 2,
		errorCorrectionLevel: options.errorCorrection,
		color: {
			dark: options.foregroundColor,
			light: options.backgroundColor,
		},
	});
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
	const link = document.createElement('a');
	link.href = dataUrl;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
}

export function downloadSvg(svgString: string, filename: string): void {
	const blob = new Blob([svgString], { type: 'image/svg+xml' });
	const url = URL.createObjectURL(blob);
	downloadDataUrl(url, filename);
	URL.revokeObjectURL(url);
}
