import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convert } from '../../src/lib/tools/zenkaku-hankaku';

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
