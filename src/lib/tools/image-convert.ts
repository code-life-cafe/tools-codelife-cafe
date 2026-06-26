// image-convert.ts — 画像形式変換のコアロジック（純粋関数中心）
// 処理はすべてブラウザ内で完結し、画像はサーバーへ送信しない。
//
// デコード/エンコードはブラウザネイティブ（createImageBitmap / canvas.toBlob）を基本とし、
// WASM は HEIC デコード（libheif-js）と AVIF エンコード（@jsquash/avif）に限定する。
// これらは /image-convert でのみ dynamic import し、必要になった時だけ遅延ロードする。
//
// 形式判定・EXIF 抽出/再注入・バリデーション等の純粋ロジックは個別にエクスポートし
// unit test 対象とする。canvas/WASM 依存（decodeToBitmap / encode / convertOne）は E2E で検証する。

export type SourceFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'heic';
export type TargetFormat = 'jpeg' | 'png' | 'webp' | 'avif';
export type ExifMode = 'keep' | 'strip';

export type ConvertOptions = {
	target: TargetFormat;
	quality: number; // 0-100（PNGは無視）
	exif: ExifMode;
	background: string; // JPEG出力時の合成色（既定 '#ffffff'）
};

export type ConvertResult = {
	fileName: string; // {basename}.{ext}
	blob: Blob;
	sourceFormat: SourceFormat;
	warnings: string[];
};

export type ImageInputReason =
	| 'unsupported-type'
	| 'too-large'
	| 'too-many-files'
	| 'total-size-exceeded'
	| 'invalid-signature';

export type ImageInputValidation =
	| { ok: true; format: SourceFormat }
	| { ok: false; reason: ImageInputReason; message: string };

export type BatchValidation =
	| { ok: true }
	| {
			ok: false;
			reason: 'too-many-files' | 'total-size-exceeded';
			message: string;
	  };

// ---------------------------------------------------------------------------
// 上限値
// ---------------------------------------------------------------------------

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB/ファイル
export const MAX_BATCH_FILES = 30; // 30ファイル/回
export const MAX_TOTAL_INPUT_BYTES = 300 * 1024 * 1024; // 合計300MB

export const DEFAULT_QUALITY = 85;
export const DEFAULT_BACKGROUND = '#ffffff';

const EXT_BY_TARGET: Record<TargetFormat, string> = {
	jpeg: 'jpg',
	png: 'png',
	webp: 'webp',
	avif: 'avif',
};

const MIME_BY_TARGET: Record<TargetFormat, string> = {
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	avif: 'image/avif',
};

// ISO-BMFF（ftyp）の major/compatible brand 判定用
const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIC_BRANDS = new Set([
	'heic',
	'heix',
	'hevc',
	'hevx',
	'heim',
	'heis',
	'mif1',
	'msf1',
]);

// ---------------------------------------------------------------------------
// 形式判定（純粋）
// ---------------------------------------------------------------------------

function ascii(bytes: Uint8Array, start: number, len: number): string {
	let s = '';
	for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[start + i]);
	return s;
}

/**
 * 先頭バイト列のシグネチャから入力形式を判定する。判定不能なら null。
 * - PNG: 89 50 4E 47
 * - JPEG: FF D8 FF
 * - WebP: 'RIFF' .... 'WEBP'
 * - AVIF/HEIC: ISO-BMFF の 'ftyp' box の major/compatible brand で判定
 */
export function detectFormat(bytes: Uint8Array): SourceFormat | null {
	if (bytes.length < 12) return null;

	// PNG
	if (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	) {
		return 'png';
	}

	// JPEG
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'jpeg';
	}

	// WebP: 'RIFF'????'WEBP'
	if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
		return 'webp';
	}

	// ISO-BMFF: box[4..7] === 'ftyp'
	if (ascii(bytes, 4, 4) === 'ftyp') {
		const boxSize = readUint32BE(bytes, 0);
		// major brand（8..11）+ compatible brands（16 以降、4バイトごと）を走査
		const limit = Math.min(bytes.length, boxSize > 0 ? boxSize : bytes.length);
		const brands: string[] = [ascii(bytes, 8, 4)];
		for (let off = 16; off + 4 <= limit; off += 4) {
			brands.push(ascii(bytes, off, 4));
		}
		if (brands.some((b) => AVIF_BRANDS.has(b))) return 'avif';
		if (brands.some((b) => HEIC_BRANDS.has(b))) return 'heic';
	}

	return null;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
	return (
		((bytes[offset] << 24) |
			(bytes[offset + 1] << 16) |
			(bytes[offset + 2] << 8) |
			bytes[offset + 3]) >>>
		0
	);
}

