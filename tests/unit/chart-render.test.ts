import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildChartSvg,
	type ChartSpec,
	type Column,
	escapeXml,
	validateChartSpec,
} from '../../src/lib/tools/chart-render.ts';
import { inferColumnType, queryRows } from '../../src/lib/tools/table-query.ts';

test('escapeXml - エスケープ処理', () => {
	assert.equal(
		escapeXml('<script>alert("xss")</script>'),
		'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
	);
});

test('validateChartSpec - 仕様検証', () => {
	assert.equal(
		validateChartSpec({
			type: 'bar',
			valueColumns: ['c1'],
			aggregation: 'sum',
		}),
		'棒グラフ・折れ線グラフ・円グラフにはカテゴリ列の指定が必要です。',
	);
});

test('buildChartSvg - 各種グラフとエスケープ・count集計', () => {
	const columns: Column[] = [
		{ id: 'c0', name: '部署', type: 'text' },
		{ id: 'c1', name: '担当者', type: 'text' },
	];
	const rows: string[][] = [
		['営業', '田中'],
		['<script>', '鈴木'],
		['営業', '佐藤'],
	];

	// count モードでテキスト列をカウント
	const countSvg = buildChartSvg(
		rows,
		columns,
		{
			type: 'bar',
			categoryColumn: 'c0',
			valueColumns: ['c1'],
			aggregation: 'count',
		},
		{ dark: false, width: 600, height: 400 },
	);
	assert.ok(countSvg.includes('<svg'));
	assert.ok(!countSvg.includes('<script>'));
	assert.ok(countSvg.includes('&lt;script&gt;'));
});

test('buildChartSvg - 値列の指数表記は従来どおり数値として集計・描画する', () => {
	const columns: Column[] = [
		{ id: 'c0', name: 'カテゴリ', type: 'text' },
		{ id: 'c1', name: '値', type: 'number' },
	];
	const opts = { dark: false, width: 600, height: 400 };
	const pie = buildChartSvg(
		[
			['A', '1e2'],
			['A', '20'],
			['B', '5'],
		],
		columns,
		{
			type: 'pie',
			categoryColumn: 'c0',
			valueColumns: ['c1'],
			aggregation: 'sum',
		},
		opts,
	);
	assert.ok(pie.includes('120'), 'A の合計 120 が描画される');

	const scatter = buildChartSvg(
		[
			['1e2', '3'],
			['1', '2'],
		],
		[
			{ id: 'c0', name: 'x', type: 'number' },
			{ id: 'c1', name: 'y', type: 'number' },
		],
		{
			type: 'scatter',
			xColumn: 'c0',
			yColumn: 'c1',
			valueColumns: [],
			aggregation: 'none',
		},
		opts,
	);
	assert.equal(scatter.match(/<circle/g)?.length, 2);
});

const pieColumns: Column[] = [
	{ id: 'c0', name: 'カテゴリ', type: 'text' },
	{ id: 'c1', name: '値', type: 'number' },
];
const pieSpec: ChartSpec = {
	type: 'pie',
	categoryColumn: 'c0',
	valueColumns: ['c1'],
	aggregation: 'sum',
};
const pieOptions = { dark: false, width: 600, height: 400 };

test('円グラフ - 正の値が1カテゴリなら完全な円を描く（#573）', () => {
	const svg = buildChartSvg([['売上', '10']], pieColumns, pieSpec, pieOptions);
	assert.match(svg, /<circle cx="315" cy="195" r="135"/);
	assert.equal(svg.match(/<circle\b/g)?.length, 1);
	assert.doesNotMatch(svg, /<path\b/);
	assert.match(svg, /売上: 10<\/text>/);
});

test('円グラフ - 0値が前後にあっても円・色・凡例を保持する（#573）', () => {
	const rows = [
		['ゼロ前', '0'],
		['売上', '10'],
		['ゼロ後', '0'],
	];
	for (const dark of [false, true]) {
		const svg = buildChartSvg(rows, pieColumns, pieSpec, {
			...pieOptions,
			dark,
		});
		assert.equal(svg.match(/<circle\b/g)?.length, 1);
		assert.match(
			svg,
			new RegExp(`<circle[^>]*fill="${dark ? '#34d399' : '#059669'}"`),
		);
		assert.doesNotMatch(svg, /<path\b/);
		assert.match(svg, /ゼロ前: 0<\/text>/);
		assert.match(svg, /売上: 10<\/text>/);
		assert.match(svg, /ゼロ後: 0<\/text>/);
	}
});

test('円グラフ - 集計後または絞り込み後の1カテゴリも完全な円になる（#573）', () => {
	const rows = [
		['売上', '3'],
		['売上', '7'],
		['その他', '5'],
	];
	const indices = queryRows(rows, pieColumns, {
		filter: {
			combinator: 'and',
			conditions: [{ columnId: 'c0', operator: 'eq', value: '売上' }],
		},
	});
	assert.deepEqual(indices, [0, 1]);
	const svg = buildChartSvg(
		indices.map((i) => rows[i]),
		pieColumns,
		pieSpec,
		pieOptions,
	);
	assert.equal(svg.match(/<circle\b/g)?.length, 1);
	assert.match(svg, /売上: 10<\/text>/);
	assert.doesNotMatch(svg, /その他/);
});

test('円グラフ - 2カテゴリの円弧・合計・凡例と全0の挙動を維持する（#573）', () => {
	const svg = buildChartSvg(
		[
			['売上', '3'],
			['売上', '7'],
			['その他', '5'],
		],
		pieColumns,
		pieSpec,
		pieOptions,
	);
	assert.equal(svg.match(/<path\b/g)?.length, 2);
	assert.doesNotMatch(svg, /<circle\b/);
	assert.match(svg, /A 135 135 0 1 1 /);
	assert.match(svg, /A 135 135 0 0 1 /);
	assert.match(svg, /売上: 10<\/text>/);
	assert.match(svg, /その他: 5<\/text>/);
	const zeroSvg = buildChartSvg(
		[
			['ゼロ', '0'],
			['負値', '-1'],
		],
		pieColumns,
		pieSpec,
		pieOptions,
	);
	assert.doesNotMatch(zeroSvg, /<(circle|path)\b/);
	assert.match(zeroSvg, /ゼロ: 0<\/text>/);
	assert.match(zeroSvg, /負値: 0<\/text>/);
});

test('booleanの型推定・フィルタ後のグラフ集計に空欄・不正値を含めない（#574）', () => {
	const rows = [
		['合計', '2', 'true'],
		['合計', '3', 'false'],
		['合計', '5', '1'],
		['合計', '7', '0'],
		['合計', '100', ''],
		['合計', '1000', 'unknown'],
	];
	const type = inferColumnType(rows.map((r) => r[2]));
	assert.equal(type, 'boolean');
	const columns: Column[] = [...pieColumns, { id: 'c2', name: '有効', type }];
	for (const { operator, indices, sum } of [
		{ operator: 'eq', indices: [1, 3], sum: 10 },
		{ operator: 'neq', indices: [0, 2], sum: 7 },
	] as const) {
		const filtered = queryRows(rows, columns, {
			filter: {
				combinator: 'and',
				conditions: [{ columnId: 'c2', operator, value: 'false' }],
			},
		});
		assert.deepEqual(filtered, [...indices]);
		const svg = buildChartSvg(
			filtered.map((i) => rows[i]),
			columns,
			pieSpec,
			pieOptions,
		);
		assert.match(svg, new RegExp(`合計: ${sum}</text>`));
	}
});
