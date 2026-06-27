// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/exif.test.ts
//
// Canvas/Blob 依存（bakeOrientation）はブラウザ専用のため E2E で検証する。
// ここでは純粋ロジック（バリデーション・EXIF パース・メタデータ除去）を対象とする。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	MAX_BATCH_FILES,
	parseExif,
	stripMetadata,
	validateBatch,
} from '../../src/lib/tools/exif.ts';

// ---------------------------------------------------------------------------
// テスト用バイト列ビルダ
// ---------------------------------------------------------------------------

function u16be(v: number): number[] {
	return [(v >> 8) & 0xff, v & 0xff];
}

function u16le(v: number): number[] {
	return [v & 0xff, (v >> 8) & 0xff];
}

function u32be(v: number): number[] {
	return [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function u32le(v: number): number[] {
	return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
}

function asciiBytes(s: string): number[] {
	return Array.from(s).map((c) => c.charCodeAt(0));
}

type ByteOrder = 'II' | 'MM';

function u16(v: number, bo: ByteOrder): number[] {
	return bo === 'II' ? u16le(v) : u16be(v);
}

function u32(v: number, bo: ByteOrder): number[] {
	return bo === 'II' ? u32le(v) : u32be(v);
}

// IFD entry: tag(2) + type(2) + count(4) + value/offset(4) = 12 bytes
function ifdEntry(
	bo: ByteOrder,
	tag: number,
	type: number,
	count: number,
	valueOrOffset: number,
): number[] {
	return [
		...u16(tag, bo),
		...u16(type, bo),
		...u32(count, bo),
		...u32(valueOrOffset, bo),
	];
}

// TIFF inline ASCII/BYTE は左詰め（バイトオーダー非依存）
function ifdEntryInlineAscii(
	bo: ByteOrder,
	tag: number,
	count: number,
	chars: string,
): number[] {
	const raw = [0, 0, 0, 0];
	for (let i = 0; i < chars.length && i < 4; i++) {
		raw[i] = chars.charCodeAt(i);
	}
	return [
		...u16(tag, bo),
		...u16(2, bo), // type = ASCII
		...u32(count, bo),
		...raw,
	];
}

// RATIONAL value (8 bytes): numerator(4) + denominator(4)
function rational(bo: ByteOrder, num: number, den: number): number[] {
	return [...u32(num, bo), ...u32(den, bo)];
}

/**
 * 最小の JPEG を組み立てる（APP1 Exif 付き）。
 * tiffPayload は TIFF ヘッダ（II/MM + 002A + IFD0 offset）以降を含む完全な TIFF データ。
 */
function buildJpegWithExif(tiffPayload: number[]): Uint8Array {
	const exifId = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
	const app1Payload = [...exifId, ...tiffPayload];
	const app1Len = app1Payload.length + 2; // +2 for length field itself
	const app1 = [0xff, 0xe1, ...u16be(app1Len), ...app1Payload];
	// 最小限の JPEG: SOI + APP1 + SOS(dummy) + EOI
	const sos = [0xff, 0xda, 0x00, 0x02]; // minimal SOS
	const eoi = [0xff, 0xd9];
	return new Uint8Array([0xff, 0xd8, ...app1, ...sos, ...eoi]);
}

/**
 * TIFF ヘッダ + IFD0 を構築するヘルパー。
 * entries: IFD エントリ配列（各12バイト）
 * extraData: IFD 外に配置するデータ（offset で参照される）
 * extraDataOffset: extraData の TIFF ヘッダ基準オフセット
 */
function buildTiff(
	bo: ByteOrder,
	entries: number[][],
	extraData: number[] = [],
): number[] {
	const header =
		bo === 'II'
			? [0x49, 0x49, ...u16le(0x002a), ...u32le(8)]
			: [0x4d, 0x4d, ...u16be(0x002a), ...u32be(8)];
	// IFD0 starts at offset 8
	const ifdCount = u16(entries.length, bo);
	const nextIfd = u32(0, bo); // no next IFD
	const flatEntries = entries.flat();
	return [...header, ...ifdCount, ...flatEntries, ...nextIfd, ...extraData];
}

// 最小 JPEG without EXIF
function buildMinimalJpeg(): Uint8Array {
	return new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
}

// ---------------------------------------------------------------------------
// parseExif テスト
// ---------------------------------------------------------------------------

test('EXIF なし JPEG で空の ExifData を返す', () => {
	const jpeg = buildMinimalJpeg();
	const result = parseExif(jpeg);
	assert.equal(result.hasExif, false);
	assert.equal(result.hasGps, false);
	assert.equal(result.tags.length, 0);
});

test('EXIF なしバイト列（非 JPEG）で空の ExifData を返す', () => {
	const result = parseExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47])); // PNG
	assert.equal(result.hasExif, false);
});

