import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeUnicode, unescapeUnicode } from '../../src/lib/string-utils.ts';
import {
	textToUnicode,
	unicodeToText,
} from '../../src/lib/tools/unicode-converter.ts';

test('unicodeToText: \\uXXXX および \\u{XXXXX} 双方の形式を正しくデコードできる', () => {
	const legacyInput = '\\u3042\\u3044\\u3046'; // あいう
	assert.strictEqual(unicodeToText(legacyInput), 'あいう');

	const codePointInput = '\\u{1F389}\\u{3042}'; // 🎉あ
	assert.strictEqual(unicodeToText(codePointInput), '🎉あ');
});

test('textToUnicode: サロゲートペア文字（絵文字・補助平面文字）が分割破損せず往復変換が無損失', () => {
	const emoji = '🎉𩸽';
	const encoded = textToUnicode(emoji);
	// サロゲートペアとして無損失にエンコード・デコードできる
	const decoded = unicodeToText(encoded);
	assert.strictEqual(decoded, emoji);
});

test('string-utils: escapeUnicode の useCodePointSyntax オプション検証', () => {
	const str = '🎉';
	const codePointEscaped = escapeUnicode(str, true);
	assert.strictEqual(codePointEscaped.toLowerCase(), '\\u{1f389}');
	assert.strictEqual(unescapeUnicode(codePointEscaped), '🎉');
});
