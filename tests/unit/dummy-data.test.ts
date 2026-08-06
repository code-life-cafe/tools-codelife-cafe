import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	FIELD_LABELS,
	generateDummyData,
	validateDummyDataInput,
} from '../../src/lib/tools/dummy-data.ts';

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

test('generateDummyData: CSV/TSVヘッダーは日本語ラベル、JSONキーは英語IDのまま、列順はfields順', () => {
	const fields = ['email', 'name', 'phone'] as const;

	const csv = generateDummyData([...fields], 3, 'csv');
	const csvHeader = csv.split('\n')[0];
	assert.strictEqual(
		csvHeader,
		fields.map((f) => FIELD_LABELS[f]).join(','),
		'CSVヘッダーはfields順の日本語ラベル',
	);

	const tsv = generateDummyData([...fields], 3, 'tsv');
	const tsvHeader = tsv.split('\n')[0];
	assert.strictEqual(
		tsvHeader,
		fields.map((f) => FIELD_LABELS[f]).join('\t'),
		'TSVヘッダーはfields順の日本語ラベル',
	);

	const json = generateDummyData([...fields], 3, 'json');
	const parsed = JSON.parse(json);
	for (const row of parsed) {
		assert.deepStrictEqual(
			Object.keys(row),
			[...fields],
			'JSONのキーは英語IDのままfields順',
		);
	}
});