// ---------------------------------------------------------------------------
// バリデーション
// ---------------------------------------------------------------------------

/**
 * 1ファイルの形式・サイズを検証する。形式はシグネチャで判定するため非同期。
 * 上限超過・判定不能はそれぞれ日本語メッセージを返す。
 */
export async function validateImageFile(
	file: File,
): Promise<ImageInputValidation> {
	if (file.size > MAX_FILE_SIZE_BYTES) {
		return {
			ok: false,
			reason: 'too-large',
			message: `${file.name}: ファイルサイズが50MBを超えています。`,
		};
	}
	const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
	const format = detectFormat(head);
	if (!format) {
		return {
			ok: false,
			reason: 'invalid-signature',
			message: `${file.name}: 対応していない形式です。PNG / JPEG / WebP / AVIF / HEIC を選択してください。`,
		};
	}
	return { ok: true, format };
}

/** 一括処理の枚数・合計サイズ上限を検証する（同期） */
export function validateBatch(files: readonly File[]): BatchValidation {
	if (files.length > MAX_BATCH_FILES) {
		return {
			ok: false,
			reason: 'too-many-files',
			message: `一度に処理できるのは${MAX_BATCH_FILES}ファイルまでです。`,
		};
	}
	const total = files.reduce((sum, f) => sum + f.size, 0);
	if (total > MAX_TOTAL_INPUT_BYTES) {
		return {
			ok: false,
			reason: 'total-size-exceeded',
			message: '選択したファイルの合計が300MBを超えています。',
		};
	}
	return { ok: true };
}

// ---------------------------------------------------------------------------
// ファイル名 / 形式メタ
// ---------------------------------------------------------------------------

export function extensionForTarget(target: TargetFormat): string {
	return EXT_BY_TARGET[target];
}

export function mimeForTarget(target: TargetFormat): string {
	return MIME_BY_TARGET[target];
}

/** 出力ファイル名 `{basename}.{ext}` を作る（元拡張子は置換） */
export function buildConvertedFilename(
	originalName: string,
	target: TargetFormat,
): string {
	const base = originalName.replace(/\.[^.]+$/, '') || 'image';
	return `${base}.${EXT_BY_TARGET[target]}`;
}

/** JPEG 出力など透過非対応の形式かどうか（背景色での塗りつぶしが必要） */
export function needsBackgroundFill(target: TargetFormat): boolean {
	return target === 'jpeg';
}

// ---------------------------------------------------------------------------
// EXIF（JPEG APP1）— ゼロ依存・純TS
// ---------------------------------------------------------------------------

const EXIF_IDENTIFIER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const ORIENTATION_TAG = 0x0112;

function hasExifIdentifier(bytes: Uint8Array, offset: number): boolean {
	for (let i = 0; i < EXIF_IDENTIFIER.length; i++) {
		if (bytes[offset + i] !== EXIF_IDENTIFIER[i]) return false;
	}
	return true;
}

/**
 * JPEG バイト列から APP1（EXIF）セグメント全体（マーカー FF E1 ＋ 長さ ＋ ペイロード）を
 * 抽出して返す。EXIF が無ければ null。
 */
export function extractExif(jpegBytes: Uint8Array): Uint8Array | null {
	if (jpegBytes.length < 4 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
		return null;
	}
	let i = 2;
	while (i + 4 <= jpegBytes.length) {
		if (jpegBytes[i] !== 0xff) break;
		const marker = jpegBytes[i + 1];
		// SOS（画像データ開始）/ EOI に達したら終了
		if (marker === 0xda || marker === 0xd9) break;
		// スタンドアロンマーカー（RSTn / TEM）は長さを持たない
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			i += 2;
			continue;
		}
		const segLen = (jpegBytes[i + 2] << 8) | jpegBytes[i + 3];
		if (segLen < 2) break;
		if (marker === 0xe1 && hasExifIdentifier(jpegBytes, i + 4)) {
			return jpegBytes.slice(i, i + 2 + segLen);
		}
		i += 2 + segLen;
	}
	return null;
}

/**
 * APP1（EXIF）セグメント内の IFD0 Orientation タグを 1 に正規化したコピーを返す。
 * デコード時に EXIF Orientation を画素へ反映済みのため、再注入時に二重回転を防ぐ。
 * 解析できない場合は入力のコピーをそのまま返す。
 */
