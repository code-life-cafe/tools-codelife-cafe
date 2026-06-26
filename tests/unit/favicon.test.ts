// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/favicon.test.ts
//
// Canvas/Image 依存のラスタライズ（rasterize / generatePngSet / generateFavicons）は
// Node では実行できないため、ここでは DOM 非依存の純関数のみを検証する
// （ラスタライズ系は tests/e2e/favicon.spec.ts で実ブラウザ検証する）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildHtmlSnippet,
	buildWebmanifest,
	detectImageKind,
	encodeIco,
	escapeHtmlAttribute,
	MAX_FAVICON_FILE_SIZE,
	parseSvgDimensions,
	validateImageFile,
	validateSvgSafety,
} from '../../src/lib/tools/favicon.ts';

// ---------------------------------------------------------------------------
// detectImageKind
// ---------------------------------------------------------------------------

test('detectImageKind: PNG シグネチャ（89 50 4E 47）', () => {
	const header = new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	]);
	assert.equal(detectImageKind(header), 'png');
});

test('detectImageKind: JPEG シグネチャ（FF D8 FF）', () => {
	const header = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
	assert.equal(detectImageKind(header), 'jpeg');
});

test('detectImageKind: WebP シグネチャ（RIFF....WEBP）', () => {
	const header = new Uint8Array([
		0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
	]);
	assert.equal(detectImageKind(header), 'webp');
});

test('detectImageKind: SVG（<svg を含む / <?xml・BOM・空白前置も許容）', () => {
	const enc = (s: string) => new TextEncoder().encode(s);
	assert.equal(
		detectImageKind(enc('<svg xmlns="http://www.w3.org/2000/svg"/>')),
		'svg',
	);
	assert.equal(
		detectImageKind(
			enc('<?xml version="1.0"?>\n<svg viewBox="0 0 16 16"></svg>'),
		),
		'svg',
	);
	assert.equal(detectImageKind(enc('   \n<SVG></SVG>')), 'svg');
	// UTF-8 BOM 付き
	const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('<svg></svg>')]);
	assert.equal(detectImageKind(bom), 'svg');
});

test('detectImageKind: 非対応・不明シグネチャは null', () => {
	// GIF89a
	assert.equal(
		detectImageKind(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])),
		null,
	);
	assert.equal(detectImageKind(new Uint8Array([0x00, 0x01, 0x02, 0x03])), null);
	assert.equal(detectImageKind(new Uint8Array([])), null);
});

// ---------------------------------------------------------------------------
// validateImageFile
// ---------------------------------------------------------------------------

function fileFrom(
	bytes: Uint8Array | string,
	name: string,
	type: string,
): File {
	const data =
		typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
	// ArrayBuffer 裏付けを保証して BlobPart 互換にする（SharedArrayBuffer を排除）
	return new File([new Uint8Array(data)], name, { type });
}

const PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

test('validateImageFile: 正常な PNG は ok / kind=png', async () => {
	const result = await validateImageFile(
		fileFrom(PNG_BYTES, 'icon.png', 'image/png'),
	);
	assert.deepEqual(result, { ok: true, kind: 'png' });
});

test('validateImageFile: 正常な SVG は ok / kind=svg', async () => {
	const result = await validateImageFile(
		fileFrom(
			'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
			'icon.svg',
			'image/svg+xml',
		),
	);
	assert.deepEqual(result, { ok: true, kind: 'svg' });
});

test('validateImageFile: 未対応 MIME（GIF）は unsupported-type', async () => {
	const result = await validateImageFile(
		fileFrom(new Uint8Array([0x47, 0x49, 0x46, 0x38]), 'a.gif', 'image/gif'),
	);
	assert.equal(result.ok, false);
	assert.equal(result.ok === false && result.reason, 'unsupported-type');
});

test('validateImageFile: シグネチャ不一致（type空・中身ゴミ）は invalid-signature', async () => {
	const result = await validateImageFile(
		fileFrom(new Uint8Array([0x00, 0x01, 0x02, 0x03]), 'mystery.bin', ''),
	);
	assert.equal(result.ok, false);
	assert.equal(result.ok === false && result.reason, 'invalid-signature');
});

test('validateImageFile: 20MB 超は too-large', async () => {
	// 実バイト確保を避けるため size/type のみを持つ最小オブジェクトで検証する
	// （validateImageFile はサイズ超過時にバイトを読まず即 return する）
	const fake = {
		size: MAX_FAVICON_FILE_SIZE + 1,
		type: 'image/png',
	} as unknown as File;
	const result = await validateImageFile(fake);
	assert.equal(result.ok, false);
	assert.equal(result.ok === false && result.reason, 'too-large');
});

