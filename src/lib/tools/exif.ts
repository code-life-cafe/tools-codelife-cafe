// exif.ts — EXIF 表示・削除のコアロジック（純粋関数中心）
// 処理はすべてブラウザ内で完結し、画像はサーバーへ送信しない。
//
// TIFF IFD パースは DataView でゼロ依存実装。
// メタデータ除去は JPEG セグメント除去（ピクセル非改変）を基本とし、
// WebP/TIFF は Canvas 再エンコードにフォールバックする。

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export type GpsCoord = { lat: number; lng: number; altitude?: number };

export type ExifTag = {
	tagId: number;
	label: string;
	value: string;
	group: 'camera' | 'datetime' | 'gps' | 'other';
};

export type ExifData = {
	hasExif: boolean;
	hasGps: boolean;
	hasOtherMetadata: boolean;
	gps?: GpsCoord;
	tags: ExifTag[];
	orientation?: number;
};

export type ImageInputValidation =
	| { ok: true; format: 'jpeg' | 'tiff' | 'webp' }
	| {
			ok: false;
			reason:
				| 'unsupported-type'
				| 'too-large'
				| 'too-many-files'
				| 'total-size-exceeded'
				| 'invalid-signature';
			message: string;
	  };

export type BatchValidation =
	| { ok: true }
	| {
			ok: false;
			reason: 'too-many-files' | 'total-size-exceeded';
			message: string;
	  };

export type StripResult = {
	data: Uint8Array;
	warnings: string[];
	stripped: boolean;
};

// ---------------------------------------------------------------------------
// 上限値
// ---------------------------------------------------------------------------

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_BATCH_FILES = 30;
export const MAX_TOTAL_INPUT_BYTES = 300 * 1024 * 1024;

// ---------------------------------------------------------------------------
// TIFF 型サイズ
// ---------------------------------------------------------------------------

const TIFF_TYPE_SIZE: Record<number, number> = {
	1: 1, // BYTE
	2: 1, // ASCII
	3: 2, // SHORT
	4: 4, // LONG
	5: 8, // RATIONAL (2×LONG)
	7: 1, // UNDEFINED
	9: 4, // SLONG
	10: 8, // SRATIONAL
};

const MAX_IFD_DEPTH = 4;

// ---------------------------------------------------------------------------
// タグ定義
// ---------------------------------------------------------------------------

type TagDef = {
	label: string;
	group: ExifTag['group'];
	format?: (v: string) => string;
};

const IFD0_TAGS: Record<number, TagDef> = {
	271: { label: 'メーカー', group: 'camera' },
	272: { label: 'モデル', group: 'camera' },
	274: { label: '回転情報', group: 'other' },
	305: { label: 'ソフトウェア', group: 'other' },
};

const EXIF_IFD_TAGS: Record<number, TagDef> = {
	36867: { label: '撮影日時', group: 'datetime' },
	33434: {
		label: 'シャッター速度',
		group: 'camera',
		format: (v) => `${v}秒`,
	},
	33437: { label: '絞り値', group: 'camera', format: (v) => `f/${v}` },
	34855: { label: 'ISO感度', group: 'camera', format: (v) => `ISO ${v}` },
	37386: {
		label: '焦点距離',
		group: 'camera',
		format: (v) => `${v}mm`,
	},
	42036: { label: 'レンズ', group: 'camera' },
};

const GPS_TAGS: Record<number, TagDef> = {
	1: { label: '緯度基準', group: 'gps' },
	2: { label: '緯度', group: 'gps' },
	3: { label: '経度基準', group: 'gps' },
	4: { label: '経度', group: 'gps' },
	5: { label: '高度基準', group: 'gps' },
	6: { label: '高度', group: 'gps' },
};

// ---------------------------------------------------------------------------
// APP1/APP13 識別子
// ---------------------------------------------------------------------------

const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const XMP_ID_STR = 'http://ns.adobe.com/xap/1.0/\0';
const IPTC_ID_STR = 'Photoshop 3.0\0';

function matchBytes(
	data: Uint8Array,
	offset: number,
	pattern: number[],
): boolean {
	if (offset + pattern.length > data.length) return false;
	for (let i = 0; i < pattern.length; i++) {
		if (data[offset + i] !== pattern[i]) return false;
	}
	return true;
}

