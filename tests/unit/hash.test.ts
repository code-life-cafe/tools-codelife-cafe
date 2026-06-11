// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/hash.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
	compareHash,
	createCrc32,
	createMd5,
	detectAlgorithmByLength,
	hashFile,
	hashText,
	normalizeHash,
	validateHashFile,
} from '../../src/lib/tools/hash.ts';

const MB = 1024 * 1024;

function nodeHash(algorithm: string, data: string | Uint8Array): string {
	return createHash(algorithm).update(data).digest('hex');
}

test('MD5: 既知のテストベクトル', async () => {
	const vectors: [string, string][] = [
		['', 'd41d8cd98f00b204e9800998ecf8427e'],
		['abc', '900150983cd24fb0d6963f7d28e17f72'],
		['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
	];
	for (const [input, expected] of vectors) {
		const { md5 } = await hashText(input, ['md5']);
		assert.equal(md5, expected, `MD5("${input}")`);
	}
});

test('MD5: パディング境界の入力長 55/56/57/64/65 bytes', async () => {
	for (const n of [55, 56, 57, 64, 65]) {
		const input = 'a'.repeat(n);
		const { md5 } = await hashText(input, ['md5']);
		assert.equal(md5, nodeHash('md5', input), `length=${n}`);
	}
});

test('MD5: インクリメンタル計算がチャンクサイズに依存しない', () => {
	const data = new TextEncoder().encode(`${'x'.repeat(1000)}こんにちは🍣`);
	const expected = nodeHash('md5', data);
	for (const chunkSize of [1, 3, 63, 64, 65, data.length]) {
		const hasher = createMd5();
		for (let i = 0; i < data.length; i += chunkSize) {
			hasher.update(data.subarray(i, i + chunkSize));
		}
		assert.equal(hasher.digest(), expected, `chunkSize=${chunkSize}`);
	}
});

test('MD5: ランダムデータで node:crypto とクロスチェック', () => {
	for (const len of [0, 1, 100, 4096, 100_000]) {
		const data = new Uint8Array(len);
		for (let i = 0; i < len; i++) data[i] = (i * 31 + 7) % 256;
		const hasher = createMd5();
		hasher.update(data);
		assert.equal(hasher.digest(), nodeHash('md5', data), `length=${len}`);
	}
});

test('CRC32: 既知のテストベクトル（ゼロ埋め8桁・小文字）', () => {
	const vectors: [string, string][] = [
		['', '00000000'],
		['abc', '352441c2'],
		['123456789', 'cbf43926'],
	];
	for (const [input, expected] of vectors) {
		const hasher = createCrc32();
		hasher.update(new TextEncoder().encode(input));
		const result = hasher.digest();
		assert.equal(result, expected, `CRC32("${input}")`);
		assert.equal(result.length, 8, '常に8桁');
		assert.match(result, /^[0-9a-f]{8}$/, '小文字hex・負値にならない');
	}
});

test('hashText: SHA系の既知ベクトル', async () => {
	const results = await hashText('abc', ['sha1', 'sha256', 'sha512']);
	assert.equal(results.sha1, 'a9993e364706816aba3e25717850c26c9cd0d89d');
	assert.equal(
		results.sha256,
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
	);
	assert.equal(results.sha512, nodeHash('sha512', 'abc'));
});

test('hashText: 空文字列・日本語・絵文字で全アルゴリズム一致', async () => {
	for (const input of [
		'',
		'こんにちは世界',
		'絵文字🍣🎉テスト',
		'mixed 日本語 text',
	]) {
		const results = await hashText(input, [
			'md5',
			'sha1',
			'sha256',
			'sha512',
			'crc32',
		]);
		const bytes = new TextEncoder().encode(input);
		assert.equal(results.md5, nodeHash('md5', bytes), `md5("${input}")`);
		assert.equal(results.sha1, nodeHash('sha1', bytes), `sha1("${input}")`);
		assert.equal(
			results.sha256,
			nodeHash('sha256', bytes),
			`sha256("${input}")`,
		);
		assert.equal(
			results.sha512,
			nodeHash('sha512', bytes),
			`sha512("${input}")`,
		);
		assert.match(results.crc32 ?? '', /^[0-9a-f]{8}$/);
	}
});

test('hashFile: チャンク経路とフルバッファ経路が hashText と一致', async () => {
	const content = 'CODE:LIFE hash test データ🍣'.repeat(10);
	const file = new File([content], 'test.txt');
	const fromFile = await hashFile(
		file,
		['md5', 'sha1', 'sha256', 'sha512', 'crc32'],
		undefined,
		7, // 小さいチャンクサイズでバッファ境界を跨がせる
	);
	const fromText = await hashText(content, [
		'md5',
		'sha1',
		'sha256',
		'sha512',
		'crc32',
	]);
	assert.deepEqual(fromFile, fromText);
});

test('hashFile: 空ファイル', async () => {
	const file = new File([], 'empty.txt');
	const results = await hashFile(file, ['md5', 'sha256', 'crc32']);
	assert.equal(results.md5, 'd41d8cd98f00b204e9800998ecf8427e');
	assert.equal(results.crc32, '00000000');
	assert.equal(results.sha256, nodeHash('sha256', new Uint8Array(0)));
});

test('hashFile: onProgress が単調増加し最後に100になる', async () => {
	const file = new File(['a'.repeat(1000)], 'progress.txt');
	const values: number[] = [];
	await hashFile(file, ['md5', 'sha256'], (p) => values.push(p), 100);
	assert.ok(values.length > 0);
	for (let i = 1; i < values.length; i++) {
		assert.ok(values[i] >= values[i - 1], '単調増加');
	}
	assert.equal(values[values.length - 1], 100);
});

test('validateHashFile: 256MB上限と警告段階', () => {
	assert.deepEqual(validateHashFile({ size: 99 * MB }), {
		ok: true,
		warnLevel: 'none',
	});
	assert.deepEqual(validateHashFile({ size: 150 * MB }), {
		ok: true,
		warnLevel: 'large',
	});
	assert.deepEqual(validateHashFile({ size: 250 * MB }), {
		ok: true,
		warnLevel: 'huge',
	});
	assert.deepEqual(validateHashFile({ size: 257 * MB }), {
		ok: false,
		reason: 'too-large-file',
	});
	// 境界値: ちょうど100MB/200MB/256MBは超過扱いにしない
	assert.deepEqual(validateHashFile({ size: 100 * MB }), {
		ok: true,
		warnLevel: 'none',
	});
	assert.deepEqual(validateHashFile({ size: 200 * MB }), {
		ok: true,
		warnLevel: 'large',
	});
	assert.deepEqual(validateHashFile({ size: 256 * MB }), {
		ok: true,
		warnLevel: 'huge',
	});
});

test('normalizeHash / compareHash: 大文字小文字・空白・ハイフンの揺れを吸収', () => {
	assert.equal(normalizeHash('  AB-CD ef\t12  '), 'abcdef12');
	assert.ok(compareHash('ABCDEF12', 'ab-cd-ef-12'));
	assert.ok(
		compareHash(
			'900150983cd24fb0d6963f7d28e17f72',
			' 90015098 3CD24FB0 D6963F7D 28E17F72 ',
		),
	);
	assert.ok(!compareHash('abcdef12', 'abcdef13'));
});

test('detectAlgorithmByLength: 長さによる判定', () => {
	assert.equal(detectAlgorithmByLength('352441c2'), 'crc32');
	assert.equal(
		detectAlgorithmByLength('900150983cd24fb0d6963f7d28e17f72'),
		'md5',
	);
	assert.equal(detectAlgorithmByLength('a'.repeat(40)), 'sha1');
	assert.equal(detectAlgorithmByLength('A'.repeat(64)), 'sha256');
	assert.equal(detectAlgorithmByLength('f'.repeat(128)), 'sha512');
	assert.equal(detectAlgorithmByLength('abc'), null);
	assert.equal(detectAlgorithmByLength('z'.repeat(32)), null, '非hexはnull');
	assert.equal(detectAlgorithmByLength(''), null);
});
