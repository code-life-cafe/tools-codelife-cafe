// image-ocr.ts — 画像文字起こし（OCR）の純粋ロジック
// 入力の検査（形式・寸法・アニメーション）、認識結果とTXT出力の処理、設定の検証を担う。
// Worker・CacheStorage・Canvas などのブラウザ依存は src/lib/ocr/ 側に置く。

/** 入力ファイルの上限（20MiB） */
export const MAX_OCR_FILE_BYTES = 20 * 1024 * 1024;
/** 1辺の上限（px） */
export const MAX_OCR_EDGE = 8192;
/** 総画素数の上限 */
export const MAX_OCR_PIXELS = 12_000_000;
/** 出力テキストの上限（UTF-16コード単位） */
export const MAX_OCR_TEXT_UNITS = 100_000;
/** 認識開始からのタイムアウト（ミリ秒） */
export const OCR_TIMEOUT_MS = 120_000;

export type OcrMode = 'jpn+eng' | 'eng';

export const OCR_MODES: readonly { value: OcrMode; label: string }[] = [
	{ value: 'jpn+eng', label: '日本語＋英語' },
	{ value: 'eng', label: '英語のみ' },
];

export type ImageOcrSettings = { mode: OcrMode };

export const DEFAULT_IMAGE_OCR_SETTINGS: ImageOcrSettings = {
	mode: 'jpn+eng',
};

export function sanitizeImageOcrSettings(
	value: unknown,
	defaults: ImageOcrSettings = DEFAULT_IMAGE_OCR_SETTINGS,
): ImageOcrSettings {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return { ...defaults };
	}
	const mode = (value as Record<string, unknown>).mode;
	return {
		mode: mode === 'jpn+eng' || mode === 'eng' ? mode : defaults.mode,
	};
}

// ---------------------------------------------------------------------------
// 入力の検査
// ---------------------------------------------------------------------------

export type OcrImageFormat = 'png' | 'jpeg' | 'webp';

export type OcrInputErrorCode =
	| 'empty'
	| 'too-large-file'
	| 'unsupported-format'
	| 'gif'
	| 'animated'
	| 'broken'
	| 'too-large-dimension'
	| 'too-many-pixels';

export type OcrInputCheck =
	| { ok: true; format: OcrImageFormat; width: number; height: number }
	| { ok: false; code: OcrInputErrorCode; message: string };

const fail = (code: OcrInputErrorCode, message: string): OcrInputCheck => ({
	ok: false,
	code,
	message,
});

export const OCR_INPUT_MESSAGES = {
	empty: 'ファイルが空です。',
	tooLargeFile: 'ファイルサイズが20MiBを超えています。',
	unsupported:
		'対応していない形式です。PNG・JPEG・WebPの静止画を選択してください。',
	gif: 'GIF画像には対応していません。静止画のPNG・JPEG・WebPに変換してから選択してください。',
	animated:
		'アニメーション画像には対応していません。1コマを静止画（PNG・JPEG・WebP）として書き出してから選択してください。',
	broken:
		'画像のヘッダーを読み取れませんでした。ファイルが破損している可能性があります。',
} as const;

function ascii(bytes: Uint8Array, start: number, length: number): string {
	let out = '';
	for (let i = start; i < start + length && i < bytes.length; i++) {
		out += String.fromCharCode(bytes[i]);
	}
	return out;
}

