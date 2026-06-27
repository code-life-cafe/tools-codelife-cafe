export type SnippetKind = 'img' | 'css-bg' | 'raw-base64' | 'data-uri';

export type ImageInputValidation =
	| { ok: true; mime: string }
	| {
			ok: false;
			reason: 'unsupported-type' | 'too-large';
			message: string;
	  };

export type SizeEstimate = {
	originalBytes: number;
	base64TextBytes: number;
	inflationPct: number;
};

const SUPPORTED_MIMES = new Set([
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'image/svg+xml',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/svg+xml': 'svg',
};

export function validateImageFile(file: File): ImageInputValidation {
	if (!SUPPORTED_MIMES.has(file.type)) {
		return {
			ok: false,
			reason: 'unsupported-type',
			message:
				'対応していない形式です。PNG / JPEG / WebP / GIF / SVG を選択してください。',
		};
	}
	if (file.size > MAX_FILE_SIZE) {
		return {
			ok: false,
			reason: 'too-large',
			message: 'ファイルサイズが10MBを超えています。',
		};
	}
	return { ok: true, mime: file.type };
}

export function fileToDataUri(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () =>
			reject(new Error('ファイルの読み込みに失敗しました。'));
		reader.readAsDataURL(file);
	});
}

export function toBase64(dataUri: string): string {
	const idx = dataUri.indexOf(',');
	if (idx === -1) {
		throw new Error(
			'不正な Data URI です。"data:<mime>;base64," 形式で入力してください。',
		);
	}
	return dataUri.slice(idx + 1);
}

export function buildSnippet(dataUri: string, kind: SnippetKind): string {
	switch (kind) {
		case 'data-uri':
			return dataUri;
		case 'raw-base64':
			return toBase64(dataUri);
		case 'img':
			return `<img src="${dataUri}" alt="" />`;
		case 'css-bg':
			return `background-image: url("${dataUri}");`;
	}
}

const MAGIC_BYTES: [string, string][] = [
	['iVBOR', 'image/png'],
	['/9j/', 'image/jpeg'],
	['R0lGO', 'image/gif'],
	['UklGR', 'image/webp'],
];

export function detectMimeFromBase64(b64: string): string | null {
	for (const [prefix, mime] of MAGIC_BYTES) {
		if (b64.startsWith(prefix)) return mime;
	}
	if (b64.startsWith('PD') || b64.startsWith('PHN')) {
		return 'image/svg+xml';
	}
	return null;
}

function normalizeBase64Input(input: string): string {
	return input.replace(/[\s\r\n]/g, '');
}

export function dataUriToBlob(input: string): {
	blob: Blob;
	mime: string;
	ext: string;
} {
	const cleaned = normalizeBase64Input(input);

	let mime: string | null = null;
	let b64: string;

	const dataUriMatch = cleaned.match(/^data:([^;,]+);base64,(.+)$/);
	if (dataUriMatch) {
		mime = dataUriMatch[1];
		b64 = dataUriMatch[2];
	} else {
		b64 = cleaned;
	}

	const detectedMime = detectMimeFromBase64(b64);
	if (detectedMime) {
		mime = detectedMime;
	}

	if (!mime) {
		throw new Error(
			'MIMEタイプを判定できません。Data URI形式（data:image/png;base64,...）で入力するか、有効な画像のBase64を入力してください。',
		);
	}

	if (!SUPPORTED_MIMES.has(mime)) {
		throw new Error(
			`対応していない形式です（${mime}）。画像（PNG / JPEG / WebP / GIF / SVG）のBase64を入力してください。`,
		);
	}

	let bytes: Uint8Array;
	try {
		const binary = atob(b64);
		bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
	} catch {
		throw new Error(
			'Base64のデコードに失敗しました。有効なBase64文字列を入力してください。',
		);
	}

	const ext = MIME_TO_EXT[mime] ?? 'bin';
	return {
		blob: new Blob([bytes.buffer as ArrayBuffer], { type: mime }),
		mime,
		ext,
	};
}

export function estimateSize(dataUri: string): SizeEstimate {
	const b64 = toBase64(dataUri);
	const base64TextBytes = b64.length;
	const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
	const originalBytes = Math.floor((b64.length * 3) / 4 - padding);
	const inflationPct =
		originalBytes > 0
			? Math.round(((base64TextBytes - originalBytes) / originalBytes) * 100)
			: 0;
	return { originalBytes, base64TextBytes, inflationPct };
}

export function extensionForMime(mime: string): string {
	return MIME_TO_EXT[mime] ?? 'bin';
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
