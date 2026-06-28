export function encodeBase64(text: string): string {
	try {
		const bytes = new TextEncoder().encode(text);
		const binString = Array.from(bytes, (byte) =>
			String.fromCodePoint(byte),
		).join('');
		return btoa(binString);
	} catch (_error) {
		throw new Error('エンコードに失敗しました。');
	}
}

export function decodeBase64(base64: string): string {
	try {
		let cleaned = base64
			.replace(/\s/g, '')
			.replace(/-/g, '+')
			.replace(/_/g, '/');
		const pad = (4 - (cleaned.length % 4)) % 4;
		if (pad === 1) cleaned += '=';
		else if (pad === 2) cleaned += '==';

		if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
			throw new Error('不正なBase64文字列です。');
		}
		const binString = atob(cleaned);
		const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0) ?? 0);
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (_error) {
		throw new Error(
			'デコードに失敗しました。Base64文字列の形式を確認してください。',
		);
	}
}

export function fileToBase64(
	file: File,
	withDataUri: boolean = true,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			if (withDataUri) {
				resolve(result);
			} else {
				// Remove the data URI prefix (e.g. data:image/png;base64,)
				const base64Index = result.indexOf('base64,') + 7;
				resolve(result.substring(base64Index));
			}
		};
		reader.onerror = () =>
			reject(new Error('ファイルの読み込みに失敗しました。'));
		reader.readAsDataURL(file);
	});
}

export function getByteSize(str: string): number {
	return new TextEncoder().encode(str).length;
}

export function getBase64ByteSize(base64: string): number {
	// Approximate size or accurate size of the decoded string
	const str = base64.replace(/=/g, '');
	return Math.floor((str.length * 3) / 4);
}
