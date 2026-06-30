import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	isValidDate,
	seirekiToWareki,
	warekiToSeireki,
} from '../../src/lib/tools/wareki-converter.ts';

test('isValidDate: 正常系・うるう年および存在しない日付の判定', () => {
	assert.strictEqual(
		isValidDate(2024, 2, 29),
		true,
		'2024年はうるう年のため2/29は有効',
	);
	assert.strictEqual(
		isValidDate(2023, 2, 29),
		false,
		'2023年は平年のため2/29は無効',
	);
	assert.strictEqual(isValidDate(2023, 2, 31), false, '2/31は無効');
	assert.strictEqual(isValidDate(2023, 13, 1), false, '13月は無効');
});

test('seirekiToWareki: 不存在日付のエラー検出', () => {
	const result = seirekiToWareki(2023, 2, 31);
	assert.ok(
		result.error?.includes('存在しない日付'),
		'2/31でエラーが返されること',
	);
});

test('warekiToSeireki: 不存在日付のエラー検出', () => {
	const result = warekiToSeireki('令和', 5, 2, 31);
	assert.ok(
		result.error?.includes('存在しない日付'),
		'令和5年2/31でエラーが返されること',
	);
});