test('空バイト列で例外を投げない', () => {
	const result = parseExif(new Uint8Array(0));
	assert.equal(result.hasExif, false);
});

test('II（リトルエンディアン）で IFD0 の Make/Model を読める', () => {
	const bo: ByteOrder = 'II';
	// Make = "TestCam\0" (8 bytes) — offset で配置
	const makeStr = [...asciiBytes('TestCam'), 0];
	// Model = "X100\0" — 5 bytes, 4以下なので inline は不可（5>4）→ offset
	const modelStr = [...asciiBytes('X100'), 0];

	// IFD0 は offset 8 から開始
	// entry count(2) + entries(N*12) + nextIfd(4) の後に extraData を配置
	const numEntries = 2;
	const ifd0Size = 2 + numEntries * 12 + 4; // 30 bytes
	const extraStart = 8 + ifd0Size; // TIFF-relative offset

	const entries = [
		ifdEntry(bo, 0x010f, 2, makeStr.length, extraStart), // Make → offset
		ifdEntry(bo, 0x0110, 2, modelStr.length, extraStart + makeStr.length), // Model → offset
	];
	const extraData = [...makeStr, ...modelStr];
	const tiff = buildTiff(bo, entries, extraData);
	const jpeg = buildJpegWithExif(tiff);
	const result = parseExif(jpeg);

	assert.equal(result.hasExif, true);
	const makeTag = result.tags.find((t) => t.tagId === 0x010f);
	assert.ok(makeTag, 'Make タグが見つかるべき');
	assert.equal(makeTag.value, 'TestCam');
	assert.equal(makeTag.label, 'メーカー');
	assert.equal(makeTag.group, 'camera');

	const modelTag = result.tags.find((t) => t.tagId === 0x0110);
	assert.ok(modelTag, 'Model タグが見つかるべき');
	assert.equal(modelTag.value, 'X100');
});

test('MM（ビッグエンディアン）で IFD0 の Make を読める', () => {
	const bo: ByteOrder = 'MM';
	const makeStr = [...asciiBytes('Nikon'), 0];

	const numEntries = 1;
	const ifd0Size = 2 + numEntries * 12 + 4;
	const extraStart = 8 + ifd0Size;

	const entries = [ifdEntry(bo, 0x010f, 2, makeStr.length, extraStart)];
	const tiff = buildTiff(bo, entries, makeStr);
	const jpeg = buildJpegWithExif(tiff);
	const result = parseExif(jpeg);

	assert.equal(result.hasExif, true);
	const makeTag = result.tags.find((t) => t.tagId === 0x010f);
	assert.ok(makeTag);
	assert.equal(makeTag.value, 'Nikon');
});

test('Orientation タグを読み取れる', () => {
	const bo: ByteOrder = 'II';
	// Orientation = SHORT(3), count=1, value=6 (90° CW) — inline
	const entries = [ifdEntry(bo, 0x0112, 3, 1, 6)];
	const tiff = buildTiff(bo, entries);
	const jpeg = buildJpegWithExif(tiff);
	const result = parseExif(jpeg);

	assert.equal(result.orientation, 6);
	const tag = result.tags.find((t) => t.tagId === 0x0112);
	assert.ok(tag);
	assert.equal(tag.label, '回転情報');
});

