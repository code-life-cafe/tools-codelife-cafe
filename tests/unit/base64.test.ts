import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeBase64, encodeBase64 } from '../../src/lib/tools/base64.ts';

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
