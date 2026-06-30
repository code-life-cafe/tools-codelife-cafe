import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	caesarBruteForce,
	caesarCipher,
	reverseString,
} from '../../src/lib/cipher/index.ts';

test('caesarCipher: 正のシフトでエンコード・デコードが往復一致する', () => {
	const original = 'Hello, World!';
	const encoded = caesarCipher(original, { shift: 3, direction: 'encode' });
	assert.strictEqual(encoded.output, 'Khoor, Zruog!');

	const decoded = caesarCipher(encoded.output, {
		shift: 3,
		direction: 'decode',
	});
	assert.strictEqual(decoded.output, original);
});

test('caesarCipher: 負のシフト・ラップアラウンドでエンコード・デコードが往復一致する', () => {
	const original = 'abc XYZ';
	const encoded = caesarCipher(original, { shift: -3, direction: 'encode' });
	const decoded = caesarCipher(encoded.output, {
		shift: -3,
		direction: 'decode',
	});
	assert.strictEqual(decoded.output, original);

	const largeShiftEncoded = caesarCipher(original, {
		shift: 29,
		direction: 'encode',
	});
	const largeShiftDecoded = caesarCipher(largeShiftEncoded.output, {
		shift: 29,
		direction: 'decode',
	});
	assert.strictEqual(largeShiftDecoded.output, original);
});

test('caesarCipher: 日本語（ひらがな・カタカナ）のシフトと往復一致', () => {
	const original = 'あいうえお';
	const encoded = caesarCipher(original, { shift: 1, direction: 'encode' });
	assert.strictEqual(encoded.output, 'いうえおか');

	const decoded = caesarCipher(encoded.output, {
		shift: 1,
		direction: 'decode',
	});
	assert.strictEqual(decoded.output, original);
});

test('caesarBruteForce: 暗号文に対するブルートフォース解読候補の生成', () => {
	const cipherText = 'Khoor'; // 'Hello' shifted by 3
	const results = caesarBruteForce(cipherText);
	const target = results.find((r) => r.shift === 3);
	assert.ok(target, 'シフト3の解読結果が存在すること');
	assert.strictEqual(target?.output, 'Hello');
});

test('reverseString: 絵文字・サロゲートペア・結合文字の反転で破損しない', () => {
	const text = 'Hello🎉';
	const reversed = reverseString(text);
	assert.strictEqual(reversed.output, '🎉olleH');

	const complexEmoji = '👨‍👩‍👧‍👦';
	const reversedComplex = reverseString(complexEmoji);
	assert.strictEqual(reversedComplex.output, complexEmoji);
});