test('ExifIFD サブ IFD の DateTimeOriginal を読める', () => {
	const bo: ByteOrder = 'II';
	const dtStr = [...asciiBytes('2024:06:15 10:30:00'), 0]; // 20 bytes

	// IFD0: ExifIFD pointer のみ
	const numIfd0Entries = 1;
	const ifd0Size = 2 + numIfd0Entries * 12 + 4; // 18
	const exifIfdStart = 8 + ifd0Size; // TIFF offset of ExifIFD

	// ExifIFD: DateTimeOriginal のみ
	const numExifEntries = 1;
	const exifIfdSize = 2 + numExifEntries * 12 + 4; // 18
	const dtOffset = exifIfdStart + exifIfdSize; // TIFF offset of DateTime string

	const ifd0Entries = [ifdEntry(bo, 0x8769, 4, 1, exifIfdStart)];
	const exifEntries = [ifdEntry(bo, 0x9003, 2, dtStr.length, dtOffset)];

	const tiff = buildTiff(bo, ifd0Entries, [
		// ExifIFD
		...u16(numExifEntries, bo),
		...exifEntries.flat(),
		...u32(0, bo), // next IFD
		// DateTime string data
		...dtStr,
	]);

	const jpeg = buildJpegWithExif(tiff);
	const result = parseExif(jpeg);

	assert.equal(result.hasExif, true);
	const dt = result.tags.find((t) => t.tagId === 0x9003);
	assert.ok(dt, 'DateTimeOriginal タグが見つかるべき');
	assert.equal(dt.value, '2024:06:15 10:30:00');
	assert.equal(dt.group, 'datetime');
});

test('ExifIFD の RATIONAL タグ（FNumber）を読める', () => {
	const bo: ByteOrder = 'II';

	const numIfd0Entries = 1;
	const ifd0Size = 2 + numIfd0Entries * 12 + 4;
	const exifIfdStart = 8 + ifd0Size;

	const numExifEntries = 1;
	const exifIfdSize = 2 + numExifEntries * 12 + 4;
	const fnumOffset = exifIfdStart + exifIfdSize;

	const ifd0Entries = [ifdEntry(bo, 0x8769, 4, 1, exifIfdStart)];
	const exifEntries = [
		ifdEntry(bo, 0x829d, 5, 1, fnumOffset), // FNumber RATIONAL
	];

	const tiff = buildTiff(bo, ifd0Entries, [
		...u16(numExifEntries, bo),
		...exifEntries.flat(),
		...u32(0, bo),
		...rational(bo, 28, 10), // f/2.8
	]);

	const jpeg = buildJpegWithExif(tiff);
	const result = parseExif(jpeg);

	const fnum = result.tags.find((t) => t.tagId === 0x829d);
	assert.ok(fnum, 'FNumber タグが見つかるべき');
	assert.equal(fnum.value, 'f/28/10');
	assert.equal(fnum.group, 'camera');
});

test('GPS 付き JPEG で緯度経度が十進数に変換される (N/E)', () => {
	const bo: ByteOrder = 'II';

	const numIfd0Entries = 1;
	const ifd0Size = 2 + numIfd0Entries * 12 + 4;
	const gpsIfdStart = 8 + ifd0Size;

	// GPS IFD: LatRef, Lat, LngRef, Lng の 4 エントリ
	const numGpsEntries = 4;
	const gpsIfdSize = 2 + numGpsEntries * 12 + 4;
	const dataStart = gpsIfdStart + gpsIfdSize;

	const gpsEntries = [
		ifdEntryInlineAscii(bo, 0x0001, 2, 'N\0'), // LatRef = "N"
		ifdEntry(bo, 0x0002, 5, 3, dataStart), // Lat = 3 RATIONALs
		ifdEntryInlineAscii(bo, 0x0003, 2, 'E\0'), // LngRef = "E"
		ifdEntry(bo, 0x0004, 5, 3, dataStart + 24), // Lng = 3 RATIONALs
	];

	// 35° 40' 52.08" N → 35.681133...
	const latRationals = [
		...rational(bo, 35, 1),
		...rational(bo, 40, 1),
		...rational(bo, 5208, 100),
	];
	// 139° 46' 1.56" E → 139.767100...
	const lngRationals = [
		...rational(bo, 139, 1),
		...rational(bo, 46, 1),
		...rational(bo, 156, 100),
	];

	const ifd0Entries = [ifdEntry(bo, 0x8825, 4, 1, gpsIfdStart)];

	const tiff = buildTiff(bo, ifd0Entries, [
		...u16(numGpsEntries, bo),
		...gpsEntries.flat(),
		...u32(0, bo),
		...latRationals,
		...lngRationals,
	]);

	const jpeg = buildJpegWithExif(tiff);
	const result = parseExif(jpeg);

	assert.equal(result.hasExif, true);
	assert.equal(result.hasGps, true);
	assert.ok(result.gps);
	// 35 + 40/60 + 52.08/3600 = 35.681133...
	assert.ok(
		Math.abs(result.gps.lat - 35.6811) < 0.001,
		`lat=${result.gps.lat}`,
	);
	// 139 + 46/60 + 1.56/3600 = 139.76710...
	assert.ok(
		Math.abs(result.gps.lng - 139.7671) < 0.001,
		`lng=${result.gps.lng}`,
	);
});

