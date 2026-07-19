import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequest } from '../../functions/_middleware.ts';
import { onRequestPost } from '../../functions/api/event.ts';

test('settings付きURLではX-Robots-Tagでnoindexを返す', async () => {
	const response = await onRequest({
		request: new Request(
			'https://tools.codelife.cafe/json-formatter?settings=abc',
		),
		next: async () => new Response('<html></html>', { status: 200 }),
	});

	assert.strictEqual(response.headers.get('X-Robots-Tag'), 'noindex, follow');
});

test('settingsなしURLではX-Robots-Tagを付与しない', async () => {
	const response = await onRequest({
		request: new Request('https://tools.codelife.cafe/json-formatter'),
		next: async () => new Response('<html></html>', { status: 200 }),
	});

	assert.strictEqual(response.headers.get('X-Robots-Tag'), null);
});

test('settings_restoreイベントをAnalytics Engineへ書き込む', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	const response = await onRequestPost({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			body: JSON.stringify({
				event: 'settings_restore',
				props: { tool: 'json-formatter', source: 'url' },
			}),
			headers: { origin: 'https://tools.codelife.cafe' },
		}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.strictEqual(response.status, 204);
	assert.deepStrictEqual(writes, [
		{
			blobs: ['settings_restore', 'json-formatter', 'url', '', '', 'unknown'],
			indexes: ['settings_restore'],
		},
	]);
});

test('匿名セッションIDをblob5に格納する', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	const response = await onRequestPost({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			body: JSON.stringify({
				event: 'tool_run',
				props: { tool: 'json-formatter' },
				sessionId: 'abc-123',
			}),
			headers: { origin: 'https://tools.codelife.cafe' },
		}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.strictEqual(response.status, 204);
	assert.deepStrictEqual(writes, [
		{
			blobs: ['tool_run', 'json-formatter', '', '', 'abc-123', 'unknown'],
			indexes: ['tool_run'],
		},
	]);
});

test('過長な匿名セッションIDは無視して空文字にする', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequestPost({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			body: JSON.stringify({
				event: 'tool_run',
				props: { tool: 'json-formatter' },
				sessionId: 'x'.repeat(200),
			}),
			headers: { origin: 'https://tools.codelife.cafe' },
		}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.deepStrictEqual(writes[0].blobs, [
		'tool_run',
		'json-formatter',
		'',
		'',
		'',
		'unknown',
	]);
});

test('既知のAIエージェントUAはtraffic_type=ai_agentとしてblob6に格納する', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequestPost({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			body: JSON.stringify({
				event: 'tool_run',
				props: { tool: 'cipher' },
			}),
			headers: {
				origin: 'https://tools.codelife.cafe',
				'user-agent':
					'Mozilla/5.0 (compatible; ClaudeBot/1.0; +https://anthropic.com)',
			},
		}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.strictEqual(writes[0].blobs?.[5], 'ai_agent');
});

test('既知の検索クローラーUAはtraffic_type=crawlerとしてblob6に格納する', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequestPost({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			body: JSON.stringify({
				event: 'tool_run',
				props: { tool: 'cipher' },
			}),
			headers: {
				origin: 'https://tools.codelife.cafe',
				'user-agent':
					'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
			},
		}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.strictEqual(writes[0].blobs?.[5], 'crawler');
});

test('通常ブラウザUAかつwebdriver未検知はtraffic_type=humanとしてblob6に格納する', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequestPost({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			body: JSON.stringify({
				event: 'tool_run',
				props: { tool: 'cipher' },
				webdriver: false,
			}),
			headers: {
				origin: 'https://tools.codelife.cafe',
				'user-agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
			},
		}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.strictEqual(writes[0].blobs?.[5], 'human');
});

test('通常ブラウザUAでもnavigator.webdriver=trueならtraffic_type=unknownとする', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequestPost({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			body: JSON.stringify({
				event: 'tool_run',
				props: { tool: 'cipher' },
				webdriver: true,
			}),
			headers: {
				origin: 'https://tools.codelife.cafe',
				'user-agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
			},
		}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.strictEqual(writes[0].blobs?.[5], 'unknown');
});