const u32be = (b: Uint8Array, o: number) =>
	((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number) =>
	(b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

type Header =
	| { format: OcrImageFormat; width: number; height: number; animated: boolean }
	| { format: 'gif' }
	| { format: 'unknown' }
	| { format: 'broken' };

function readPng(bytes: Uint8Array): Header {
	if (bytes.length < 33 || ascii(bytes, 12, 4) !== 'IHDR') {
		return { format: 'broken' };
	}
	const width = u32be(bytes, 16);
	const height = u32be(bytes, 20);
	// 画像データ（IDAT）より前に acTL があればAPNG
	let animated = false;
	let offset = 8;
	while (offset + 8 <= bytes.length) {
		const length = u32be(bytes, offset);
		const type = ascii(bytes, offset + 4, 4);
		if (type === 'acTL') {
			animated = true;
			break;
		}
		if (type === 'IDAT' || type === 'IEND') break;
		offset += 12 + length;
	}
	return { format: 'png', width, height, animated };
}

function readJpeg(bytes: Uint8Array): Header {
	let offset = 2;
	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) return { format: 'broken' };
		const marker = bytes[offset + 1];
		if (marker === 0xff) {
			offset += 1;
			continue;
		}
		if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 1) {
			offset += 2;
			continue;
		}
		const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
		const isSof =
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc;
		if (isSof) {
			if (offset + 9 > bytes.length) return { format: 'broken' };
			return {
				format: 'jpeg',
				height: (bytes[offset + 5] << 8) | bytes[offset + 6],
				width: (bytes[offset + 7] << 8) | bytes[offset + 8],
				animated: false,
			};
		}
		if (marker === 0xda) break;
		offset += 2 + length;
	}
	return { format: 'broken' };
}

