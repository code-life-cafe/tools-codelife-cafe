// hex.ts — バイト列の16進表記。

/** バイト列を小文字・ゼロ埋め2桁の16進文字列にする */
export function toHex(bytes: Uint8Array): string {
	let hex = '';
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i].toString(16).padStart(2, '0');
	}
	return hex;
}
