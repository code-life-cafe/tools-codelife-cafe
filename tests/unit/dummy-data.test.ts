import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	FIELD_LABELS,
	formatDummyRecords,
	generateDummyData,
	generateDummyRecords,
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

test('formatDummyRecords: 同じレコードをJSON/CSV/TSVへ整形しても値・順序・件数が一致する（形式切替で再抽選しない）', () => {
	const fields = ['name', 'kana', 'email', 'number'] as const;
	const records = generateDummyRecords([...fields], 5);

	const json = formatDummyRecords(records, [...fields], 'json');
	const csv = formatDummyRecords(records, [...fields], 'csv');
	const tsv = formatDummyRecords(records, [...fields], 'tsv');

	const parsedJson = JSON.parse(json);
	assert.strictEqual(parsedJson.length, 5, 'JSON側の件数はレコード数と一致');

	const csvBody = csv.split('\n').slice(1);
	const tsvBody = tsv.split('\n').slice(1);
	assert.strictEqual(csvBody.length, 5, 'CSV側の件数はレコード数と一致');
	assert.strictEqual(tsvBody.length, 5, 'TSV側の件数はレコード数と一致');

	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		for (const field of fields) {
			assert.strictEqual(
				parsedJson[i][field],
				record[field],
				`JSON[${i}].${field} は元レコードと一致`,
			);
			assert.ok(
				csvBody[i].includes(String(record[field])),
				`CSV行${i}は元レコードの値${String(record[field])}を含む`,
			);
			assert.ok(
				tsvBody[i].includes(String(record[field])),
				`TSV行${i}は元レコードの値${String(record[field])}を含む`,
			);
		}
	}
});