function matchAscii(data: Uint8Array, offset: number, str: string): boolean {
	if (offset + str.length > data.length) return false;
	for (let i = 0; i < str.length; i++) {
		if (data[offset + i] !== str.charCodeAt(i)) return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// バリデーション
// ---------------------------------------------------------------------------

function detectFormat(bytes: Uint8Array): 'jpeg' | 'tiff' | 'webp' | null {
	if (bytes.length < 4) return null;
	// JPEG: FF D8 FF
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'jpeg';
	}
	// TIFF: "II" 2A 00 or "MM" 00 2A
	if (
		(bytes[0] === 0x49 &&
			bytes[1] === 0x49 &&
			bytes[2] === 0x2a &&
			bytes[3] === 0x00) ||
		(bytes[0] === 0x4d &&
			bytes[1] === 0x4d &&
			bytes[2] === 0x00 &&
			bytes[3] === 0x2a)
	) {
		return 'tiff';
	}
	// WebP: "RIFF" .... "WEBP"
	if (bytes.length >= 12) {
		const riff =
			bytes[0] === 0x52 &&
			bytes[1] === 0x49 &&
			bytes[2] === 0x46 &&
			bytes[3] === 0x46;
		const webp =
			bytes[8] === 0x57 &&
			bytes[9] === 0x45 &&
			bytes[10] === 0x42 &&
			bytes[11] === 0x50;
		if (riff && webp) return 'webp';
	}
	return null;
}

export async function validateImageFile(
	file: File,
): Promise<ImageInputValidation> {
	if (file.size > MAX_FILE_SIZE_BYTES) {
		return {
			ok: false,
			reason: 'too-large',
			message: `ファイルサイズが上限（50MB）を超えています: ${file.name}`,
		};
	}
	const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	const format = detectFormat(head);
	if (!format) {
		return {
			ok: false,
			reason: 'invalid-signature',
			message: `対応していない画像形式です: ${file.name}`,
		};
	}
	return { ok: true, format };
}

export function validateBatch(files: FileList | File[]): BatchValidation {
	const list = Array.from(files);
	if (list.length > MAX_BATCH_FILES) {
		return {
			ok: false,
			reason: 'too-many-files',
			message: `一度に処理できるファイルは${MAX_BATCH_FILES}枚までです（${list.length}枚選択されています）`,
		};
	}
	const total = list.reduce((sum, f) => sum + f.size, 0);
	if (total > MAX_TOTAL_INPUT_BYTES) {
		return {
			ok: false,
			reason: 'total-size-exceeded',
			message: `合計ファイルサイズが上限（300MB）を超えています`,
		};
	}
	return { ok: true };
}

// ---------------------------------------------------------------------------
// TIFF IFD パーサ（内部）
// ---------------------------------------------------------------------------

type IfdContext = {
	view: DataView;
	tiffStart: number;
	tiffLength: number;
	little: boolean;
	visited: Set<number>;
};

function readU16(ctx: IfdContext, abs: number): number {
	return ctx.view.getUint16(abs, ctx.little);
}

function readU32(ctx: IfdContext, abs: number): number {
	return ctx.view.getUint32(abs, ctx.little);
}

function readS32(ctx: IfdContext, abs: number): number {
	return ctx.view.getInt32(abs, ctx.little);
}

function inBounds(ctx: IfdContext, abs: number, size: number): boolean {
	return abs >= ctx.tiffStart && abs + size <= ctx.tiffStart + ctx.tiffLength;
}

function readRational(ctx: IfdContext, abs: number): number {
	if (!inBounds(ctx, abs, 8)) return 0;
	const num = readU32(ctx, abs);
	const den = readU32(ctx, abs + 4);
	return den === 0 ? 0 : num / den;
}

function readSRational(ctx: IfdContext, abs: number): number {
	if (!inBounds(ctx, abs, 8)) return 0;
	const num = readS32(ctx, abs);
	const den = readS32(ctx, abs + 4);
	return den === 0 ? 0 : num / den;
}

function readAscii(data: Uint8Array, offset: number, count: number): string {
	let s = '';
	const end = Math.min(offset + count, data.length);
	for (let i = offset; i < end; i++) {
		const c = data[i];
		if (c === 0) break;
		s += String.fromCharCode(c);
	}
	return s;
}

function readTagValue(
	ctx: IfdContext,
	data: Uint8Array,
	entryAbs: number,
): { type: number; count: number; strVal: string; ratVal: number } {
	const type = readU16(ctx, entryAbs + 2);
	const count = readU32(ctx, entryAbs + 4);
	const typeSize = TIFF_TYPE_SIZE[type] ?? 1;

	if (count > 1_000_000 || typeSize === 0) {
		return { type, count, strVal: '', ratVal: 0 };
	}

	const totalSize = count * typeSize;
	let valAbs: number;
	if (totalSize <= 4) {
		valAbs = entryAbs + 8;
	} else {
		const offset = readU32(ctx, entryAbs + 8);
		valAbs = ctx.tiffStart + offset;
	}

	if (!inBounds(ctx, valAbs, Math.min(totalSize, 4096))) {
		return { type, count, strVal: '', ratVal: 0 };
	}

	if (type === 2) {
		// ASCII
		return {
			type,
			count,
			strVal: readAscii(data, valAbs, count),
			ratVal: 0,
		};
	}
	if (type === 3) {
		// SHORT
		return {
			type,
			count,
			strVal: String(readU16(ctx, valAbs)),
			ratVal: readU16(ctx, valAbs),
		};
	}
	if (type === 4) {
		// LONG
		return {
			type,
			count,
			strVal: String(readU32(ctx, valAbs)),
			ratVal: readU32(ctx, valAbs),
		};
	}
	if (type === 5) {
		// RATIONAL
		const r = readRational(ctx, valAbs);
		const num = readU32(ctx, valAbs);
		const den = readU32(ctx, valAbs + 4);
		const display = den === 0 ? '0' : den === 1 ? String(num) : `${num}/${den}`;
		return { type, count, strVal: display, ratVal: r };
	}
	if (type === 10) {
		// SRATIONAL
		const r = readSRational(ctx, valAbs);
		return { type, count, strVal: String(r), ratVal: r };
	}
	if (type === 1 || type === 7) {
		// BYTE / UNDEFINED
		return {
			type,
			count,
			strVal: String(data[valAbs]),
			ratVal: data[valAbs],
		};
	}
	if (type === 9) {
		// SLONG
		const v = readS32(ctx, valAbs);
		return { type, count, strVal: String(v), ratVal: v };
	}
	return { type, count, strVal: '', ratVal: 0 };
}

function readGpsRationals(
	ctx: IfdContext,
	entryAbs: number,
): [number, number, number] | null {
	const count = readU32(ctx, entryAbs + 4);
	if (count !== 3) return null;
	const totalSize = 3 * 8;
	let valAbs: number;
	if (totalSize <= 4) {
		valAbs = entryAbs + 8;
	} else {
		const offset = readU32(ctx, entryAbs + 8);
		valAbs = ctx.tiffStart + offset;
	}
	if (!inBounds(ctx, valAbs, 24)) return null;
	return [
		readRational(ctx, valAbs),
		readRational(ctx, valAbs + 8),
		readRational(ctx, valAbs + 16),
	];
}

type ParsedIfd = {
	tags: ExifTag[];
	exifIfdOffset?: number;
	gpsIfdOffset?: number;
	orientation?: number;
};

function parseIfd(
	ctx: IfdContext,
	data: Uint8Array,
	ifdAbs: number,
	tagDefs: Record<number, TagDef>,
	depth: number,
): ParsedIfd {
	const result: ParsedIfd = { tags: [] };
	if (depth > MAX_IFD_DEPTH) return result;

	const relOffset = ifdAbs - ctx.tiffStart;
	if (ctx.visited.has(relOffset)) return result;
	ctx.visited.add(relOffset);

	if (!inBounds(ctx, ifdAbs, 2)) return result;
	const count = readU16(ctx, ifdAbs);
	if (count > 1000) return result;

	let entry = ifdAbs + 2;
	for (let n = 0; n < count; n++) {
		if (!inBounds(ctx, entry, 12)) break;
		const tagId = readU16(ctx, entry);

		if (tagId === 0x8769) {
			result.exifIfdOffset = readU32(ctx, entry + 8);
		} else if (tagId === 0x8825) {
			result.gpsIfdOffset = readU32(ctx, entry + 8);
		}

		if (tagId === 0x0112) {
			const v = readTagValue(ctx, data, entry);
			result.orientation = v.ratVal;
		}

		const def = tagDefs[tagId];
		if (def) {
			const v = readTagValue(ctx, data, entry);
			let displayValue = v.strVal;
			if (def.format) displayValue = def.format(displayValue);
			result.tags.push({
				tagId,
				label: def.label,
				value: displayValue,
				group: def.group,
			});
		}

		entry += 12;
	}
	return result;
}

// ---------------------------------------------------------------------------
// GPS 変換
// ---------------------------------------------------------------------------

function dmsToDecimal(dms: [number, number, number], ref: string): number {
	const [deg, min, sec] = dms;
	let decimal = deg + min / 60 + sec / 3600;
	if (ref === 'S' || ref === 'W') decimal = -decimal;
	return decimal;
}

type GpsRawData = {
	latRef?: string;
	latDms?: [number, number, number];
	lngRef?: string;
	lngDms?: [number, number, number];
	altRef?: number;
	alt?: number;
};

function parseGpsIfd(
	ctx: IfdContext,
	data: Uint8Array,
	ifdAbs: number,
	depth: number,
): { tags: ExifTag[]; gps?: GpsCoord } {
	const tags: ExifTag[] = [];
	const raw: GpsRawData = {};

	if (depth > MAX_IFD_DEPTH) return { tags };

	const relOffset = ifdAbs - ctx.tiffStart;
	if (ctx.visited.has(relOffset)) return { tags };
	ctx.visited.add(relOffset);

	if (!inBounds(ctx, ifdAbs, 2)) return { tags };
	const count = readU16(ctx, ifdAbs);
	if (count > 1000) return { tags };

	let entry = ifdAbs + 2;
	for (let n = 0; n < count; n++) {
		if (!inBounds(ctx, entry, 12)) break;
		const tagId = readU16(ctx, entry);

		if (tagId === 0x0001) {
			const v = readTagValue(ctx, data, entry);
			raw.latRef = v.strVal;
		} else if (tagId === 0x0002) {
			raw.latDms = readGpsRationals(ctx, entry) ?? undefined;
		} else if (tagId === 0x0003) {
			const v = readTagValue(ctx, data, entry);
			raw.lngRef = v.strVal;
		} else if (tagId === 0x0004) {
			raw.lngDms = readGpsRationals(ctx, entry) ?? undefined;
		} else if (tagId === 0x0005) {
			const v = readTagValue(ctx, data, entry);
			raw.altRef = v.ratVal;
		} else if (tagId === 0x0006) {
			const v = readTagValue(ctx, data, entry);
			raw.alt = v.ratVal;
		}

		const def = GPS_TAGS[tagId];
		if (def) {
			const v = readTagValue(ctx, data, entry);
			tags.push({
				tagId,
				label: def.label,
				value: v.strVal,
				group: 'gps',
			});
		}

		entry += 12;
	}

	let gps: GpsCoord | undefined;
	if (raw.latDms && raw.lngDms && raw.latRef && raw.lngRef) {
		const lat = dmsToDecimal(raw.latDms, raw.latRef);
		const lng = dmsToDecimal(raw.lngDms, raw.lngRef);
		gps = { lat, lng };
		if (raw.alt != null) {
			gps.altitude = raw.altRef === 1 ? -raw.alt : raw.alt;
		}

		tags.push({
			tagId: 0xf001,
			label: '緯度（十進）',
			value: `${lat.toFixed(6)}°`,
			group: 'gps',
		});
		tags.push({
			tagId: 0xf002,
			label: '経度（十進）',
			value: `${lng.toFixed(6)}°`,
			group: 'gps',
		});
		if (gps.altitude != null) {
			tags.push({
				tagId: 0xf003,
				label: '高度',
				value: `${gps.altitude.toFixed(1)}m`,
				group: 'gps',
			});
		}
	}

	return { tags, gps };
}

// ---------------------------------------------------------------------------
// parseExif（公開）
// ---------------------------------------------------------------------------

const EMPTY_EXIF: ExifData = {
	hasExif: false,
	hasGps: false,
	hasOtherMetadata: false,
	tags: [],
};

function findExifApp1(bytes: Uint8Array): {
	tiffStart: number;
	tiffLength: number;
	hasOtherMetadata: boolean;
} | null {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
		return null;
	}
	let tiffStart = -1;
	let tiffLength = 0;
	let hasOtherMetadata = false;

	let i = 2;
	while (i + 4 <= bytes.length) {
		if (bytes[i] !== 0xff) break;
		// fill bytes: skip consecutive 0xFF before the actual marker byte
		while (i + 1 < bytes.length && bytes[i + 1] === 0xff) i++;
		const marker = bytes[i + 1];
		if (marker === 0xda || marker === 0xd9) break;
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			i += 2;
			continue;
		}
		if (i + 4 > bytes.length) break;
		const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
		if (segLen < 2) break;
		const payloadStart = i + 4;
		if (marker === 0xe1) {
			if (matchBytes(bytes, payloadStart, EXIF_ID) && tiffStart < 0) {
				tiffStart = payloadStart + 6;
				tiffLength = segLen - 2 - 6;
			} else if (matchAscii(bytes, payloadStart, XMP_ID_STR)) {
				hasOtherMetadata = true;
			}
		} else if (marker === 0xed) {
			if (matchAscii(bytes, payloadStart, IPTC_ID_STR)) {
				hasOtherMetadata = true;
			}
		} else if (marker === 0xfe) {
			hasOtherMetadata = true;
		}
		i += 2 + segLen;
	}
	if (tiffStart < 0 || tiffLength < 8) {
		if (hasOtherMetadata)
			return { tiffStart: -1, tiffLength: 0, hasOtherMetadata };
		return null;
	}
	return { tiffStart, tiffLength, hasOtherMetadata };
}

