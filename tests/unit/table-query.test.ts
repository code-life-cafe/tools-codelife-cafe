import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	applyFilter,
	applySort,
	type Column,
	type FilterGroup,
	inferColumnType,
	parseDate,
	queryRows,
	type SortKey,
	validateFilterCondition,
} from '../../src/lib/tools/table-query.ts';

test('inferColumnType - 型推定', () => {
	assert.equal(inferColumnType(['100', '2,000', '￥300', '-50']), 'number');
	assert.equal(inferColumnType(['１２３', '456', '789']), 'number');
	assert.equal(inferColumnType(['100', '200', 'ABC', '300', '400']), 'number'); // 80% (4/5)
	assert.equal(inferColumnType(['100', 'ABC', 'XYZ', '300']), 'text'); // 50% (2/4 < 80%)
	assert.equal(inferColumnType(['2026-01-01', '2026/06/28']), 'date');
	assert.equal(inferColumnType(['true', 'false', 'TRUE']), 'boolean');
	assert.equal(inferColumnType(['りんご', 'みかん', 'バナナ']), 'text');
});

test('validateFilterCondition - 条件検証', () => {
	assert.equal(
		validateFilterCondition({
			columnId: 'col0',
			operator: 'between',
			value: 10,
		}),
		'範囲指定（between）には開始値と終了値の両方が必要です。',
	);
	assert.equal(
		validateFilterCondition({
			columnId: 'col0',
			operator: 'between',
			value: 10,
			value2: 20,
		}),
		null,
	);
	assert.equal(
		validateFilterCondition({ columnId: 'col0', operator: 'empty' }),
		null,
	);
});

test('applyFilter - フィルタ適用', () => {
	const columns: Column[] = [
		{ id: 'c0', name: '名前', type: 'text' },
		{ id: 'c1', name: '年齢', type: 'number' },
		{ id: 'c2', name: '入社日', type: 'date' },
	];
	const rows: string[][] = [
		['田中', '25', '2020-04-01'],
		['佐藤', '30', '2018-10-15'],
		['鈴木', '40', '2015-05-20'],
		['高橋', '25', '2022-01-10'],
	];

	// 年齢 = 25
	const g1: FilterGroup = {
		combinator: 'and',
		conditions: [{ columnId: 'c1', operator: 'eq', value: 25 }],
	};
	assert.deepEqual(applyFilter(rows, g1, columns), [0, 3]);

	// 年齢 > 25 AND 入社日 after 2017-01-01
	const g2: FilterGroup = {
		combinator: 'and',
		conditions: [
			{ columnId: 'c1', operator: 'gt', value: 25 },
			{ columnId: 'c2', operator: 'after', value: '2017-01-01' },
		],
	};
	assert.deepEqual(applyFilter(rows, g2, columns), [1]);

	// OR 条件
	const g3: FilterGroup = {
		combinator: 'or',
		conditions: [
			{ columnId: 'c0', operator: 'eq', value: '田中' },
			{ columnId: 'c0', operator: 'eq', value: '鈴木' },
		],
	};
	assert.deepEqual(applyFilter(rows, g3, columns), [0, 2]);
});

test('applySort - マルチカラム安定ソート', () => {
	const columns: Column[] = [
		{ id: 'c0', name: '部署', type: 'text' },
		{ id: 'c1', name: '給与', type: 'number' },
	];
	const rows: string[][] = [
		['開発', '300'],
		['営業', '400'],
		['開発', '500'],
		['開発', '300'], // 同じ部署・同じ給与
	];

	// 部署 asc, 給与 desc
	const sortKeys: SortKey[] = [
		{ columnId: 'c0', direction: 'asc' },
		{ columnId: 'c1', direction: 'desc' },
	];

	// 日本語あいうえお順: 営業 -> 開発
	// 開発の中で 500 -> 300 (元の index 0 と 3 は 0 が先)
	const sortedIndices = applySort(rows, sortKeys, columns);
	assert.deepEqual(sortedIndices, [1, 2, 0, 3]);
});