test('GPS: S/W で負の座標になる', () => {
	const bo: ByteOrder = 'MM';

	const numIfd0Entries = 1;
	const ifd0Size = 2 + numIfd0Entries * 12 + 4;
	const gpsIfdStart = 8 + ifd0Size;

	const numGpsEntries = 4;
	const gpsIfdSize = 2 + numGpsEntries * 12 + 4;
	const dataStart = gpsIfdStart + gpsIfdSize;

	const gpsEntries = [
		ifdEntryInlineAscii(bo, 0x0001, 2, 'S\0'),
		ifdEntry(bo, 0x0002, 5, 3, dataStart),
		ifdEntryInlineAscii(bo, 0x0003, 2, 'W\0'),
		ifdEntry(bo, 0x0004, 5, 3, dataStart + 24),
	];

	// 33° 51' 54" S
	const latRationals = [
		...rational(bo, 33, 1),
		...rational(bo, 51, 1),
		...rational(bo, 54, 1),
	];
	// 151° 12' 36" W
	const lngRationals = [
		...rational(bo, 151, 1),
		...rational(bo, 12, 1),
		...rational(bo, 36, 1),
	];

	const ifd0Entries = [ifdEntry(bo, 0x8825, 4, 1, gpsIfdStart)];

	const tiff = buildTiff(bo, ifd0Entries, [
		...u16(numGpsEntries, bo),
		...gpsEntries.flat(),
		...u32(0, bo),
		...latRationals,
		...lngRationals,
	]);

	const jpeg = buildJpegWithExif(tiff);
	const result = parseExif(jpeg);

	assert.ok(result.gps);
	assert.ok(result.gps.lat < 0, `S should be negative: ${result.gps.lat}`);
	assert.ok(result.gps.lng < 0, `W should be negative: ${result.gps.lng}`);
});

test('RATIONAL の denominator=0 で例外を投げない', () => {
	const bo: ByteOrder = 'II';

	const numIfd0Entries = 1;
	const ifd0Size = 2 + numIfd0Entries * 12 + 4;
	const exifIfdStart = 8 + ifd0Size;

	const numExifEntries = 1;
	const exifIfdSize = 2 + numExifEntries * 12 + 4;
	const fnumOffset = exifIfdStart + exifIfdSize;

	const ifd0Entries = [ifdEntry(bo, 0x8769, 4, 1, exifIfdStart)];
	const exifEntries = [ifdEntry(bo, 0x829d, 5, 1, fnumOffset)];

	const tiff = buildTiff(bo, ifd0Entries, [
		...u16(numExifEntries, bo),
		...exifEntries.flat(),
		...u32(0, bo),
		...rational(bo, 28, 0), // denominator=0
	]);

	const jpeg = buildJpegWithExif(tiff);
	const result = parseExif(jpeg);
	assert.equal(result.hasExif, true);
	const fnum = result.tags.find((t) => t.tagId === 0x829d);
	assert.ok(fnum);
	assert.equal(fnum.value, 'f/0');
});

