import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeUrl, encodeUrl } from '../../src/lib/tools/url-encoder.ts';

test('encodeUrl & decodeUrl: 正常系のエンコード・デコード往復', () => {
	const text = 'https://example.com/検索?q=東京 天気';
	const encoded = encodeUrl(text, { mode: 'component' });
	const decoded = decodeUrl(encoded, { mode: 'component' });
	assert.strictEqual(decoded, text);
});

test('decodeUrl: 不正な%シーケンス（サイレント失敗せず例外送出）', () => {
	const malformed = '%E0%A4%A';
	assert.throws(() => {
		decodeUrl(malformed, { mode: 'component' });
	}, /不正なURL/);
});
