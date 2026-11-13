// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/hmac.test.ts
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
	bytesToBase64,
	computeHmac,
	type HmacAlgorithm,
	parseHmacKey,
} from '../../src/lib/tools/hmac.ts';

function bytes(length: number, value: number): Uint8Array<ArrayBuffer> {
	return new Uint8Array(length).fill(value);
}

const utf8 = (s: string): Uint8Array<ArrayBuffer> =>
	new Uint8Array(new TextEncoder().encode(s));

// RFC 4231 テストケース 1・2・6（SHA-256/384/512）
const RFC4231: {
	name: string;
	key: Uint8Array<ArrayBuffer>;
	data: string;
	expected: Record<'sha256' | 'sha384' | 'sha512', string>;
}[] = [
	{
		name: 'Test Case 1',
		key: bytes(20, 0x0b),
		data: 'Hi There',
		expected: {
			sha256:
				'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
			sha384:
				'afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6',
			sha512:
				'87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854',
		},
	},
	{
		name: 'Test Case 2',
		key: utf8('Jefe'),
		data: 'what do ya want for nothing?',
		expected: {
			sha256:
				'5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
			sha384:
				'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649',
			sha512:
				'164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
		},
	},
	{
		name: 'Test Case 6（ブロック長より長い鍵）',
		key: bytes(131, 0xaa),
		data: 'Test Using Larger Than Block-Size Key - Hash Key First',
		expected: {
			sha256:
				'60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
			sha384:
				'4ece084485813e9088d2c63a041bc5b44f9ef1012a2b588f3cd11f05033ac4c60c2ef6ab4030fe8296248df163f44952',
			sha512:
				'80b24263c7c1a3ebb71493c1dd7be8b49b46d1f41b4aeec1121b013783f8f3526b56d037e05f2598bd0fd2215d6a1e5295e64f73f63f0aec8b915a985d786598',
		},
	},
];

for (const vector of RFC4231) {
	test(`RFC 4231 ${vector.name}`, async () => {
		for (const algorithm of ['sha256', 'sha384', 'sha512'] as const) {
			const { hex } = await computeHmac(vector.data, vector.key, algorithm);
			assert.equal(hex, vector.expected[algorithm], algorithm);
		}
	});
}

test('RFC 2202 HMAC-SHA1 テストケース 1・2', async () => {
	assert.equal(
		(await computeHmac('Hi There', bytes(20, 0x0b), 'sha1')).hex,
		'b617318655057264e28bc0b6fb378c8ef146be00',
	);
	assert.equal(
		(await computeHmac('what do ya want for nothing?', utf8('Jefe'), 'sha1'))
			.hex,
		'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
	);
});

test('空の鍵・空のメッセージ・日本語は Node の createHmac と一致する', async () => {
	const algorithms: HmacAlgorithm[] = ['sha1', 'sha256', 'sha384', 'sha512'];
	const cases: [string, string][] = [
		['', ''],
		['', 'メッセージ'],
		['秘密鍵', ''],
		['秘密鍵', 'こんにちは、世界🌏'],
	];
	for (const algorithm of algorithms) {
		for (const [key, message] of cases) {
			const result = await computeHmac(message, utf8(key), algorithm);
			const expected = createHmac(algorithm, key).update(message);
			assert.equal(
				result.hex,
				expected.digest('hex'),
				`${algorithm} key="${key}" message="${message}"`,
			);
			assert.equal(
				result.base64,
				createHmac(algorithm, key).update(message).digest('base64'),
			);
		}
	}
	// 既知値: HMAC-SHA256(鍵="", メッセージ="")
	assert.equal(
		(await computeHmac('', new Uint8Array(0), 'sha256')).hex,
		'b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad',
	);
});

test('parseHmacKey: UTF-8 はそのままバイト列にする', () => {
	const parsed = parseHmacKey('鍵 key', 'utf8');
	assert.ok(parsed.ok);
	assert.deepEqual(parsed.bytes, utf8('鍵 key'));
});

test('parseHmacKey: 16進数（大文字・0x接頭辞・空白を許容）', () => {
	for (const input of ['0b0B0b', '0x0b0b0b', '0b 0b\n0b']) {
		const parsed = parseHmacKey(input, 'hex');
		assert.ok(parsed.ok, input);
		assert.deepEqual(parsed.bytes, bytes(3, 0x0b), input);
	}
	const empty = parseHmacKey('', 'hex');
	assert.ok(empty.ok);
	assert.equal(empty.bytes.length, 0);
});

test('parseHmacKey: 不正な16進数はエラー', () => {
	const odd = parseHmacKey('abc', 'hex');
	assert.equal(odd.ok, false);
	if (!odd.ok) assert.match(odd.error, /偶数桁/);
	const invalid = parseHmacKey('zz', 'hex');
	assert.equal(invalid.ok, false);
	if (!invalid.ok) assert.match(invalid.error, /使えない文字/);
});

test('parseHmacKey: Base64（標準・URLセーフ・パディング省略）', () => {
	const expected = new Uint8Array([0xfb, 0xff, 0xbf]);
	for (const input of ['+/+/', '-_-_', ' +/+/ ']) {
		const parsed = parseHmacKey(input, 'base64');
		assert.ok(parsed.ok, input);
		assert.deepEqual(parsed.bytes, expected, input);
	}
	for (const input of ['SmVmZQ==', 'SmVmZQ']) {
		const parsed = parseHmacKey(input, 'base64');
		assert.ok(parsed.ok, input);
		assert.deepEqual(parsed.bytes, utf8('Jefe'), input);
	}
});

test('parseHmacKey: 不正なBase64はエラー', () => {
	for (const input of ['abcde', 'ab=c', 'あいう', 'a===']) {
		const parsed = parseHmacKey(input, 'base64');
		assert.equal(parsed.ok, false, input);
	}
});

test('bytesToBase64: パディング付きの標準Base64', () => {
	assert.equal(bytesToBase64(new Uint8Array([])), '');
	assert.equal(bytesToBase64(utf8('Jefe')), 'SmVmZQ==');
	assert.equal(bytesToBase64(new Uint8Array([0xfb, 0xff, 0xbf])), '+/+/');
});
