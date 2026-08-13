// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/qr-generator.test.ts
//
// qrcode ライブラリは Node / ブラウザ双方で動作するため、生成ロジックはここで検証する。
// downloadDataUrl / downloadSvg は document 操作のためブラウザ専用（E2Eで検証）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	defaultOptions,
	generateQRDataUrl,
	generateQRSvg,
	type QROptions,
} from '../../src/lib/tools/qr-generator.ts';

function opts(overrides: Partial<QROptions> = {}): QROptions {
	return { ...defaultOptions, ...overrides };
}

test('defaultOptions: 想定通りの初期値を持つ', () => {
	assert.equal(defaultOptions.size, 400);
	assert.equal(defaultOptions.errorCorrection, 'M');
	assert.equal(defaultOptions.foregroundColor, '#000000');
	assert.equal(defaultOptions.backgroundColor, '#FFFFFF');
});

// ============================================================
// generateQRDataUrl
// ============================================================

test('generateQRDataUrl: 空文字は空文字を返す', async () => {
	const result = await generateQRDataUrl('', opts());
	assert.equal(result, '');
});

test('generateQRDataUrl: 空白のみの入力は空文字を返す', async () => {
	const result = await generateQRDataUrl('   ', opts());
	assert.equal(result, '');
});

test('generateQRDataUrl: 通常の文字列は PNG data URL を返す', async () => {
	const result = await generateQRDataUrl('https://tools.codelife.cafe', opts());
	assert.ok(result.startsWith('data:image/png;base64,'));
	assert.ok(result.length > 'data:image/png;base64,'.length);
});

test('generateQRDataUrl: 誤り訂正レベルごとに生成できる', async () => {
	for (const errorCorrection of ['L', 'M', 'Q', 'H'] as const) {
		const result = await generateQRDataUrl('test', opts({ errorCorrection }));
		assert.ok(result.startsWith('data:image/png;base64,'), errorCorrection);
	}
});

test('generateQRDataUrl: 日本語テキストも生成できる', async () => {
	const result = await generateQRDataUrl('こんにちは世界', opts());
	assert.ok(result.startsWith('data:image/png;base64,'));
});

// ============================================================
// generateQRSvg
// ============================================================

test('generateQRSvg: 空文字は空文字を返す', async () => {
	const result = await generateQRSvg('', opts());
	assert.equal(result, '');
});

test('generateQRSvg: 通常の文字列は <svg> を含む文字列を返す', async () => {
	const result = await generateQRSvg('https://tools.codelife.cafe', opts());
	assert.ok(result.includes('<svg'));
});

test('generateQRSvg: 前景・背景色オプションが出力に反映される', async () => {
	const result = await generateQRSvg(
		'color-test',
		opts({ foregroundColor: '#ff0000', backgroundColor: '#00ff00' }),
	);
	assert.ok(result.toLowerCase().includes('#ff0000'));
	assert.ok(result.toLowerCase().includes('#00ff00'));
});
