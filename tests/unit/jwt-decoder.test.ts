import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeJwt } from '../../src/lib/tools/jwt-decoder.ts';

test('decodeJwt: 正常なJWTのデコード', () => {
	// {"alg":"HS256","typ":"JWT"}.{"sub":"1234567890","name":"山田太郎","iat":1516239022}
	const token =
		'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuWxseeUsOWkqumDjiIsImlhdCI6MTUxNjIzOTAyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
	const result = decodeJwt(token);

	assert.strictEqual(result.valid, true);
	assert.strictEqual(result.error, null);
	assert.ok(result.header?.json);
	assert.ok(result.payload?.json);
});

test('decodeJwt: セグメント不足のエラー検出', () => {
	const result = decodeJwt('header.payload');
	assert.strictEqual(result.valid, false);
	assert.ok(result.error?.includes('3つの部分'));
});

test('decodeJwt: 不正なBase64URL/文字化けのエラー検出', () => {
	// 不正なBase64
	const result = decodeJwt('!!!.@@@.###');
	assert.strictEqual(result.valid, false);
	assert.ok(result.error);
});

test('decodeJwt: 非JSONヘッダー/ペイロードのエラー検出', () => {
	// "hello" (Base64URL: aGVsbG8) . "world" (Base64URL: d29ybGQ) . sig
	const token = 'aGVsbG8.d29ybGQ.sig';
	const result = decodeJwt(token);

	assert.strictEqual(result.valid, false);
	assert.ok(result.error?.includes('JSON'));
});