// ---------------------------------------------------------------------------
// encodeIco
// ---------------------------------------------------------------------------

test('encodeIco: ICONDIR 署名・エントリ数・各エントリのサイズ/オフセットが正しい', () => {
	const images = [
		{ size: 16, bytes: new Uint8Array(10).fill(0xaa) },
		{ size: 32, bytes: new Uint8Array(20).fill(0xbb) },
		{ size: 48, bytes: new Uint8Array(30).fill(0xcc) },
	];
	const ico = encodeIco(images);
	const view = new DataView(ico.buffer);

	// ICONDIR: reserved=0, type=1, count=3
	assert.equal(view.getUint16(0, true), 0);
	assert.equal(view.getUint16(2, true), 1);
	assert.equal(view.getUint16(4, true), 3);
	// 署名先頭4バイト: 00 00 01 00
	assert.deepEqual(Array.from(ico.slice(0, 4)), [0x00, 0x00, 0x01, 0x00]);

	// 全長 = 6 + 16*3 + (10+20+30)
	assert.equal(ico.length, 6 + 16 * 3 + 60);

	const headerSize = 6;
	const dirSize = 16 * 3;
	let expectedOffset = headerSize + dirSize;
	for (let i = 0; i < images.length; i++) {
		const pos = headerSize + i * 16;
		assert.equal(ico[pos], images[i].size, `entry${i} width`);
		assert.equal(ico[pos + 1], images[i].size, `entry${i} height`);
		assert.equal(view.getUint16(pos + 4, true), 1, `entry${i} planes`);
		assert.equal(view.getUint16(pos + 6, true), 32, `entry${i} bitcount`);
		assert.equal(
			view.getUint32(pos + 8, true),
			images[i].bytes.length,
			`entry${i} bytesize`,
		);
		assert.equal(
			view.getUint32(pos + 12, true),
			expectedOffset,
			`entry${i} offset`,
		);
		// ペイロードが正しい位置にコピーされている
		assert.equal(ico[expectedOffset], images[i].bytes[0], `entry${i} payload`);
		expectedOffset += images[i].bytes.length;
	}
});

test('encodeIco: 256px は寸法バイトを 0 で表現する', () => {
	const ico = encodeIco([{ size: 256, bytes: new Uint8Array(4) }]);
	assert.equal(ico[6], 0); // width
	assert.equal(ico[7], 0); // height
});

// ---------------------------------------------------------------------------
// buildWebmanifest
// ---------------------------------------------------------------------------

test('buildWebmanifest: 有効JSONで必須キーを含む', () => {
	const json = buildWebmanifest({
		appName: 'My Tool',
		themeColor: '#1e40af',
		backgroundColor: '#ffffff',
	});
	const manifest = JSON.parse(json);
	assert.equal(manifest.name, 'My Tool');
	assert.equal(manifest.short_name, 'My Tool'); // shortName 未指定なら name にフォールバック
	assert.equal(manifest.theme_color, '#1e40af');
	assert.equal(manifest.background_color, '#ffffff');
	assert.equal(manifest.display, 'standalone');
	assert.equal(manifest.icons.length, 2);
	assert.deepEqual(
		manifest.icons.map((i: { sizes: string }) => i.sizes),
		['192x192', '512x512'],
	);
	assert.equal(manifest.icons[0].type, 'image/png');
});

test('buildWebmanifest: shortName 指定時はそれを使う', () => {
	const manifest = JSON.parse(
		buildWebmanifest({
			appName: 'Very Long Application Name',
			shortName: 'VLA',
			themeColor: '#000000',
			backgroundColor: '#ffffff',
		}),
	);
	assert.equal(manifest.short_name, 'VLA');
});

// ---------------------------------------------------------------------------
// buildHtmlSnippet
// ---------------------------------------------------------------------------

test('buildHtmlSnippet: link/meta 一式と theme-color を含む', () => {
	const html = buildHtmlSnippet({ themeColor: '#1e40af' });
	assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="any">/);
	assert.match(html, /href="\/favicon-16x16\.png"/);
	assert.match(html, /href="\/favicon-32x32\.png"/);
	assert.match(
		html,
		/<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png">/,
	);
	assert.match(html, /<link rel="manifest" href="\/site\.webmanifest">/);
	assert.match(html, /<meta name="theme-color" content="#1e40af">/);
});

