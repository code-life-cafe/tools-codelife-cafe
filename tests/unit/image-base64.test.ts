import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildSnippet,
	dataUriToBlob,
	detectMimeFromBase64,
	estimateSize,
	extensionForMime,
	formatBytes,
	toBase64,
	validateImageFile,
} from '../../src/lib/tools/image-base64.ts';

// ---------------------------------------------------------------------------
// テスト用ヘルパー
// ---------------------------------------------------------------------------

function pngBase64(): string {
	const header = new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	]);
	let binary = '';
	for (const b of header) binary += String.fromCharCode(b);
	return btoa(binary);
}

function jpegBase64(): string {
	const header = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
	let binary = '';
	for (const b of header) binary += String.fromCharCode(b);
	return btoa(binary);
}

function gifBase64(): string {
	const header = new Uint8Array([
		0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
	]);
	let binary = '';
	for (const b of header) binary += String.fromCharCode(b);
	return btoa(binary);
}

function webpBase64(): string {
	const bytes = new Uint8Array([
		0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
	]);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

// ---------------------------------------------------------------------------
// validateImageFile
// ---------------------------------------------------------------------------

test('validateImageFile: PNG は OK', () => {
	const file = new File([new Uint8Array(100)], 'test.png', {
		type: 'image/png',
	});
	const result = validateImageFile(file);
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.mime, 'image/png');
});

test('validateImageFile: SVG は OK', () => {
	const file = new File(['<svg></svg>'], 'test.svg', {
		type: 'image/svg+xml',
	});
	const result = validateImageFile(file);
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.mime, 'image/svg+xml');
});

test('validateImageFile: 非対応形式は unsupported-type', () => {
	const file = new File([new Uint8Array(100)], 'test.bmp', {
		type: 'image/bmp',
	});
	const result = validateImageFile(file);
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.reason, 'unsupported-type');
});

test('validateImageFile: 10MB超は too-large', () => {
	const file = {
		type: 'image/png',
		size: 11 * 1024 * 1024,
	} as unknown as File;
	const result = validateImageFile(file);
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.reason, 'too-large');
});

// ---------------------------------------------------------------------------
// toBase64
// ---------------------------------------------------------------------------

test('toBase64: Data URI から Base64 本体を抽出する', () => {
	const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
	assert.equal(toBase64(dataUri), 'iVBORw0KGgoAAAANSUhEUg==');
});

test('toBase64: カンマなしの入力はエラー', () => {
	assert.throws(() => toBase64('invalid'), {
		message: /不正な Data URI/,
	});
});

// ---------------------------------------------------------------------------
// buildSnippet
// ---------------------------------------------------------------------------

test('buildSnippet: data-uri はそのまま返す', () => {
	const uri = 'data:image/png;base64,abc123';
	assert.equal(buildSnippet(uri, 'data-uri'), uri);
});

test('buildSnippet: raw-base64 は Base64 本体のみ', () => {
	assert.equal(
		buildSnippet('data:image/png;base64,abc123', 'raw-base64'),
		'abc123',
	);
});

test('buildSnippet: img タグ', () => {
	const result = buildSnippet('data:image/png;base64,abc', 'img');
	assert.equal(result, '<img src="data:image/png;base64,abc" alt="" />');
});

test('buildSnippet: css-bg', () => {
	const result = buildSnippet('data:image/png;base64,abc', 'css-bg');
	assert.equal(result, 'background-image: url("data:image/png;base64,abc");');
});

// ---------------------------------------------------------------------------
// detectMimeFromBase64
// ---------------------------------------------------------------------------

test('detectMimeFromBase64: PNG', () => {
	assert.equal(detectMimeFromBase64(pngBase64()), 'image/png');
});

test('detectMimeFromBase64: JPEG', () => {
	assert.equal(detectMimeFromBase64(jpegBase64()), 'image/jpeg');
});

test('detectMimeFromBase64: GIF', () => {
	assert.equal(detectMimeFromBase64(gifBase64()), 'image/gif');
});

test('detectMimeFromBase64: WebP', () => {
	assert.equal(detectMimeFromBase64(webpBase64()), 'image/webp');
});

test('detectMimeFromBase64: SVG（PD...）', () => {
	const b64 = btoa('<?xml version="1.0"?><svg></svg>');
	assert.equal(detectMimeFromBase64(b64), 'image/svg+xml');
});

test('detectMimeFromBase64: SVG（PHN...）', () => {
	const b64 = btoa('<svg></svg>');
	assert.equal(detectMimeFromBase64(b64), 'image/svg+xml');
});

test('detectMimeFromBase64: 不明なデータは null', () => {
	assert.equal(detectMimeFromBase64('AAAA'), null);
});