function readWebp(bytes: Uint8Array): Header {
	let width = 0;
	let height = 0;
	let animated = false;
	let sized = false;
	let offset = 12;
	while (offset + 8 <= bytes.length) {
		const type = ascii(bytes, offset, 4);
		const size = u32le(bytes, offset + 4);
		const data = offset + 8;
		if (type === 'VP8X' && data + 10 <= bytes.length) {
			if (bytes[data] & 0x02) animated = true;
			width =
				1 +
				(bytes[data + 4] | (bytes[data + 5] << 8) | (bytes[data + 6] << 16));
			height =
				1 +
				(bytes[data + 7] | (bytes[data + 8] << 8) | (bytes[data + 9] << 16));
			sized = true;
		} else if (type === 'ANIM' || type === 'ANMF') {
			animated = true;
		} else if (type === 'VP8 ' && !sized && data + 10 <= bytes.length) {
			width = (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff;
			height = (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff;
			sized = true;
		} else if (type === 'VP8L' && !sized && data + 5 <= bytes.length) {
			const b = [
				bytes[data + 1],
				bytes[data + 2],
				bytes[data + 3],
				bytes[data + 4],
			];
			width = 1 + (b[0] | ((b[1] & 0x3f) << 8));
			height = 1 + ((b[1] >> 6) | (b[2] << 2) | ((b[3] & 0x0f) << 10));
			sized = true;
		}
		offset = data + size + (size % 2);
	}
	return sized
		? { format: 'webp', width, height, animated }
		: { format: 'broken' };
}

function readHeader(bytes: Uint8Array): Header {
	if (bytes.length >= 8 && u32be(bytes, 0) === 0x89504e47) {
		return readPng(bytes);
	}
	if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		return readJpeg(bytes);
	}
	if (
		bytes.length >= 16 &&
		ascii(bytes, 0, 4) === 'RIFF' &&
		ascii(bytes, 8, 4) === 'WEBP'
	) {
		return readWebp(bytes);
	}
	if (ascii(bytes, 0, 4) === 'GIF8') return { format: 'gif' };
	return { format: 'unknown' };
}

/** 画素数・辺長の上限を確認する（境界の値はちょうどまで許可） */
export function checkOcrDimensions(
	width: number,
	height: number,
): OcrInputCheck | null {
	if (!(width > 0 && height > 0)) {
		return fail('broken', OCR_INPUT_MESSAGES.broken);
	}
	if (width > MAX_OCR_EDGE || height > MAX_OCR_EDGE) {
		return fail(
			'too-large-dimension',
			`画像の一辺が${MAX_OCR_EDGE}pxを超えています（${width}×${height}px）。切り抜きや縮小をしてからお試しください。`,
		);
	}
	if (width * height > MAX_OCR_PIXELS) {
		return fail(
			'too-many-pixels',
			`画像の総画素数が${MAX_OCR_PIXELS.toLocaleString('ja-JP')}を超えています（${width}×${height}px）。切り抜きや縮小をしてからお試しください。`,
		);
	}
	return null;
}

/**
 * ファイルサイズだけで判定できる拒否（空・20MiB超）。内容を読む前に同期的に呼ぶ。
 * 20MiBちょうどは許可する。
 */
export function checkOcrFileSize(size: number): OcrInputCheck | null {
	if (size === 0) return fail('empty', OCR_INPUT_MESSAGES.empty);
	if (size > MAX_OCR_FILE_BYTES) {
		return fail('too-large-file', OCR_INPUT_MESSAGES.tooLargeFile);
	}
	return null;
}

/**
 * ファイルの中身（先頭バイトを含む全体）から形式・寸法・アニメーションを判定する。
 * 拡張子やMIMEは信用せず、ファイルのヘッダーだけで判断する。デコードはしない。
 */
export function inspectOcrImage(
	bytes: Uint8Array,
	size: number = bytes.length,
): OcrInputCheck {
	const sizeError = checkOcrFileSize(bytes.length === 0 ? 0 : size);
	if (sizeError) return sizeError;
	const header = readHeader(bytes);
	switch (header.format) {
		case 'unknown':
			return fail('unsupported-format', OCR_INPUT_MESSAGES.unsupported);
		case 'gif':
			return fail('gif', OCR_INPUT_MESSAGES.gif);
		case 'broken':
			return fail('broken', OCR_INPUT_MESSAGES.broken);
		default:
	}
	if (header.animated) return fail('animated', OCR_INPUT_MESSAGES.animated);
	const dimensionError = checkOcrDimensions(header.width, header.height);
	if (dimensionError) return dimensionError;
	return {
		ok: true,
		format: header.format,
		width: header.width,
		height: header.height,
	};
}

// ---------------------------------------------------------------------------
// 認識結果・TXT出力
// ---------------------------------------------------------------------------

export const EMPTY_RESULT_MESSAGE =
	'文字を読み取れませんでした。文字が小さい・薄い、または文字のない画像の可能性があります。切り抜いたり、解像度の高い画像でお試しください。';
export const TEXT_TOO_LONG_MESSAGE = `認識結果が長すぎます（上限は${MAX_OCR_TEXT_UNITS.toLocaleString('ja-JP')}文字相当）。画像を切り抜いて分けてお試しください。`;

/** 改行コードだけをLFへ統一する。文字の内容は変更しない */
export function normalizeNewlines(text: string): string {
	return text.replace(/\r\n?/g, '\n');
}

/** 文字数（コードポイント数）。サロゲートペアを1文字として数える */
export function countCharacters(text: string): number {
	let count = 0;
	for (const _ of text) count++;
	return count;
}

export function isBlankText(text: string): boolean {
	return text.trim() === '';
}

/**
 * コピー・保存してよいテキストか確認する（編集後にも適用）。問題があれば日本語メッセージ。
 * 空・空白のみは別途 isBlankText で判定する。
 */
export function validateOutputText(text: string): string | null {
	if (text.length > MAX_OCR_TEXT_UNITS) return TEXT_TOO_LONG_MESSAGE;
	return null;
}

/** 保存用のUTF-8（BOMなし）Blob。改行はLFに統一する */
export function buildTxtBlob(text: string): Blob {
	return new Blob([normalizeNewlines(text)], {
		type: 'text/plain;charset=utf-8',
	});
}

/** 画像のファイル名（拡張子を除く）。空なら既定名 */
export function imageBaseName(fileName: string): string {
	const base = fileName.replace(/\.[^./\\]+$/, '').trim();
	return base === '' ? 'image' : base;
}

export function txtFileName(baseName: string): string {
	return `${baseName}_ocr.txt`;
}
