// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/image-convert.test.ts
//
// canvas/WASM 依存（decodeToBitmap / encode / convertOne）はブラウザ専用のため E2E で検証する。
// ここでは純粋ロジック（形式判定・バリデーション・EXIF 抽出/再注入/Orientation正規化・ファイル名）を対象とする。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildConvertedFilename,
	detectFormat,
	extensionForTarget,
	extractExif,
	injectExif,
	MAX_BATCH_FILES,
	needsBackgroundFill,
	normalizeExifOrientation,
	validateBatch,
	validateImageFile,
} from '../../src/lib/tools/image-convert.ts';

// ---------------------------------------------------------------------------
// テスト用バイト列ビルダ
// ---------------------------------------------------------------------------

function pad(bytes: number[], length: number): Uint8Array {
	const out = new Uint8Array(length);
	out.set(bytes.slice(0, length));
	return out;
}

function bytesOf(s: string): number[] {
	return Array.from(s).map((c) => c.charCodeAt(0));
}

/** ISO-BMFF ftyp box を組み立てる（major + compatible brands） */
function ftyp(major: string, compatible: string[]): Uint8Array {
	const body = [
		...bytesOf('ftyp'),
		...bytesOf(major),
		0x00,
		0x00,
		0x00,
		0x00, // minor version
		...compatible.flatMap(bytesOf),
	];
	const size = 4 + body.length;
	return new Uint8Array([
		(size >> 24) & 0xff,
		(size >> 16) & 0xff,
		(size >> 8) & 0xff,
		size & 0xff,
		...body,
	]);
}

/** Orientation タグ 1 件だけを持つ APP1（EXIF）セグメントを little-endian TIFF で組み立てる */
function exifSegment(orientation: number): Uint8Array {
	const tiff = [
		0x49,
		0x49, // 'II'
		0x2a,
		0x00, // 42
		0x08,
		0x00,
		0x00,
		0x00, // IFD0 offset = 8
		0x01,
		0x00, // entry count = 1
		0x12,
		0x01, // tag 0x0112 (Orientation)
		0x03,
		0x00, // type SHORT
		0x01,
		0x00,
		0x00,
		0x00, // count 1
		orientation & 0xff,
		0x00,
		0x00,
		0x00, // value
		0x00,
		0x00,
		0x00,
		0x00, // next IFD = 0
	];
	const ident = EXIF_IDENT;
	const len = 2 + ident.length + tiff.length; // length field = 自身2 + payload
	return new Uint8Array([
		0xff,
		0xe1,
		(len >> 8) & 0xff,
		len & 0xff,
		...ident,
		...tiff,
	]);
}

const EXIF_IDENT = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

/** segment の IFD0 Orientation 値を読む（little-endian 前提） */
function readOrientation(segment: Uint8Array): number {
	// tiffStart=10, IFD0 offset=8 → ifd0=18, entry=20, value=28
	return segment[28] | (segment[29] << 8);
}

// ---------------------------------------------------------------------------
// detectFormat
// ---------------------------------------------------------------------------

test('detectFormat: PNG / JPEG / WebP', () => {
	assert.equal(
		detectFormat(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 16)),
		'png',
	);
	assert.equal(detectFormat(pad([0xff, 0xd8, 0xff, 0xe0], 16)), 'jpeg');
	assert.equal(
		detectFormat(
			new Uint8Array([...bytesOf('RIFF'), 0, 0, 0, 0, ...bytesOf('WEBP')]),
		),
		'webp',
	);
});

test('detectFormat: AVIF / HEIC は ftyp brand で判定', () => {
	assert.equal(detectFormat(ftyp('avif', ['avif', 'mif1'])), 'avif');
	assert.equal(detectFormat(ftyp('heic', ['mif1', 'heic'])), 'heic');
	// major が generic な mif1 でも compatible に heic があれば heic
	assert.equal(detectFormat(ftyp('mif1', ['heic'])), 'heic');
	// avif と heic 双方を含む場合は avif 優先
	assert.equal(detectFormat(ftyp('avif', ['heic'])), 'avif');
});

test('detectFormat: 未対応・短すぎは null', () => {
	assert.equal(
		detectFormat(new Uint8Array([...bytesOf('GIF89a'), 0, 0, 0, 0, 0, 0])),
		null,
	);
	assert.equal(detectFormat(new Uint8Array([0xff, 0xd8])), null); // 12バイト未満
});

