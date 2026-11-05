import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jwtDecoderMcpTool } from '../../src/lib/tools/jwt-decoder.mcp.ts';
import { decodeJwt } from '../../src/lib/tools/jwt-decoder.ts';
import { generateWebMcpDescriptor } from '../../src/lib/webmcp/descriptor-generator.ts';

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

function b64url(obj: unknown): string {
	return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function makeToken(payload: Record<string, unknown>): string {
	return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;
}

test('decodeJwt: header/payloadが配列のJWTを拒否する（#623）', () => {
	for (const token of [
		'W10.W10.',
		'W10.e30.',
		'e30.W10.',
		`${b64url([1])}.e30.`,
		`e30.${b64url([{}])}.`,
	]) {
		const result = decodeJwt(token);
		assert.strictEqual(result.valid, false, token);
		assert.strictEqual(
			result.error,
			'デコードエラー: JSONオブジェクトではありません。',
		);
		assert.strictEqual(result.header, null);
		assert.strictEqual(result.payload, null);
	}
});

test('decodeJwt: nullとプリミティブを拒否し、空objectと配列を含むobjectを受理する（#623）', () => {
	for (const value of [null, true, 123, '文字列']) {
		assert.strictEqual(decodeJwt(`${b64url(value)}.e30.`).valid, false);
		assert.strictEqual(decodeJwt(`e30.${b64url(value)}.`).valid, false);
	}
	assert.strictEqual(decodeJwt('e30.e30.').valid, true);
	const payload = { roles: ['user', 'admin'], nested: { values: [] } };
	const result = decodeJwt(makeToken(payload));
	assert.strictEqual(result.valid, true);
	assert.deepStrictEqual(result.payload?.json, payload);
});

test('JWT WebMCP: 配列JSONは成功出力にせず、objectだけを返す（#623）', async () => {
	const tool = generateWebMcpDescriptor(jwtDecoderMcpTool);
	for (const jwt of ['W10.W10.', 'W10.e30.', 'e30.W10.']) {
		const result = await tool.run({ jwt });
		assert.strictEqual(result.ok, false, jwt);
	}
	const result = await tool.run({ jwt: 'e30.e30.' });
	assert.ok(result.ok);
	assert.deepStrictEqual(result.value, {
		header: {},
		payload: {},
		warnings: [],
	});
});

const NOW_MS = Date.UTC(2026, 8, 30, 0, 0, 0);
const NOW_SEC = NOW_MS / 1000;

test('decodeJwt: 正常なexp過去・nbf未来の警告は従来どおり', () => {
	const expired = decodeJwt(makeToken({ exp: 1700000000 }), NOW_MS);
	assert.strictEqual(expired.valid, true);
	assert.strictEqual(expired.warnings.length, 1);
	assert.ok(expired.warnings[0].includes('有効期限（exp）を過ぎています'));

	const future = decodeJwt(makeToken({ nbf: NOW_SEC + 3600 }), NOW_MS);
	assert.strictEqual(future.valid, true);
	assert.strictEqual(future.warnings.length, 1);
	assert.ok(future.warnings[0].includes('有効開始時刻（nbf）が未来です'));

	const ok = decodeJwt(
		makeToken({ exp: NOW_SEC + 3600, nbf: NOW_SEC - 3600 }),
		NOW_MS,
	);
	assert.deepStrictEqual(ok.warnings, []);
});

test('decodeJwt: nbf/expがDate範囲外でもデコード結果を返し日本語警告を出す', () => {
	for (const [key, value] of [
		['nbf', 1e13],
		['nbf', 1e20],
		['exp', -1e13],
		['exp', 1e20],
	] as const) {
		const result = decodeJwt(makeToken({ sub: 'u', [key]: value }), NOW_MS);
		assert.strictEqual(result.valid, true, `${key}=${value}`);
		assert.strictEqual(result.error, null);
		assert.deepStrictEqual(result.payload?.json, { sub: 'u', [key]: value });
		assert.ok(result.warnings.length >= 1, `${key}=${value}`);
		const joined = result.warnings.join('\n');
		assert.ok(joined.includes('日時に変換できません'), joined);
		assert.ok(joined.includes(String(value)), joined);
		assert.ok(!/Invalid time value|RangeError/.test(joined), joined);
	}
});

test('decodeJwt: 範囲外の値は桁違い（ミリ秒・マイクロ秒）の可能性を示唆する', () => {
	const result = decodeJwt(makeToken({ nbf: 1e13 }), NOW_MS);
	assert.ok(result.warnings.join('\n').includes('ミリ秒'));
});

test('decodeJwt: ミリ秒で入った有効範囲内のexpも桁違いを示唆する', () => {
	// 秒として解釈すると未来すぎるが Date としては有効な値
	const result = decodeJwt(makeToken({ exp: NOW_MS }), NOW_MS);
	assert.strictEqual(result.valid, true);
	assert.ok(result.warnings.join('\n').includes('ミリ秒'));
});

test('decodeJwt: exp が現在時刻と等しい場合は失効扱い（RFC 7519）', () => {
	const at = decodeJwt(makeToken({ exp: NOW_SEC }), NOW_MS);
	assert.ok(
		at.warnings.some((w) => w.includes('有効期限（exp）を過ぎています')),
	);
	const before = decodeJwt(makeToken({ exp: NOW_SEC + 1 }), NOW_MS);
	assert.deepStrictEqual(before.warnings, []);
});

test('decodeJwt: nbf が現在時刻と等しい場合は有効（警告なし）', () => {
	const at = decodeJwt(makeToken({ nbf: NOW_SEC }), NOW_MS);
	assert.deepStrictEqual(at.warnings, []);
	const after = decodeJwt(makeToken({ nbf: NOW_SEC + 1 }), NOW_MS);
	assert.strictEqual(after.warnings.length, 1);
});

test('decodeJwt: 日時変換できない値でも失効・未来の判定は生の値で行う', () => {
	const expired = decodeJwt(makeToken({ exp: -1e13 }), NOW_MS);
	assert.strictEqual(expired.valid, true);
	assert.ok(
		expired.warnings.some((w) => w.includes('有効期限（exp）を過ぎています')),
		expired.warnings.join('\n'),
	);
	assert.ok(expired.warnings.some((w) => w.includes('日時に変換できません')));

	const notYet = decodeJwt(makeToken({ nbf: 1e13 }), NOW_MS);
	assert.ok(
		notYet.warnings.some((w) => w.includes('有効開始時刻（nbf）が未来です')),
		notYet.warnings.join('\n'),
	);
	assert.ok(notYet.warnings.some((w) => w.includes('日時に変換できません')));

	const farFutureExp = decodeJwt(makeToken({ exp: 1e20 }), NOW_MS);
	assert.ok(
		!farFutureExp.warnings.some((w) => w.includes('過ぎています')),
		'遠い未来のexpは失効扱いにしない',
	);
	const farPastNbf = decodeJwt(makeToken({ nbf: -1e20 }), NOW_MS);
	assert.ok(
		!farPastNbf.warnings.some((w) => w.includes('未来です')),
		'遠い過去のnbfは未来扱いにしない',
	);
});
