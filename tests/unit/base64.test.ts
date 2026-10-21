import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	decodeBase64,
	encodeBase64,
	stripDataUriPrefix,
} from '../../src/lib/tools/base64.ts';
import { base64McpWebTool } from '../../src/lib/webmcp/tools/base64.webmcp.ts';

test('decodeBase64: 先頭・途中・複数のU+FEFFを文字として保持する', () => {
	for (const text of [
		'\uFEFFabc',
		'\uFEFF',
		'\uFEFF\uFEFF日本語🎉',
		'a\uFEFFb',
		'',
	]) {
		assert.equal(decodeBase64(encodeBase64(text)), text);
	}
	assert.equal(decodeBase64('77u/YWJj'), '\uFEFFabc');
});

test('decodeBase64: BOMを含むURL-safe入力でも文字を保持する', () => {
	assert.equal(decodeBase64('77u_YWJj'), '\uFEFFabc');
});

test('decodeBase64: 不正UTF-8を置換文字で成功扱いしない', () => {
	for (const input of ['/w==', '77u//w==']) {
		assert.throws(() => decodeBase64(input), /デコードに失敗しました/);
	}
});

test('Base64 WebMCP: 既存実行経路でも先頭文字と出力形を保持する', async () => {
	assert.deepEqual(
		await base64McpWebTool.run({ action: 'decode', text: '77u/YWJj' }),
		{
			ok: true,
			value: { result: '\uFEFFabc' },
		},
	);
	assert.deepEqual(
		await base64McpWebTool.run({ action: 'encode', text: '\uFEFFabc' }),
		{
			ok: true,
			value: { result: '77u/YWJj' },
		},
	);
	const invalidUtf8 = await base64McpWebTool.run({
		action: 'decode',
		text: '/w==',
	});
	assert.equal(invalidUtf8.ok, false);
	if (!invalidUtf8.ok)
		assert.match(invalidUtf8.error, /デコードに失敗しました/);
	assert.equal(
		(await base64McpWebTool.run({ action: 'other', text: 'abc' })).ok,
		false,
	);
});

test('encodeBase64 & decodeBase64: 日本語・絵文字を含むテキストの往復変換が無損失', () => {
	const text = 'こんにちは、世界！🎉';
	const encoded = encodeBase64(text);
	const decoded = decodeBase64(encoded);
	assert.strictEqual(decoded, text);
});

test('decodeBase64: URL-Safe Base64 (- と _) 入力およびパディング欠落の自動補正デコード', () => {
	const text = 'Hello? World! >> テスト';
	const encoded = encodeBase64(text);
	const urlSafeNoPadding = encoded
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');

	const decoded = decodeBase64(urlSafeNoPadding);
	assert.strictEqual(decoded, text);
});

test('stripDataUriPrefix: Data URI から base64, 以降のみを残す', () => {
	const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
	assert.strictEqual(stripDataUriPrefix(dataUri), 'iVBORw0KGgoAAAANSUhEUg==');
});