test('truncated APP1 でクラッシュしない', () => {
	// APP1 の length が実際のデータより大きい
	const truncated = new Uint8Array([
		0xff,
		0xd8, // SOI
		0xff,
		0xe1, // APP1
		0x00,
		0xff, // length = 255 (実際はデータ不足)
		0x45,
		0x78,
		0x69,
		0x66,
		0x00,
		0x00, // "Exif\0\0"
		0x49,
		0x49, // II
		// 切り詰められたデータ
	]);
	const result = parseExif(truncated);
	assert.equal(result.hasExif, false);
});

test('offset 範囲外の IFD ポインタでクラッシュしない', () => {
	const bo: ByteOrder = 'II';
	// ExifIFD ポインタが巨大な offset を指す
	const entries = [ifdEntry(bo, 0x8769, 4, 1, 999999)];
	const tiff = buildTiff(bo, entries);
	const jpeg = buildJpegWithExif(tiff);
	const result = parseExif(jpeg);
	assert.equal(result.hasExif, true);
	assert.equal(result.tags.length, 0);
});

// ---------------------------------------------------------------------------
// stripMetadata テスト
// ---------------------------------------------------------------------------

test('stripMetadata: Exif APP1 を除去し JFIF APP0 を保持する', () => {
	// JFIF APP0 (dummy)
	const jfifPayload = [...asciiBytes('JFIF'), 0x00, 0x01, 0x01, 0x00];
	const jfifLen = jfifPayload.length + 2;
	const app0 = [0xff, 0xe0, ...u16be(jfifLen), ...jfifPayload];

	// Exif APP1 (dummy)
	const exifPayload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49];
	const exifLen = exifPayload.length + 2;
	const app1 = [0xff, 0xe1, ...u16be(exifLen), ...exifPayload];

	const sos = [0xff, 0xda, 0x00, 0x02];
	const imageData = [0x01, 0x02, 0x03];
	const eoi = [0xff, 0xd9];

	const jpeg = new Uint8Array([
		0xff,
		0xd8,
		...app0,
		...app1,
		...sos,
		...imageData,
		...eoi,
	]);

	const result = stripMetadata(jpeg, 'jpeg');
	assert.equal(result.warnings.length, 0);

	// JFIF APP0 が残っているか
	let foundApp0 = false;
	let foundApp1Exif = false;
	let i = 2;
	while (i + 4 <= result.data.length) {
		if (result.data[i] !== 0xff) break;
		const marker = result.data[i + 1];
		if (marker === 0xda) break;
		if (marker === 0xe0) foundApp0 = true;
		if (marker === 0xe1) {
			// Check if it's Exif
			const payloadStart = i + 4;
			if (
				result.data[payloadStart] === 0x45 &&
				result.data[payloadStart + 1] === 0x78
			) {
				foundApp1Exif = true;
			}
		}
		const segLen = (result.data[i + 2] << 8) | result.data[i + 3];
		i += 2 + segLen;
	}

	assert.equal(foundApp0, true, 'JFIF APP0 は保持されるべき');
	assert.equal(foundApp1Exif, false, 'Exif APP1 は除去されるべき');
});

test('stripMetadata 後に parseExif で hasExif === false', () => {
	const bo: ByteOrder = 'II';
	const makeStr = [...asciiBytes('Test'), 0];
	const numEntries = 1;
	const ifd0Size = 2 + numEntries * 12 + 4;
	const extraStart = 8 + ifd0Size;

	const entries = [ifdEntry(bo, 0x010f, 2, makeStr.length, extraStart)];
	const tiff = buildTiff(bo, entries, makeStr);
	const jpeg = buildJpegWithExif(tiff);

	// パース前: EXIF あり
	const before = parseExif(jpeg);
	assert.equal(before.hasExif, true);

	// 除去
	const stripped = stripMetadata(jpeg, 'jpeg');

	// パース後: EXIF なし
	const after = parseExif(stripped.data);
	assert.equal(after.hasExif, false);
});