function parseTiffFromHeader(
	bytes: Uint8Array,
	tiffStart: number,
	tiffLength: number,
): ExifData | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	const bo0 = bytes[tiffStart];
	const bo1 = bytes[tiffStart + 1];
	const little = bo0 === 0x49 && bo1 === 0x49;
	if (!little && !(bo0 === 0x4d && bo1 === 0x4d)) return null;

	const ctx: IfdContext = {
		view,
		tiffStart,
		tiffLength,
		little,
		visited: new Set(),
	};

	const magic = readU16(ctx, tiffStart + 2);
	if (magic !== 0x002a) return null;

	const ifd0Offset = readU32(ctx, tiffStart + 4);
	const ifd0Abs = tiffStart + ifd0Offset;

	const ifd0 = parseIfd(ctx, bytes, ifd0Abs, IFD0_TAGS, 0);
	const allTags: ExifTag[] = [...ifd0.tags];
	let orientation = ifd0.orientation;
	let gps: GpsCoord | undefined;

	if (ifd0.exifIfdOffset != null) {
		const exifAbs = tiffStart + ifd0.exifIfdOffset;
		const exifIfd = parseIfd(ctx, bytes, exifAbs, EXIF_IFD_TAGS, 1);
		allTags.push(...exifIfd.tags);
		if (orientation == null) orientation = exifIfd.orientation;
	}

	if (ifd0.gpsIfdOffset != null) {
		const gpsAbs = tiffStart + ifd0.gpsIfdOffset;
		const gpsResult = parseGpsIfd(ctx, bytes, gpsAbs, 1);
		allTags.push(...gpsResult.tags);
		gps = gpsResult.gps;
	}

	return {
		hasExif: allTags.length > 0 || orientation != null,
		hasGps: gps != null,
		hasOtherMetadata: false,
		gps,
		tags: allTags,
		orientation,
	};
}

