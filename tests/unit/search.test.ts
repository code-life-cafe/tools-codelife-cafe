import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	normalizeSearchText,
	scoreToolMatch,
} from '../../src/lib/tools/search.ts';

test('normalizeSearchText: 全角英数字は半角小文字に正規化される', () => {
	assert.strictEqual(normalizeSearchText('ＪＳＯＮ'), 'json');
	assert.strictEqual(normalizeSearchText('ＣＳＶ'), 'csv');
	assert.strictEqual(
		normalizeSearchText('JSON'),
		normalizeSearchText('ＪＳＯＮ'),
	);
});

test('normalizeSearchText: 半角カナは全角カナに正規化される', () => {
	assert.strictEqual(normalizeSearchText('ｶｳﾝﾄ'), 'カウント');
	assert.strictEqual(
		normalizeSearchText('ｶｳﾝﾄ'),
		normalizeSearchText('カウント'),
	);
});

test('normalizeSearchText: 半角の濁点・半濁点付きカナも合成される', () => {
	assert.strictEqual(normalizeSearchText('ｶﾞ'), 'ガ');
	assert.strictEqual(normalizeSearchText('ﾊﾟ'), 'パ');
});

test('normalizeSearchText: 既存のひらがな→カタカナ変換・大文字小文字は維持される', () => {
	assert.strictEqual(normalizeSearchText('かうんと'), 'カウント');
	assert.strictEqual(normalizeSearchText('CSV'), 'csv');
	assert.strictEqual(normalizeSearchText('Csv'), 'csv');
});

test('normalizeSearchText: 通常の日本語・記号は変化しない', () => {
	assert.strictEqual(normalizeSearchText('文字数カウント'), '文字数カウント');
	assert.strictEqual(normalizeSearchText('json-csv'), 'json-csv');
});

test('scoreToolMatch: 全角クエリと半角クエリで同じ候補・スコアを返す', () => {
	const tool = {
		id: 'json-csv',
		title: 'JSON ↔ CSV 変換',
		description: 'JSONとCSVを相互変換します',
		categories: ['データ変換'],
		keywords: ['JSON', 'CSV'],
	} as unknown as import('../../src/lib/tools/catalog.ts').ToolCatalogItem;

	const halfwidthScore = scoreToolMatch(tool, 'json');
	const fullwidthScore = scoreToolMatch(tool, 'ＪＳＯＮ');
	assert.ok(halfwidthScore > 0, '半角クエリはヒットする');
	assert.strictEqual(
		fullwidthScore,
		halfwidthScore,
		'全角クエリと半角クエリのスコアは一致する',
	);
});

test('scoreToolMatch: 半角カナクエリでカタカナタイトルにヒットする', () => {
	const tool = {
		id: 'char-count',
		title: '文字数カウント',
		description: '文字数・バイト数・行数を数えます',
		categories: ['テキスト処理'],
		keywords: ['文字数', 'バイト数', '行数'],
	} as unknown as import('../../src/lib/tools/catalog.ts').ToolCatalogItem;

	assert.ok(scoreToolMatch(tool, 'ｶｳﾝﾄ') > 0, '半角カナ「ｶｳﾝﾄ」がヒットする');
	assert.strictEqual(
		scoreToolMatch(tool, 'ｶｳﾝﾄ'),
		scoreToolMatch(tool, 'カウント'),
		'半角カナと全角カナのスコアは一致する',
	);
});
