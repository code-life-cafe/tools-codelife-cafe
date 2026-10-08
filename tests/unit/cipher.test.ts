import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	caesarBruteForce,
	caesarCipher,
	morseDecode,
	morseEncode,
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

test('morseEncode: 欧文・数字・記号の正常変換は従来どおりで通知対象なし', () => {
	const r = morseEncode('Hello World');
	assert.strictEqual(r.output, '.... . .-.. .-.. --- / .-- --- .-. .-.. -..');
	assert.deepStrictEqual(r.unsupportedChars, []);
	assert.strictEqual(r.unsupportedCount, 0);

	assert.strictEqual(morseEncode('SOS').output, '... --- ...');
	assert.strictEqual(morseEncode('A1?').output, '.- .---- ..--..');
	assert.strictEqual(morseEncode('  a   b ').output, '.- / -...');
});

test('morseEncode: 日本語・絵文字は出力から除外し、対象文字と件数を返す', () => {
	const r = morseEncode('SOS 日本語 😀');
	assert.strictEqual(r.output, '... --- ...');
	assert.deepStrictEqual(r.unsupportedChars, ['日', '本', '語', '😀']);
	assert.strictEqual(r.unsupportedCount, 4);
});

test('morseEncode: 繰り返しの未対応文字は種類を重複させず件数に数える', () => {
	const r = morseEncode('A😀😀B😀');
	assert.strictEqual(r.output, '.- -...');
	assert.deepStrictEqual(r.unsupportedChars, ['😀']);
	assert.strictEqual(r.unsupportedCount, 3);
});

test('morseEncode: 未対応文字のみなら出力は空で件数を返す', () => {
	const r = morseEncode('日本語');
	assert.strictEqual(r.output, '');
	assert.strictEqual(r.unsupportedCount, 3);
});

test('morseEncode: 非ASCII文字を大文字化せず元の文字で通知する', () => {
	const r = morseEncode('café ıſßﬃ');
	assert.equal(r.output, '-.-. .- ..-.');
	assert.deepEqual(r.unsupportedChars, ['é', 'ı', 'ſ', 'ß', 'ﬃ']);
	assert.equal(r.unsupportedCount, 5);
});

test('morseDecode: 継承プロパティ名も不明符号として扱う', () => {
	const r = morseDecode('constructor toString __proto__ / ...');
	assert.equal(r.output, '??? S');
	assert.deepEqual(r.unknownCodes, ['constructor', 'toString', '__proto__']);
	assert.equal(r.unknownCount, 3);
});

test('morseDecode: 正常な符号は通知対象なし', () => {
	const r = morseDecode('... --- ... / .... .. ');
	assert.strictEqual(r.output, 'SOS HI');
	assert.deepStrictEqual(r.unknownCodes, []);
	assert.strictEqual(r.unknownCount, 0);
});

test('morseDecode: 不明符号は「?」に置換し符号と件数を返す', () => {
	const r = morseDecode('... ....... --- .......');
	assert.strictEqual(r.output, 'S?O?');
	assert.deepStrictEqual(r.unknownCodes, ['.......']);
	assert.strictEqual(r.unknownCount, 2);
});

test('morseDecode: 正規の疑問符(..--..)は不明符号として数えない', () => {
	const r = morseDecode('..--..');
	assert.strictEqual(r.output, '?');
	assert.strictEqual(r.unknownCount, 0);

	const mixed = morseDecode('..--.. -.-.-.-.');
	assert.strictEqual(mixed.output, '??');
	assert.deepStrictEqual(mixed.unknownCodes, ['-.-.-.-.']);
	assert.strictEqual(mixed.unknownCount, 1);
});
