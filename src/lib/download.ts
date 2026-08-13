import { OBJECT_URL_REVOKE_DELAY_MS } from './constants.ts';

/**
 * Blob をファイルとしてダウンロードする共通 helper。
 * click 後に object URL を必ず revoke してメモリを解放する。
 */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
}
