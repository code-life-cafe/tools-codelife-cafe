import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	type AnalyticsEvents,
	generateDedupeKey,
	getSearchQueryMetadata,
	type ToolRunSource,
} from '../../src/lib/analytics.ts';

test('getSearchQueryMetadata: 正常な検索クエリからメタデータを抽出する', () => {
	const meta1 = getSearchQueryMetadata('JSON 整形');
	assert.strictEqual(meta1.lengthBucket, '4-10');
	assert.strictEqual(meta1.hasJapanese, true);
	assert.strictEqual(meta1.tokenCount, 2);
	assert.strictEqual(meta1.q_redacted, undefined);
});

test('getSearchQueryMetadata: メールアドレス等のPIIを含む場合はq_redactedが付与される', () => {
	const meta2 = getSearchQueryMetadata('test@example.com');
	assert.strictEqual(meta2.hasJapanese, false);
	assert.strictEqual(meta2.q_redacted, true);
});

test('AnalyticsEvents: settings_restore は設定保持利用率の計測元を表現できる', () => {
	const event = {
		tool: 'json-formatter',
		source: 'url',
	} satisfies AnalyticsEvents['settings_restore'];

	assert.deepStrictEqual(event, { tool: 'json-formatter', source: 'url' });
});

test('AnalyticsEvents: tool_run はsourceとdedupeKeyを表現できる', () => {
	const event = {
		tool: 'base64',
		source: 'drop',
		dedupeKey: generateDedupeKey(),
	} satisfies AnalyticsEvents['tool_run'];

	assert.strictEqual(event.tool, 'base64');
	assert.strictEqual(event.source, 'drop');
	assert.match(
		event.dedupeKey,
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
	);
});

test('generateDedupeKey: 呼び出しごとに異なる値を返す（1操作=1UUID）', () => {
	const a = generateDedupeKey();
	const b = generateDedupeKey();
	assert.notStrictEqual(a, b);
});

test('ToolRunSource: 既知の起点をすべて列挙値として利用できる', () => {
	const sources: ToolRunSource[] = [
		'button',
		'drop',
		'file-input',
		'debounced-input',
		'paste',
		'shortcut',
		'api',
		'unknown',
	];
	assert.strictEqual(sources.length, 8);
});