// ---------------------------------------------------------------------------
// validateImageFile / validateBatch
// ---------------------------------------------------------------------------

test('validateImageFile: 形式判定 OK（PNG）', async () => {
	const png = new File(
		[pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 16)],
		'a.png',
	);
	const r = await validateImageFile(png);
	assert.deepEqual(r, { ok: true, format: 'png' });
});

test('validateImageFile: 判定不能（GIF）は invalid-signature', async () => {
	const gif = new File(
		[new Uint8Array([...bytesOf('GIF89a'), 0, 0, 0, 0, 0, 0])],
		'a.gif',
	);
	const r = await validateImageFile(gif);
	assert.equal(r.ok, false);
	if (!r.ok) assert.equal(r.reason, 'invalid-signature');
});

test('validateImageFile: 50MB 超過は too-large', async () => {
	const big = { name: 'big.png', size: 51 * 1024 * 1024 } as unknown as File;
	const r = await validateImageFile(big);
	assert.equal(r.ok, false);
	if (!r.ok) assert.equal(r.reason, 'too-large');
});

test('validateBatch: 枚数・合計サイズ上限', () => {
	const ok = Array.from(
		{ length: MAX_BATCH_FILES },
		() => ({ size: 1 }) as File,
	);
	assert.deepEqual(validateBatch(ok), { ok: true });

	const tooMany = Array.from(
		{ length: MAX_BATCH_FILES + 1 },
		() => ({ size: 1 }) as File,
	);
	const r1 = validateBatch(tooMany);
	assert.equal(r1.ok, false);
	if (!r1.ok) assert.equal(r1.reason, 'too-many-files');

	const huge = [
		{ size: 200 * 1024 * 1024 },
		{ size: 200 * 1024 * 1024 },
	] as File[];
	const r2 = validateBatch(huge);
	assert.equal(r2.ok, false);
	if (!r2.ok) assert.equal(r2.reason, 'total-size-exceeded');
});

// ---------------------------------------------------------------------------
// EXIF 抽出 / Orientation 正規化 / 再注入
// ---------------------------------------------------------------------------

test('extractExif: APP1（EXIF）セグメントを抽出する', () => {
	const seg = exifSegment(6);
	const jpeg = new Uint8Array([0xff, 0xd8, ...seg, 0xff, 0xd9]);
	const extracted = extractExif(jpeg);
	assert.ok(extracted, 'EXIF が抽出される');
	assert.deepEqual(Array.from(extracted as Uint8Array), Array.from(seg));
	assert.equal(readOrientation(extracted as Uint8Array), 6);
});

test('extractExif: EXIF が無ければ null', () => {
	const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
	assert.equal(extractExif(jpeg), null);
});

test('normalizeExifOrientation: Orientation を 1 に正規化する', () => {
	const seg = exifSegment(6);
	const normalized = normalizeExifOrientation(seg);
	assert.equal(readOrientation(normalized), 1);
	// 入力は破壊しない（コピーを返す）
	assert.equal(readOrientation(seg), 6);
});

test('injectExif: SOI 直後に注入し Orientation は 1（二重回転しない）', () => {
	const seg = exifSegment(8);
	const out = injectExif(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), seg);
	// 先頭は SOI
	assert.equal(out[0], 0xff);
	assert.equal(out[1], 0xd8);
	const reExtracted = extractExif(out);
	assert.ok(reExtracted, '再注入後も EXIF を抽出できる');
	assert.equal(readOrientation(reExtracted as Uint8Array), 1);
});

// ---------------------------------------------------------------------------
// ファイル名 / 形式メタ
// ---------------------------------------------------------------------------

test('buildConvertedFilename / extensionForTarget / needsBackgroundFill', () => {
	assert.equal(buildConvertedFilename('IMG_0001.HEIC', 'jpeg'), 'IMG_0001.jpg');
	assert.equal(buildConvertedFilename('photo.png', 'webp'), 'photo.webp');
	assert.equal(buildConvertedFilename('noext', 'avif'), 'noext.avif');
	assert.equal(extensionForTarget('jpeg'), 'jpg');
	assert.equal(extensionForTarget('avif'), 'avif');
	assert.equal(needsBackgroundFill('jpeg'), true);
	assert.equal(needsBackgroundFill('png'), false);
});
