import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	fromCodePoints,
	getCodePoints,
	getNextCodePointIndex,
} from '../../src/lib/string-utils.ts';

test('getCodePoints: サロゲートペアを含む文字列をコードポイント配列へ正しく分解する', () => {
	// 'あ'(U+3042) と '🎉'(U+1F389, サロゲートペア) を含む
	assert.deepStrictEqual(getCodePoints('あ🎉'), [0x3042, 0x1f389]);
	// 空文字列は空配列
	assert.deepStrictEqual(getCodePoints(''), []);
});

test('fromCodePoints: getCodePoints との往復変換がサロゲートペアを破損せず無損失', () => {
	const original = 'A𩸽あ🎉'; // ASCII・補助漢字(U+29E3D)・かな・絵文字が混在
	assert.strictEqual(fromCodePoints(getCodePoints(original)), original);
	// 空配列は空文字列
	assert.strictEqual(fromCodePoints([]), '');
});

test('getNextCodePointIndex: サロゲートペアは2、BMP内の文字は1だけインデックスを進める', () => {
	const str = '🎉a'; // '🎉' は length 2 のサロゲートペア
	assert.strictEqual(getNextCodePointIndex(str, 0), 2); // サロゲートペアをまたぐ
	assert.strictEqual(getNextCodePointIndex(str, 2), 3); // 'a' は1進む
	assert.strictEqual(getNextCodePointIndex('あ', 0), 1); // BMP内の単一文字
});
