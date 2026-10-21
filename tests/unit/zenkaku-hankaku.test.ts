import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convert } from '../../src/lib/tools/zenkaku-hankaku.ts';

test('convert: スペースは記号と連動し、タブ・改行・ひらがな・漢字は維持する', () => {
	const options = {
		katakana: false,
		alpha: true,
		numbers: true,
		symbols: false,
	};
	assert.equal(
		convert('Ａ１　！\t\nかな漢字', 'toHankaku', options),
		'A1　！\t\nかな漢字',
	);
	assert.equal(
		convert('Ａ１　！\t\nかな漢字', 'toHankaku', { ...options, symbols: true }),
		'A1 !\t\nかな漢字',
	);
	assert.equal(
		convert('A1 !\t\nかな漢字', 'toZenkaku', options),
		'Ａ１ !\t\nかな漢字',
	);
	assert.equal(
		convert('A1 !\t\nかな漢字', 'toZenkaku', { ...options, symbols: true }),
		'Ａ１　！\t\nかな漢字',
	);
});

test('convert: カナ項目の既存の長音・句読点変換を維持する', () => {
	const options = {
		katakana: true,
		alpha: false,
		numbers: false,
		symbols: false,
	};
	assert.equal(
		convert('｢ﾊﾟｰﾃｨｰ｣｡ ABC123', 'toZenkaku', options),
		'「パーティー」。 ABC123',
	);
});

test('convert: 記号全種（［］｛｝（）．＊＋ 等）の往復変換が正しく、例外を投げない', () => {
	const zenkakuSymbols =
		'！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝～　';
	const hankakuSymbols = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~ ';

	const options = { katakana: true, alpha: true, numbers: true, symbols: true };

	// 全角 → 半角
	const toHankakuResult = convert(zenkakuSymbols, 'toHankaku', options);
	assert.strictEqual(toHankakuResult, hankakuSymbols);

	// 半角 → 全角
	const toZenkakuResult = convert(hankakuSymbols, 'toZenkaku', options);
	assert.strictEqual(toZenkakuResult, zenkakuSymbols);
});

test('convert: 英数字・カナ・記号が混在するテキストの変換検証', () => {
	const input = 'Ｈｅｌｌｏ！　２０２６年（令和８年）［テスト］＋＊';
	const expected = 'Hello! 2026年(令和8年)[テスト]+*';
	const options = {
		katakana: false,
		alpha: true,
		numbers: true,
		symbols: true,
	};

	const result = convert(input, 'toHankaku', options);
	assert.strictEqual(result, expected);
});
