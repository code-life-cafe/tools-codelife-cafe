import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maskText } from '../../src/lib/tools/masking.ts';

test('maskText: 全角数字の電話番号およびマイナンバー(12桁)の検出とマスキング', () => {
	const text =
		'電話：０９０-１２３４-５６７８、マイナンバー：１２３４５６７８９０１２';
	const options = {
		targets: new Set(['phone', 'mynumber'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);

	assert.strictEqual(result.counts.phone, 1, '全角電話番号が1件検出されること');
	assert.strictEqual(
		result.counts.mynumber,
		1,
		'全角マイナンバーが1件検出されること',
	);
	assert.ok(
		result.maskedText.includes('０９０-****-５６７８'),
		'電話番号が部分マスクされること',
	);
	assert.ok(
		result.maskedText.includes('************'),
		'マイナンバーがマスクされること',
	);
});

test('maskText: 半角/全角混在および境界値テスト', () => {
	const text = 'マイナンバーは123456789012です。';
	const options = {
		targets: new Set(['mynumber'] as const),
		maskChar: '●' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.mynumber, 1);
	assert.ok(result.maskedText.includes('●●●●●●●●●●●●'));
});

test('maskText: 行頭の氏名ラベル「氏名: 田中太郎」がマスクされる（partial）', () => {
	const text = '氏名: 田中太郎';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1, '氏名ラベルが1件検出されること');
	assert.strictEqual(result.maskedText, '氏名: 田***');
	assert.strictEqual(result.ranges[0].type, 'name');
	assert.strictEqual(result.ranges[0].start, 0);
	assert.strictEqual(result.ranges[0].end, text.length);
});

test('maskText: 行頭の氏名ラベル「氏名: 田中太郎」がマスクされる（full）', () => {
	const text = '氏名: 田中太郎';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(result.maskedText, '氏名: ****');
	assert.strictEqual(result.ranges[0].start, 0);
	assert.strictEqual(result.ranges[0].end, text.length);
});

test('maskText: 全角コロンの氏名ラベル「名前：田中太郎です。」で後続の文章がマスクされない', () => {
	const text = '名前：田中太郎です。よろしくお願いします。';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(
		result.maskedText,
		'名前：田***です。よろしくお願いします。',
	);
});

test('maskText: 日本語文中の姓名「担当は佐藤一郎です」がマスクされる（partial）', () => {
	const text = '担当は佐藤一郎です';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1, '文中の姓名が1件検出されること');
	assert.strictEqual(result.maskedText, '担当は佐***です');
	assert.strictEqual(result.ranges[0].start, 3);
	assert.strictEqual(result.ranges[0].end, 7);
});

test('maskText: 文末の姓名「田中太郎」がマスクされる（full）', () => {
	const text = '田中太郎';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1, '文末の姓名が1件検出されること');
	assert.strictEqual(result.maskedText, '****');
	assert.strictEqual(result.ranges[0].start, 0);
	assert.strictEqual(result.ranges[0].end, 4);
});

test('maskText: 文末の姓名「田中太郎」がマスクされる（partial）', () => {
	const text = '田中太郎';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(result.maskedText, '田***');
});

test('maskText: ひらがなの姓名「佐藤さくら」がマスクされる（partial）', () => {
	const text = '佐藤さくら';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1, 'ひらがなの名が検出されること');
	assert.strictEqual(result.maskedText, '佐****');
	assert.strictEqual(result.ranges[0].start, 0);
	assert.strictEqual(result.ranges[0].end, text.length);
});

test('maskText: ひらがなの姓名「佐藤さくら」がマスクされる（full）', () => {
	const text = '佐藤さくら';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(result.maskedText, '*****');
});

test('maskText: カタカナの姓名「田中サクラ」がマスクされる（partial）', () => {
	const text = '田中サクラ';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1, 'カタカナの名が検出されること');
	assert.strictEqual(result.maskedText, '田****');
});

test('maskText: カタカナの姓名「田中サクラ」がマスクされる（full）', () => {
	const text = '田中サクラ';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(result.maskedText, '*****');
});

test('maskText: 日本語文中のひらがな姓名「担当は佐藤さくらです」で「です」が維持される（partial）', () => {
	const text = '担当は佐藤さくらです';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(result.maskedText, '担当は佐****です');
	assert.strictEqual(result.ranges[0].start, 3);
	assert.strictEqual(result.ranges[0].end, 8);
});

test('maskText: 日本語文中のひらがな姓名「担当は佐藤さくらです」で「です」が維持される（full）', () => {
	const text = '担当は佐藤さくらです';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(result.maskedText, '担当は*****です');
});

test('maskText: マイナンバー(12桁)の先頭11桁が電話番号として誤検出されない', () => {
	const text = '012345678901';
	const options = {
		targets: new Set(['phone'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(
		result.counts.phone,
		0,
		'12桁連続数字は電話番号として検出されないこと',
	);
	assert.strictEqual(result.maskedText, text);
});

test('maskText: マイナンバー(12桁)対象ONなら全桁マスクされる', () => {
	const text = '012345678901';
	const options = {
		targets: new Set(['mynumber'] as const),
		maskChar: '*' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.mynumber, 1);
	assert.strictEqual(result.maskedText, '************');
});
