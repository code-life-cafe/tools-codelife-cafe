import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	generateDummyData,
	validateDummyDataInput,
} from '../../src/lib/tools/dummy-data';

test('validateDummyDataInput: 境界値 (0, 1, 1000, 1001) および負数のバリデーション', () => {
	assert.strictEqual(validateDummyDataInput(1, ['name']), null, '1件は正常');
	assert.strictEqual(
		validateDummyDataInput(1000, ['name']),
		null,
		'1000件は正常',
	);

	assert.ok(validateDummyDataInput(0, ['name']), '0件はエラー');
	assert.ok(validateDummyDataInput(-5, ['name']), '負数はエラー');
	assert.ok(
		validateDummyDataInput(1001, ['name']),
		'1001件（上限超過）はエラー',
	);
});

test('generateDummyData: 正常系および範囲外件数でのエラー送出', () => {
	const result = generateDummyData(['name', 'email'], 5, 'json');
	const parsed = JSON.parse(result);
	assert.strictEqual(parsed.length, 5);

	assert.throws(() => {
		generateDummyData(['name'], 0, 'json');
	}, /1〜1000/);

	assert.throws(() => {
		generateDummyData(['name'], 1001, 'json');
	}, /1〜1000/);
});