export function normalizeExifOrientation(
	segment: Uint8Array,
): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(segment);
	// segment: [FF E1][len(2)]["Exif\0\0"(6)][TIFF...]
	const tiffStart = 10;
	if (out.length < tiffStart + 8) return out;

	const byteOrder = ascii(out, tiffStart, 2);
	const little = byteOrder === 'II';
	if (!little && byteOrder !== 'MM') return out;

	const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
	const readU16 = (abs: number) => view.getUint16(abs, little);
	const readU32 = (abs: number) => view.getUint32(abs, little);

	const ifd0Offset = readU32(tiffStart + 4);
	const ifd0 = tiffStart + ifd0Offset;
	if (ifd0 + 2 > out.length) return out;

	const count = readU16(ifd0);
	let entry = ifd0 + 2;
	for (let n = 0; n < count; n++) {
		if (entry + 12 > out.length) break;
		const tag = readU16(entry);
		if (tag === ORIENTATION_TAG) {
			// type SHORT(3)/count1 を前提に値フィールド先頭2バイトを 1 に書き換える
			view.setUint16(entry + 8, 1, little);
			break;
		}
		entry += 12;
	}
	return out;
}

/**
 * JPEG バイト列の SOI 直後に APP1（EXIF）セグメントを再注入する。
 * Orientation は 1 に正規化してから注入する（normalizeExifOrientation）。
 */
export function injectExif(
	jpegBytes: Uint8Array,
	exifSegment: Uint8Array,
): Uint8Array<ArrayBuffer> {
	if (jpegBytes.length < 2 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
		return new Uint8Array(jpegBytes);
	}
	const normalized = normalizeExifOrientation(exifSegment);
	const out = new Uint8Array(jpegBytes.length + normalized.length);
	out.set(jpegBytes.subarray(0, 2), 0); // SOI
	out.set(normalized, 2); // APP1
	out.set(jpegBytes.subarray(2), 2 + normalized.length);
	return out;
}

// ---------------------------------------------------------------------------
// canvas / WASM 依存（ブラウザ専用）
// ---------------------------------------------------------------------------

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function createCanvas(width: number, height: number): AnyCanvas {
	if (typeof OffscreenCanvas !== 'undefined') {
		return new OffscreenCanvas(width, height);
	}
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

function get2dContext(
	canvas: AnyCanvas,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
	const ctx = canvas.getContext('2d') as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!ctx) {
		throw new Error('Canvas 2D コンテキストの取得に失敗しました。');
	}
	return ctx;
}