// ---------------------------------------------------------------------------
// dataUriToBlob
// ---------------------------------------------------------------------------

test('dataUriToBlob: Data URI 付き PNG のデコード', () => {
	const b64 = pngBase64();
	const dataUri = `data:image/png;base64,${b64}`;
	const { blob, mime, ext } = dataUriToBlob(dataUri);
	assert.equal(mime, 'image/png');
	assert.equal(ext, 'png');
	assert.equal(blob.type, 'image/png');
	assert.equal(blob.size, 8);
});

test('dataUriToBlob: data: プレフィックスなし（マジックバイト判定）', () => {
	const b64 = jpegBase64();
	const { mime, ext } = dataUriToBlob(b64);
	assert.equal(mime, 'image/jpeg');
	assert.equal(ext, 'jpg');
});

test('dataUriToBlob: 改行・空白を含む入力', () => {
	const b64 = pngBase64();
	const withWhitespace = `data:image/png;base64,${b64.slice(0, 4)}\n  ${b64.slice(4)}`;
	const { mime } = dataUriToBlob(withWhitespace);
	assert.equal(mime, 'image/png');
});

test('dataUriToBlob: 空文字列はエラー', () => {
	assert.throws(() => dataUriToBlob(''), {
		message: /MIMEタイプを判定できません/,
	});
});

test('dataUriToBlob: 不正な Base64 はエラー', () => {
	assert.throws(() => dataUriToBlob('data:image/png;base64,!!!invalid!!!'), {
		message: /Base64のデコードに失敗しました/,
	});
});

test('dataUriToBlob: data:text/html は拒否', () => {
	const b64 = btoa('<html></html>');
	assert.throws(() => dataUriToBlob(`data:text/html;base64,${b64}`), {
		message: /対応していない形式です/,
	});
});

test('dataUriToBlob: MIMEヘッダのみ（Base64なし）はエラー', () => {
	assert.throws(() => dataUriToBlob('data:image/png;base64,'), {
		message: /MIMEタイプを判定できません/,
	});
});

test('dataUriToBlob: マジックバイト判定不能 + data: なしはエラー', () => {
	const b64 = btoa('random binary content');
	assert.throws(() => dataUriToBlob(b64), {
		message: /MIMEタイプを判定できません/,
	});
});

// ---------------------------------------------------------------------------
// ラウンドトリップ
// ---------------------------------------------------------------------------

test('ラウンドトリップ: encode → decode が元バイト列と一致', async () => {
	const original = new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	]);
	let binary = '';
	for (const b of original) binary += String.fromCharCode(b);
	const b64 = btoa(binary);
	const dataUri = `data:image/png;base64,${b64}`;

	const { blob } = dataUriToBlob(dataUri);
	const decoded = new Uint8Array(await blob.arrayBuffer());
	assert.deepEqual(Array.from(decoded), Array.from(original));
});

// ---------------------------------------------------------------------------
// estimateSize
// ---------------------------------------------------------------------------

test('estimateSize: サイズと肥大率を計算する', () => {
	const original = new Uint8Array(100);
	let binary = '';
	for (const b of original) binary += String.fromCharCode(b);
	const b64 = btoa(binary);
	const dataUri = `data:image/png;base64,${b64}`;

	const { originalBytes, base64TextBytes, inflationPct } =
		estimateSize(dataUri);
	assert.equal(originalBytes, 100);
	assert.equal(base64TextBytes, b64.length);
	assert.ok(inflationPct > 30 && inflationPct < 40);
});

test('estimateSize: パディング付きの入力でも正確', () => {
	const b64 = btoa('ab');
	const dataUri = `data:image/png;base64,${b64}`;
	const { originalBytes } = estimateSize(dataUri);
	assert.equal(originalBytes, 2);
});

// ---------------------------------------------------------------------------
// extensionForMime / formatBytes
// ---------------------------------------------------------------------------

test('extensionForMime: 各 MIME → 拡張子', () => {
	assert.equal(extensionForMime('image/png'), 'png');
	assert.equal(extensionForMime('image/jpeg'), 'jpg');
	assert.equal(extensionForMime('image/webp'), 'webp');
	assert.equal(extensionForMime('image/gif'), 'gif');
	assert.equal(extensionForMime('image/svg+xml'), 'svg');
	assert.equal(extensionForMime('application/octet-stream'), 'bin');
});

test('formatBytes: 人が読める形式', () => {
	assert.equal(formatBytes(0), '0 B');
	assert.equal(formatBytes(512), '512 B');
	assert.equal(formatBytes(1024), '1.0 KB');
	assert.equal(formatBytes(1536), '1.5 KB');
	assert.equal(formatBytes(1048576), '1.00 MB');
	assert.equal(formatBytes(2621440), '2.50 MB');
});