test('stripMetadata: XMP APP1 も除去する', () => {
	const xmpId = asciiBytes('http://ns.adobe.com/xap/1.0/\0');
	const xmpPayload = [...xmpId, ...asciiBytes('<x:xmpmeta/>')];
	const xmpLen = xmpPayload.length + 2;
	const xmpApp1 = [0xff, 0xe1, ...u16be(xmpLen), ...xmpPayload];

	const sos = [0xff, 0xda, 0x00, 0x02];
	const eoi = [0xff, 0xd9];

	const jpeg = new Uint8Array([0xff, 0xd8, ...xmpApp1, ...sos, ...eoi]);

	const result = stripMetadata(jpeg, 'jpeg');

	let foundXmp = false;
	let i = 2;
	while (i + 4 <= result.data.length) {
		if (result.data[i] !== 0xff) break;
		const marker = result.data[i + 1];
		if (marker === 0xda) break;
		if (marker === 0xe1) foundXmp = true;
		const segLen = (result.data[i + 2] << 8) | result.data[i + 3];
		i += 2 + segLen;
	}
	assert.equal(foundXmp, false, 'XMP APP1 は除去されるべき');
});

test('stripMetadata: IPTC APP13 を除去する', () => {
	const iptcId = asciiBytes('Photoshop 3.0\0');
	const iptcPayload = [...iptcId, 0x00, 0x01, 0x02];
	const iptcLen = iptcPayload.length + 2;
	const app13 = [0xff, 0xed, ...u16be(iptcLen), ...iptcPayload];

	const sos = [0xff, 0xda, 0x00, 0x02];
	const eoi = [0xff, 0xd9];

	const jpeg = new Uint8Array([0xff, 0xd8, ...app13, ...sos, ...eoi]);

	const result = stripMetadata(jpeg, 'jpeg');

	let foundApp13 = false;
	let i = 2;
	while (i + 4 <= result.data.length) {
		if (result.data[i] !== 0xff) break;
		const marker = result.data[i + 1];
		if (marker === 0xda) break;
		if (marker === 0xed) foundApp13 = true;
		const segLen = (result.data[i + 2] << 8) | result.data[i + 3];
		i += 2 + segLen;
	}
	assert.equal(foundApp13, false, 'IPTC APP13 は除去されるべき');
});

test('stripMetadata: ICC APP2 は保持する', () => {
	const iccId = asciiBytes('ICC_PROFILE\0');
	const iccPayload = [...iccId, 0x01, 0x01, 0x00, 0x00];
	const iccLen = iccPayload.length + 2;
	const app2 = [0xff, 0xe2, ...u16be(iccLen), ...iccPayload];

	const sos = [0xff, 0xda, 0x00, 0x02];
	const eoi = [0xff, 0xd9];

	const jpeg = new Uint8Array([0xff, 0xd8, ...app2, ...sos, ...eoi]);

	const result = stripMetadata(jpeg, 'jpeg');

	let foundApp2 = false;
	let i = 2;
	while (i + 4 <= result.data.length) {
		if (result.data[i] !== 0xff) break;
		const marker = result.data[i + 1];
		if (marker === 0xda) break;
		if (marker === 0xe2) foundApp2 = true;
		const segLen = (result.data[i + 2] << 8) | result.data[i + 3];
		i += 2 + segLen;
	}
	assert.equal(foundApp2, true, 'ICC APP2 は保持されるべき');
});

test('stripMetadata: 非 JPEG 形式は warning を返す', () => {
	const result = stripMetadata(new Uint8Array([0x00]), 'webp');
	assert.equal(result.warnings.length, 1);
	assert.ok(result.warnings[0].includes('再エンコード'));
});

// ---------------------------------------------------------------------------
// validateBatch テスト
// ---------------------------------------------------------------------------

test('validateBatch: ファイル数超過でエラー', () => {
	const files = Array.from(
		{ length: MAX_BATCH_FILES + 1 },
		(_, i) => new File(['x'], `file${i}.jpg`),
	);
	const result = validateBatch(files);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.reason, 'too-many-files');
		assert.ok(result.message.includes(`${MAX_BATCH_FILES}枚`));
	}
});

test('validateBatch: 正常なファイル数で ok', () => {
	const files = [new File(['x'], 'a.jpg'), new File(['y'], 'b.jpg')];
	const result = validateBatch(files);
	assert.equal(result.ok, true);
});
