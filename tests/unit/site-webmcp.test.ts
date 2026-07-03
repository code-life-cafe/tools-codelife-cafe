import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createSiteTools,
	type SiteToolSummary,
} from '../../src/lib/webmcp/tools/site.webmcp.ts';

const FIXTURE_CATALOG: SiteToolSummary[] = [
	{
		id: 'zenkaku-hankaku',
		title: '全角↔半角変換',
		description: 'カタカナ・英数字・記号の全角半角を一括変換。',
		url: 'https://tools.codelife.cafe/zenkaku-hankaku',
		category: 'テキスト変換',
		keywords: ['全角', '半角', 'カタカナ'],
	},
	{
		id: 'hash',
		title: 'ハッシュ生成',
		description: 'MD5 / SHA-256 / SHA-512 のハッシュ値を計算。',
		url: 'https://tools.codelife.cafe/hash',
		category: '開発ツール',
		keywords: ['hash', 'sha256', 'checksum'],
	},
];

function getTool(name: string) {
	const tool = createSiteTools(FIXTURE_CATALOG).find((t) => t.name === name);
	assert.ok(tool, `tool "${name}" should exist`);
	return tool;
}

// --- list_tools ---

test('list_tools: 全ツールをkeywordsなしのサマリーで返す', async () => {
	const result = await getTool('list_tools').run({});
	assert.ok(result.ok);
	const { tools } = result.value as { tools: Record<string, unknown>[] };
	assert.equal(tools.length, 2);
	assert.deepEqual(tools[0], {
		id: 'zenkaku-hankaku',
		title: '全角↔半角変換',
		description: 'カタカナ・英数字・記号の全角半角を一括変換。',
		url: 'https://tools.codelife.cafe/zenkaku-hankaku',
		category: 'テキスト変換',
	});
});

test('list_tools: undefined / null 入力も許容する', async () => {
	assert.ok((await getTool('list_tools').run(undefined)).ok);
	assert.ok((await getTool('list_tools').run(null)).ok);
});

test('list_tools: オブジェクト以外の入力は拒否する', async () => {
	assert.equal((await getTool('list_tools').run('x')).ok, false);
	assert.equal((await getTool('list_tools').run(42)).ok, false);
});

// --- search_tools ---

test('search_tools: タイトルの部分一致で検索できる', async () => {
	const result = await getTool('search_tools').run({ query: '半角' });
	assert.ok(result.ok);
	const { tools } = result.value as { tools: { id: string }[] };
	assert.deepEqual(
		tools.map((t) => t.id),
		['zenkaku-hankaku'],
	);
});

test('search_tools: キーワードに大文字小文字を区別せず一致する', async () => {
	const result = await getTool('search_tools').run({ query: 'SHA256' });
	assert.ok(result.ok);
	const { tools } = result.value as { tools: { id: string }[] };
	assert.deepEqual(
		tools.map((t) => t.id),
		['hash'],
	);
});

test('search_tools: カテゴリでも一致する', async () => {
	const result = await getTool('search_tools').run({ query: '開発' });
	assert.ok(result.ok);
	const { tools } = result.value as { tools: { id: string }[] };
	assert.deepEqual(
		tools.map((t) => t.id),
		['hash'],
	);
});

test('search_tools: 一致なしは空配列を返す', async () => {
	const result = await getTool('search_tools').run({
		query: '存在しないツール名',
	});
	assert.ok(result.ok);
	assert.deepEqual(result.value, { tools: [] });
});

test('search_tools: queryが空・空白のみ・非文字列・欠落なら失敗する', async () => {
	const tool = getTool('search_tools');
	assert.equal((await tool.run({ query: '' })).ok, false);
	assert.equal((await tool.run({ query: '   ' })).ok, false);
	assert.equal((await tool.run({ query: 42 })).ok, false);
	assert.equal((await tool.run({})).ok, false);
	assert.equal((await tool.run('半角')).ok, false);
});

test('search_tools: 200文字を超えるqueryは拒否する', async () => {
	const result = await getTool('search_tools').run({ query: 'あ'.repeat(201) });
	assert.equal(result.ok, false);
});