test('buildHtmlSnippet: themeColor の HTML 特殊文字をエスケープする（注入防止）', () => {
	const html = buildHtmlSnippet({
		themeColor: '"><script>alert(1)</script>',
	});
	// 生のタグが出力に混入しない
	assert.doesNotMatch(html, /<script>/);
	assert.match(html, /content="&quot;&gt;&lt;script&gt;/);
});

// ---------------------------------------------------------------------------
// escapeHtmlAttribute
// ---------------------------------------------------------------------------

test('escapeHtmlAttribute: HTML特殊文字をエンティティ化する', () => {
	assert.equal(escapeHtmlAttribute(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
	assert.equal(escapeHtmlAttribute('#1e40af'), '#1e40af');
});

// ---------------------------------------------------------------------------
// validateSvgSafety
// ---------------------------------------------------------------------------

test('validateSvgSafety: 自己完結SVG（内部参照・data URI）は ok', () => {
	assert.equal(
		validateSvgSafety(
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#g)"/></svg>',
		).ok,
		true,
	);
	// data: URI はインラインなので許可
	assert.equal(
		validateSvgSafety(
			'<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAA="/></svg>',
		).ok,
		true,
	);
});

test('validateSvgSafety: 外部参照・スクリプト・イベント属性は拒否', () => {
	const cases = [
		'<svg><script>fetch("https://evil")</script></svg>',
		'<svg><foreignObject></foreignObject></svg>',
		'<svg onload="alert(1)"></svg>',
		'<svg><image href="https://evil.example/x.png"/></svg>',
		'<svg><image xlink:href="//evil.example/x.png"/></svg>',
		'<svg><use href="http://evil.example/x#a"/></svg>',
		'<svg><style>@import url(https://evil.example/x.css)</style></svg>',
		'<svg><rect fill="url(https://evil.example/x)"/></svg>',
	];
	for (const svg of cases) {
		assert.equal(validateSvgSafety(svg).ok, false, svg);
	}
});

// ---------------------------------------------------------------------------
// parseSvgDimensions
// ---------------------------------------------------------------------------

test('parseSvgDimensions: width/height（px有無）を優先する', () => {
	assert.deepEqual(parseSvgDimensions('<svg width="128" height="64"></svg>'), {
		width: 128,
		height: 64,
	});
	assert.deepEqual(
		parseSvgDimensions('<svg width="256px" height="256px"></svg>'),
		{ width: 256, height: 256 },
	);
});

test('parseSvgDimensions: width/height が無ければ viewBox を使う', () => {
	assert.deepEqual(parseSvgDimensions('<svg viewBox="0 0 48 24"></svg>'), {
		width: 48,
		height: 24,
	});
	// % など相対単位は無視して viewBox にフォールバック
	assert.deepEqual(
		parseSvgDimensions(
			'<svg width="100%" height="100%" viewBox="0 0 64 64"></svg>',
		),
		{ width: 64, height: 64 },
	);
});

test('parseSvgDimensions: 寸法情報が無ければ正方形512', () => {
	assert.deepEqual(parseSvgDimensions('<svg></svg>'), {
		width: 512,
		height: 512,
	});
});

// ---------------------------------------------------------------------------
// encodeIco: 出力が有効な ICONDIR として整合するか
// ---------------------------------------------------------------------------

test('encodeIco: 16/32/48 を内包する有効な ICONDIR を生成する', () => {
	const images = [16, 32, 48].map((size) => ({
		// 実PNGの代わりに固定長ダミー（先頭バイトでサイズを判別できるように）
		size,
		bytes: new Uint8Array(size).fill(size),
	}));
	const ico = encodeIco(images);
	const view = new DataView(ico.buffer);

	// ICONDIR
	assert.equal(view.getUint16(0, true), 0); // reserved
	assert.equal(view.getUint16(2, true), 1); // type=icon
	const count = view.getUint16(4, true);
	assert.equal(count, 3);

	// 各エントリの offset+size が境界内・互いに重ならない
	let prevEnd = 6 + count * 16;
	for (let i = 0; i < count; i++) {
		const pos = 6 + i * 16;
		const width = ico[pos] === 0 ? 256 : ico[pos];
		assert.equal(width, images[i].size, `entry${i} 寸法`);
		const size = view.getUint32(pos + 8, true);
		const offset = view.getUint32(pos + 12, true);
		assert.equal(offset, prevEnd, `entry${i} オフセット連続`);
		assert.ok(offset + size <= ico.length, `entry${i} 範囲内`);
		assert.equal(ico[offset], images[i].size, `entry${i} ペイロード先頭`);
		prevEnd = offset + size;
	}
	// 末尾まで使い切っている
	assert.equal(prevEnd, ico.length);
});