function findWebpExifChunk(
	bytes: Uint8Array,
): { tiffStart: number; tiffLength: number } | null {
	if (bytes.length < 12) return null;
	let i = 12; // skip "RIFF" + size + "WEBP"
	while (i + 8 <= bytes.length) {
		const fourcc =
			String.fromCharCode(bytes[i]) +
			String.fromCharCode(bytes[i + 1]) +
			String.fromCharCode(bytes[i + 2]) +
			String.fromCharCode(bytes[i + 3]);
		const chunkSize =
			bytes[i + 4] |
			(bytes[i + 5] << 8) |
			(bytes[i + 6] << 16) |
			(bytes[i + 7] << 24);
		if (chunkSize < 0) break;
		const dataStart = i + 8;
		if (fourcc === 'EXIF') {
			let tiffOff = dataStart;
			let tiffLen = chunkSize;
			// some WebP EXIF chunks have "Exif\0\0" prefix
			if (matchBytes(bytes, tiffOff, EXIF_ID)) {
				tiffOff += 6;
				tiffLen -= 6;
			}
			if (tiffLen >= 8) return { tiffStart: tiffOff, tiffLength: tiffLen };
		}
		// chunks are 2-byte aligned
		i = dataStart + chunkSize + (chunkSize % 2);
	}
	return null;
}