function canvasToBlob(
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

/** HEIC を libheif-js（遅延ロード）でデコードし ImageData を得る */
async function decodeHeicToImageData(file: File): Promise<ImageData> {
	const { default: libheif } = await import('libheif-js/wasm-bundle');
	const buffer = new Uint8Array(await file.arrayBuffer());
	const decoder = new libheif.HeifDecoder();
	const images = decoder.decode(buffer);
	if (!images || images.length === 0) {
		throw new Error('HEICのデコードに失敗しました。');
	}
	const image = images[0]; // アニメーション/連写は先頭フレームのみ
	const width = image.get_width();
	const height = image.get_height();
	const imageData = new ImageData(width, height);
	await new Promise<void>((resolve, reject) => {
		image.display(imageData, (displayData) => {
			if (!displayData) reject(new Error('HEICの画素展開に失敗しました。'));
			else resolve();
		});
	});
	// libheif の画像バッファを解放する
	for (const img of images) img.free?.();
	return imageData;
}

/**
 * 入力ファイルを ImageBitmap にデコードする。
 * - PNG/JPEG/WebP/AVIF: createImageBitmap（JPEG等は EXIF Orientation を画素へ反映）
 * - HEIC: libheif-js で RGBA 展開 → ImageData → ImageBitmap
 */
export async function decodeToBitmap(
	file: File,
	format: SourceFormat,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
	try {
		if (format === 'heic') {
			const imageData = await decodeHeicToImageData(file);
			const bitmap = await createImageBitmap(imageData);
			return { bitmap, width: bitmap.width, height: bitmap.height };
		}
		const bitmap = await createImageBitmap(file, {
			imageOrientation: 'from-image',
		});
		return { bitmap, width: bitmap.width, height: bitmap.height };
	} catch (err) {
		if (err instanceof Error && err.message.startsWith('HEIC')) throw err;
		throw new Error(
			'画像のデコードに失敗しました。ファイルが破損しているか、ブラウザが対応していない形式です。',
		);
	}
}

/** ビットマップを canvas に描画する（JPEG出力時のみ背景色で透過を合成） */
function drawToCanvas(
	bitmap: ImageBitmap,
	target: TargetFormat,
	background: string,
): AnyCanvas {
	const canvas = createCanvas(bitmap.width, bitmap.height);
	const ctx = get2dContext(canvas);
	ctx.imageSmoothingQuality = 'high';
	if (needsBackgroundFill(target)) {
		ctx.fillStyle = background || DEFAULT_BACKGROUND;
		ctx.fillRect(0, 0, bitmap.width, bitmap.height);
	}
	ctx.drawImage(bitmap, 0, 0);
	return canvas;
}

/**
 * ビットマップを目標形式へエンコードする。
 * - JPEG/PNG/WebP: canvas.toBlob（quality は 0-100 を 0-1 に変換、PNGは無視）
 * - AVIF: @jsquash/avif（遅延ロード）で encode（quality 0-100 をそのまま反映）
 */
export async function encode(
	bitmap: ImageBitmap,
	target: TargetFormat,
	opts: Pick<ConvertOptions, 'quality' | 'background'>,
): Promise<Blob> {
	const canvas = drawToCanvas(bitmap, target, opts.background);

	if (target === 'avif') {
		const ctx = get2dContext(canvas);
		const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
		// encode サブモジュールを直接 import（index 経由だと AVIF デコーダも巻き込まれるため）
		const { default: encodeAvif } = await import('@jsquash/avif/encode');
		const buffer = await encodeAvif(imageData, {
			quality: clampQuality(opts.quality),
		});
		return new Blob([buffer], { type: 'image/avif' });
	}

	const mime = MIME_BY_TARGET[target];
	const quality01 = clampQuality(opts.quality) / 100;
	const blob = await canvasToBlob(canvas, mime, quality01);
	if (!blob) {
		throw new Error(
			'画像の書き出しに失敗しました。ブラウザがこの形式に対応していない可能性があります。',
		);
	}
	// 非対応形式（例: 旧Safariの WebP）では toBlob が要求と異なる形式（多くは PNG）を返すため、
	// 拡張子と中身が食い違ったファイルを出力しないよう、実際の出力形式が一致することを検証する。
	if (blob.type !== mime) {
		throw new Error(
			`このブラウザは ${target.toUpperCase()} 形式の書き出しに対応していません。別の出力形式を選択してください。`,
		);
	}
	return blob;
}

function clampQuality(quality: number): number {
	if (Number.isNaN(quality)) return DEFAULT_QUALITY;
	return Math.min(100, Math.max(0, Math.round(quality)));
}

// ---------------------------------------------------------------------------
// 変換（オーケストレーション）
// ---------------------------------------------------------------------------

/** 1ファイルを変換する。EXIF keep は JPEG→JPEG のみ実効（他は注意警告のみ）。 */
export async function convertOne(
	file: File,
	opts: ConvertOptions,
): Promise<ConvertResult> {
	const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
	const sourceFormat = detectFormat(head);
	if (!sourceFormat) {
		throw new Error('対応していない画像形式です。');
	}

	const warnings: string[] = [];
	const { bitmap } = await decodeToBitmap(file, sourceFormat);
	try {
		let blob = await encode(bitmap, opts.target, opts);

		if (opts.exif === 'keep') {
			if (opts.target === 'jpeg' && sourceFormat === 'jpeg') {
				const srcBytes = new Uint8Array(await file.arrayBuffer());
				const exif = extractExif(srcBytes);
				if (exif) {
					const outBytes = new Uint8Array(await blob.arrayBuffer());
					blob = new Blob([injectExif(outBytes, exif)], {
						type: 'image/jpeg',
					});
				} else {
					warnings.push(
						'元画像にEXIFが無いため、保持できるメタデータはありませんでした。',
					);
				}
			} else if (opts.target !== 'jpeg') {
				warnings.push(
					'EXIF保持はJPEG出力でのみ確実です。この形式ではメタデータは保持されません。',
				);
			} else {
				warnings.push(
					'元がJPEG以外のため、EXIFは保持されません（再エンコードで除去されます）。',
				);
			}
		}

		return {
			fileName: buildConvertedFilename(file.name, opts.target),
			blob,
			sourceFormat,
			warnings,
		};
	} finally {
		bitmap.close();
	}
}

/**
 * 複数ファイルを逐次変換する。onProgress(done, total) で進捗を通知し、
 * 各ファイル処理後にイベントループへ yield して UI フリーズを防ぐ。
 */
export async function convertBatch(
	files: readonly File[],
	opts: ConvertOptions,
	onProgress?: (done: number, total: number) => void,
): Promise<ConvertResult[]> {
	const results: ConvertResult[] = [];
	for (let i = 0; i < files.length; i++) {
		results.push(await convertOne(files[i], opts));
		onProgress?.(i + 1, files.length);
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	return results;
}
