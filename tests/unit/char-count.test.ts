import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countChars } from '../../src/lib/tools/char-count.ts';

test('countChars: 通常テキストの文字数・バイト数計算', () => {
	const result = countChars('あいう');
	assert.strictEqual(result.charsWithSpaces, 3);
	assert.strictEqual(result.bytesUtf8, 9);
	assert.strictEqual(result.bytesShiftJis, 6);
	assert.strictEqual(result.unsupportedShiftJisCount, 0);
});

test('countChars: Shift-JIS非対応文字（絵文字・補助平面漢字等）の検出と正確なバイト数・警告', () => {
	const text = 'テスト🎉𩸽'; // 🎉 と 𩸽 は SJIS 範囲外
	const result = countChars(text);

	assert.ok(
		result.unsupportedShiftJisCount > 0,
		'SJIS非対応文字が検出されること',
	);
	assert.strictEqual(result.hasUnsupportedShiftJis, true);
});

test('countChars: grapheme (見た目の文字数) の計測', () => {
	const text = '👨‍👩‍👧‍👦'; // 1グラフェム cluster
	const result = countChars(text);
	assert.strictEqual(result.graphemes, 1);
});
