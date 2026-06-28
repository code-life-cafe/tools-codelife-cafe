import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maskText } from '../../src/lib/tools/masking';

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
