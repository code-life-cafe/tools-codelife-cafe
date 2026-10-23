import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caesarBruteForce, caesarCipher } from '../../src/lib/cipher/caesar.ts';
import {
	scoreCaesarText,
	scoredCaesarCandidates,
} from '../../src/lib/tools/caesar-score.ts';

test('全候補を維持し、シフト1と最大シフトを含む', () => {
	for (const [input, max] of [
		['abc', 25],
		['あいう', 45],
		['がぱ ABC', 45],
	] as const) {
		const candidates = scoredCaesarCandidates(input);
		assert.equal(candidates.length, max);
		assert.equal(candidates[0].shift, 1);
		assert.equal(candidates.at(-1)?.shift, max);
		assert.deepEqual(
			candidates.map(({ shift, output }) => ({ shift, output })),
			caesarBruteForce(input),
		);
		assert.deepEqual(
			[...scoredCaesarCandidates(input, 'score')].sort(
				(a, b) => a.shift - b.shift,
			),
			candidates,
		);
	}
});

test('空文字・空白のみ・非対応文字は同点でシフト昇順、有限スコア', () => {
	for (const input of ['', ' \n\t', '漢字123!?ゃっー😀ｶﾞ']) {
		const candidates = scoredCaesarCandidates(input, 'score');
		assert.equal(candidates.length, 25);
		assert.deepEqual(
			candidates.map((c) => c.shift),
			Array.from({ length: 25 }, (_, i) => i + 1),
		);
		for (const candidate of candidates) {
			assert.equal(candidate.output, input);
			assert.equal(candidate.score, 0);
		}
	}
});

test('濁音・半濁音、かな英字混在、非対応文字は既存変換どおり', () => {
	const plain = 'んンZz がぱゃー漢字ｶﾞ😀Ａ１';
	const encrypted = 'あアAa ぎぴゃー漢字ｶﾞ😀Ａ１';
	const candidate = scoredCaesarCandidates(encrypted)[0];
	assert.equal(candidate.output, plain);
	const decomposed = scoredCaesarCandidates('き\u3099ひ\u309a');
	assert.equal(decomposed[0].output, 'がぱ');
	assert.equal(decomposed.length, 45);
	assert.equal(scoredCaesarCandidates('あ')[44].output, 'い');
	assert.equal(scoredCaesarCandidates('a')[24].output, 'b');
});

for (const [plain, shift] of [
	['こんにちは', 3],
	['わたしはにほんごをはなします', 12],
	['きょうはいいてんきです', 45],
	['Hello world', 3],
	['The quick brown fox jumps over the lazy dog', 25],
	['This is a secret message for you', 1],
	['こんにちは Hello world', 7],
] as const) {
	test(`代表例を推測順の先頭へ: ${plain} / ${shift}`, () => {
		const encrypted = caesarCipher(plain, {
			shift,
			direction: 'encode',
		}).output;
		const ranked = scoredCaesarCandidates(encrypted, 'score');
		assert.equal(ranked[0].shift, shift);
		assert.equal(ranked[0].output, plain);
		assert.deepEqual(scoredCaesarCandidates(encrypted, 'score'), ranked);
		for (let i = 1; i < ranked.length; i++) {
			assert.ok(ranked[i - 1].score >= ranked[i].score);
			if (ranked[i - 1].score === ranked[i].score)
				assert.ok(ranked[i - 1].shift < ranked[i].shift);
		}
	});
}

test('英字の大小とカタカナも同じ頻度で評価', () => {
	assert.equal(scoreCaesarText('HELLO WORLD'), scoreCaesarText('hello world'));
	assert.equal(scoreCaesarText('コンニチハ'), scoreCaesarText('こんにちは'));
});
