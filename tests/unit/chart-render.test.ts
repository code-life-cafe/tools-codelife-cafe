import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildChartSvg,
	type Column,
	validateChartSpec,
} from '../../src/lib/tools/chart-render.ts';

test('validateChartSpec - 仕様検証', () => {
	// bar で categoryColumn 欠落
	assert.equal(
		validateChartSpec({
			type: 'bar',
			valueColumns: ['c1'],
			aggregation: 'sum',
		}),
		'棒グラフ・折れ線グラフ・円グラフにはカテゴリ列の指定が必要です。',
	);

	// scatter で xColumn 欠落
	assert.equal(
		validateChartSpec({
			type: 'scatter',
			valueColumns: [],
			aggregation: 'none',
			yColumn: 'c1',
		}),
		'散布図にはX軸列とY軸列の両方の指定が必要です。',
	);

	// pie で valueColumns > 1
	assert.equal(
		validateChartSpec({
			type: 'pie',
			categoryColumn: 'c0',
			valueColumns: ['c1', 'c2'],
			aggregation: 'sum',
		}),
		'円グラフで指定できる値列は1つのみです。',
	);

	// 正常な bar
	assert.equal(
		validateChartSpec({
			type: 'bar',
			categoryColumn: 'c0',
			valueColumns: ['c1'],
			aggregation: 'sum',
		}),
		null,
	);
});

test('buildChartSvg - SVG文字列生成 (各種グラフ)', () => {
	const columns: Column[] = [
		{ id: 'c0', name: '部署', type: 'text' },
		{ id: 'c1', name: '売上', type: 'number' },
		{ id: 'c2', name: '利益', type: 'number' },
	];
	const rows: string[][] = [
		['営業', '100', '20'],
		['開発', '200', '50'],
		['営業', '150', '30'],
	];

	// 棒グラフ
	const barSvg = buildChartSvg(
		rows,
		columns,
		{
			type: 'bar',
			categoryColumn: 'c0',
			valueColumns: ['c1'],
			aggregation: 'sum',
		},
		{ dark: false, width: 600, height: 400 },
	);
	assert.ok(barSvg.includes('<svg'));

	// 円グラフ
	const pieSvg = buildChartSvg(
		rows,
		columns,
		{
			type: 'pie',
			categoryColumn: 'c0',
			valueColumns: ['c1'],
			aggregation: 'sum',
		},
		{ dark: true, width: 600, height: 400 },
	);
	assert.ok(pieSvg.includes('<path'));

	// 散布図
	const scatterSvg = buildChartSvg(
		rows,
		columns,
		{
			type: 'scatter',
			xColumn: 'c1',
			yColumn: 'c2',
			valueColumns: [],
			aggregation: 'none',
		},
		{ dark: false, width: 600, height: 400 },
	);
	assert.ok(scatterSvg.includes('<circle'));
});