export function parseExif(bytes: Uint8Array): ExifData {
	try {
		const format = detectFormat(bytes);

		// TIFF: the file itself is a TIFF IFD structure
		if (format === 'tiff') {
			return parseTiffFromHeader(bytes, 0, bytes.length) ?? EMPTY_EXIF;
		}

		// WebP: find EXIF chunk in RIFF container
		if (format === 'webp') {
			const chunk = findWebpExifChunk(bytes);
			if (!chunk) return EMPTY_EXIF;
			return (
				parseTiffFromHeader(bytes, chunk.tiffStart, chunk.tiffLength) ??
				EMPTY_EXIF
			);
		}

		// JPEG: scan for APP1 Exif segment + detect XMP/IPTC/COM
		const app1 = findExifApp1(bytes);
		if (!app1) return EMPTY_EXIF;

		if (app1.tiffStart < 0) {
			// no Exif APP1 but other metadata detected
			return { ...EMPTY_EXIF, hasOtherMetadata: app1.hasOtherMetadata };
		}

		const result = parseTiffFromHeader(bytes, app1.tiffStart, app1.tiffLength);
		if (!result) {
			return { ...EMPTY_EXIF, hasOtherMetadata: app1.hasOtherMetadata };
		}
		result.hasOtherMetadata = app1.hasOtherMetadata;
		return result;
	} catch {
		return EMPTY_EXIF;
	}
}

