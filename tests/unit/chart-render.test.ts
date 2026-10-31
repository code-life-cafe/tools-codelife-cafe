import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildChartSvg,
	type Column,
	escapeXml,
	validateChartSpec,
} from '../../src/lib/tools/chart-render.ts';

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