test('queryRows - パイプライン統合', () => {
	const columns: Column[] = [
		{ id: 'c0', name: '品名', type: 'text' },
		{ id: 'c1', name: '価格', type: 'number' },
	];
	const rows: string[][] = [
		['りんご', '100'],
		['みかん', '80'],
		['バナナ', '120'],
		['ぶどう', '200'],
	];

	const filter: FilterGroup = {
		combinator: 'and',
		conditions: [{ columnId: 'c1', operator: 'gte', value: 100 }],
	};
	const sortKeys: SortKey[] = [{ columnId: 'c1', direction: 'desc' }];

	const res = queryRows(rows, columns, { filter, sortKeys });
	// 価格 >= 100 は りんご(100), バナナ(120), ぶどう(200)
	// 価格 desc: ぶどう(index 3) -> バナナ(index 2) -> りんご(index 0)
	assert.deepEqual(res, [3, 2, 0]);
});

test('parseDate - 存在しない暦日はnullにする', () => {
	for (const v of [
		'2026-02-29',
		'2026-02-30',
		'2026-04-31',
		'2026/02/29',
		'2026/2/30',
		'2026/4/31',
		'2026-02-30T10:00:00',
		'2026-04-31T00:00:00Z',
	]) {
		assert.equal(parseDate(v), null, v);
	}
});

test('parseDate - 有効な日付は従来どおり解釈する', () => {
	const leap = parseDate('2024-02-29');
	assert.equal(leap?.getMonth(), 1);
	assert.equal(leap?.getDate(), 29);
	const slash = parseDate('2026/6/28');
	assert.equal(slash?.getMonth(), 5);
	assert.equal(slash?.getDate(), 28);
	assert.equal(parseDate('2026-12-31')?.getDate(), 31);
	assert.equal(
		parseDate('2026-01-15T10:30:00Z')?.toISOString(),
		'2026-01-15T10:30:00.000Z',
	);
	assert.equal(parseDate('2024-02-29T23:59:59Z')?.getUTCDate(), 29);
});

test('parseDate - 0000〜0099年を1900年代に補正しない', () => {
	for (const [input, year, month, day] of [
		['0001-01-01', 1, 0, 1],
		['0099/12/31', 99, 11, 31],
		['0000-02-29', 0, 1, 29],
	] as const) {
		const date = parseDate(input);
		assert.equal(date?.getFullYear(), year);
		assert.equal(date?.getMonth(), month);
		assert.equal(date?.getDate(), day);
	}
});

test('parseDate - タイムゾーンで存在しない暦日も別の日へ繰り上げない', () => {
	const previous = process.env.TZ;
	try {
		process.env.TZ = 'Pacific/Apia';
		const skipped = parseDate('2011-12-30');
		const next = parseDate('2011-12-31');
		assert.equal(skipped?.toISOString(), '2011-12-30T00:00:00.000Z');
		assert.notEqual(skipped?.getTime(), next?.getTime());
		assert.equal(parseDate('2011/12/30')?.getTime(), skipped?.getTime());
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test('inferColumnType - 存在しない日付はdateと推定しない', () => {
	assert.equal(
		inferColumnType(['2026-02-29', '2026-02-30', '2026-04-31']),
		'text',
	);
	assert.equal(inferColumnType(['2026-01-01', '2024-02-29']), 'date');
});

test('applyFilter - 存在しない日付は日付比較に含めない', () => {
	const columns: Column[] = [{ id: 'c0', name: 'd', type: 'date' }];
	const rows = [['2026-02-28'], ['2026-02-30'], ['2026-03-01']];
	const g: FilterGroup = {
		combinator: 'and',
		conditions: [{ columnId: 'c0', operator: 'neq', value: '2026-02-28' }],
	};
	assert.deepEqual(applyFilter(rows, g, columns), [2]);
});