// ---------------------------------------------------------------------------
// hasGps（公開）
// ---------------------------------------------------------------------------

export function hasGps(exif: ExifData): boolean {
	return exif.hasGps;
}

// ---------------------------------------------------------------------------
// stripMetadata（公開）— JPEG セグメント除去（純粋関数）
// ---------------------------------------------------------------------------

export function stripMetadata(
	bytes: Uint8Array,
	format: 'jpeg' | 'tiff' | 'webp',
): StripResult {
	if (format !== 'jpeg') {
		return {
			data: bytes,
			warnings: [
				'この形式ではメタデータのロスレス削除ができないため、再エンコードが必要です。',
			],
			stripped: false,
		};
	}

	return stripJpegMetadata(bytes);
}

function isExifApp1(data: Uint8Array, payloadStart: number): boolean {
	return matchBytes(data, payloadStart, EXIF_ID);
}

function isXmpApp1(data: Uint8Array, payloadStart: number): boolean {
	return matchAscii(data, payloadStart, XMP_ID_STR);
}

function isIptcApp13(data: Uint8Array, payloadStart: number): boolean {
	return matchAscii(data, payloadStart, IPTC_ID_STR);
}

function stripJpegMetadata(bytes: Uint8Array): StripResult {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
		return {
			data: bytes,
			warnings: ['JPEG形式ではありません'],
			stripped: false,
		};
	}

	const chunks: Uint8Array[] = [];
	chunks.push(bytes.subarray(0, 2)); // SOI

	let i = 2;
	const warnings: string[] = [];

	while (i + 4 <= bytes.length) {
		if (bytes[i] !== 0xff) {
			chunks.push(bytes.subarray(i));
			break;
		}
		// fill bytes: skip consecutive 0xFF before the marker byte
		const fillStart = i;
		while (i + 1 < bytes.length && bytes[i + 1] === 0xff) i++;
		const marker = bytes[i + 1];

		if (marker === 0xda) {
			chunks.push(bytes.subarray(fillStart));
			break;
		}
		if (marker === 0xd9) {
			chunks.push(bytes.subarray(fillStart, i + 2));
			break;
		}

		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			chunks.push(bytes.subarray(fillStart, i + 2));
			i += 2;
			continue;
		}

		if (i + 4 > bytes.length) {
			chunks.push(bytes.subarray(fillStart));
			break;
		}
		const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
		if (segLen < 2) {
			chunks.push(bytes.subarray(fillStart));
			break;
		}

		const segEnd = i + 2 + segLen;
		const payloadStart = i + 4;
		let skip = false;

		if (marker === 0xe1) {
			if (isExifApp1(bytes, payloadStart) || isXmpApp1(bytes, payloadStart)) {
				skip = true;
			}
		} else if (marker === 0xed) {
			if (isIptcApp13(bytes, payloadStart)) {
				skip = true;
			}
		} else if (marker === 0xfe) {
			// COM (comment) segment
			skip = true;
		}

		if (!skip) {
			chunks.push(bytes.subarray(fillStart, segEnd));
		}

		i = segEnd;
	}

	let totalLen = 0;
	for (const c of chunks) totalLen += c.length;
	const result = new Uint8Array(totalLen);
	let offset = 0;
	for (const c of chunks) {
		result.set(c, offset);
		offset += c.length;
	}

	return { data: result, warnings, stripped: true };
}

// ---------------------------------------------------------------------------
// Orientation 焼き込み（ブラウザ専用ヘルパー）
// ---------------------------------------------------------------------------

type OriDef = {
	cw: (w: number, h: number) => number;
	ch: (w: number, h: number) => number;
	apply: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
};

const ORIENTATION_DEFS: Record<number, OriDef> = {
	2: {
		cw: (w) => w,
		ch: (_, h) => h,
		apply: (ctx, w) => ctx.transform(-1, 0, 0, 1, w, 0),
	},
	3: {
		cw: (w) => w,
		ch: (_, h) => h,
		apply: (ctx, w, h) => ctx.transform(-1, 0, 0, -1, w, h),
	},
	4: {
		cw: (w) => w,
		ch: (_, h) => h,
		apply: (ctx, _, h) => ctx.transform(1, 0, 0, -1, 0, h),
	},
	5: {
		cw: (_, h) => h,
		ch: (w) => w,
		apply: (ctx) => ctx.transform(0, 1, 1, 0, 0, 0),
	},
	6: {
		cw: (_, h) => h,
		ch: (w) => w,
		apply: (ctx, _, h) => ctx.transform(0, 1, -1, 0, h, 0),
	},
	7: {
		cw: (_, h) => h,
		ch: (w) => w,
		apply: (ctx, w, h) => ctx.transform(0, -1, -1, 0, h, w),
	},
	8: {
		cw: (_, h) => h,
		ch: (w) => w,
		apply: (ctx, w) => ctx.transform(0, -1, 1, 0, 0, w),
	},
};

export async function bakeOrientation(
	bytes: Uint8Array,
	orientation: number,
): Promise<Uint8Array<ArrayBuffer>> {
	const def = ORIENTATION_DEFS[orientation];
	if (!def) return new Uint8Array(bytes);

	const blob = new Blob([bytes.slice()], { type: 'image/jpeg' });
	// imageOrientation: 'none' でブラウザによる自動回転を抑止し二重回転を防ぐ
	const bmp = await createImageBitmap(blob, {
		imageOrientation: 'none',
	});
	const w = bmp.width;
	const h = bmp.height;

	const canvas = document.createElement('canvas');
	canvas.width = def.cw(w, h);
	canvas.height = def.ch(w, h);

	const ctx = canvas.getContext('2d');
	if (!ctx) {
		bmp.close();
		return new Uint8Array(bytes);
	}
	def.apply(ctx, w, h);
	ctx.drawImage(bmp, 0, 0);
	bmp.close();

	const outBlob: Blob | null = await new Promise((resolve) =>
		canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.95),
	);
	if (!outBlob || outBlob.size === 0) {
		throw new Error(
			'Canvas のエクスポートに失敗しました（画像サイズが大きすぎる可能性があります）',
		);
	}
	return new Uint8Array(await outBlob.arrayBuffer());
}
