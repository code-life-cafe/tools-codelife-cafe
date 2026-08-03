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

test('HTMLレスポンスではpage_viewイベントを1件記録する', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequest({
		request: new Request('https://tools.codelife.cafe/json-formatter', {
			headers: {
				accept: 'text/html,application/xhtml+xml',
				'user-agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
			},
		}),
		next: async () =>
			new Response('<html></html>', {
				status: 200,
				headers: { 'content-type': 'text/html; charset=utf-8' },
			}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.deepStrictEqual(writes, [
		{
			blobs: ['page_view', '/json-formatter', '', '', '', 'human'],
			indexes: ['page_view'],
		},
	]);
});

test('AIエージェントUAのHTMLレスポンスはtraffic_type=ai_agentとしてpage_viewを記録する', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequest({
		request: new Request('https://tools.codelife.cafe/json-formatter', {
			headers: {
				accept: 'text/html',
				'user-agent':
					'Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)',
			},
		}),
		next: async () =>
			new Response('<html></html>', {
				status: 200,
				headers: { 'content-type': 'text/html' },
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

test('Accept: */* でもContent-Type: text/htmlのレスポンスはpage_viewを記録する（非ブラウザ流入の取りこぼし防止）', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequest({
		request: new Request('https://tools.codelife.cafe/json-formatter', {
			headers: {
				accept: '*/*',
				'user-agent': 'Mozilla/5.0 (compatible; ClaudeBot/1.0)',
			},
		}),
		next: async () =>
			new Response('<html></html>', {
				status: 200,
				headers: { 'content-type': 'text/html' },
			}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.deepStrictEqual(writes, [
		{
			blobs: ['page_view', '/json-formatter', '', '', '', 'ai_agent'],
			indexes: ['page_view'],
		},
	]);
});

test('Accept: text/html でも非HTMLレスポンスはpage_viewを記録しない', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequest({
		request: new Request('https://tools.codelife.cafe/json-formatter', {
			headers: { accept: 'text/html' },
		}),
		next: async () =>
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.deepStrictEqual(writes, []);
});

test('.jsアセットへのリクエストではpage_viewを記録しない', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequest({
		request: new Request('https://tools.codelife.cafe/assets/app.js', {
			headers: { accept: '*/*' },
		}),
		next: async () =>
			new Response('', {
				status: 200,
				headers: { 'content-type': 'application/javascript' },
			}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.deepStrictEqual(writes, []);
});

test('.cssアセットへのリクエストではpage_viewを記録しない', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequest({
		request: new Request('https://tools.codelife.cafe/assets/app.css', {
			headers: { accept: 'text/css,*/*;q=0.1' },
		}),
		next: async () =>
			new Response('', {
				status: 200,
				headers: { 'content-type': 'text/css' },
			}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.deepStrictEqual(writes, []);
});

test('/api/配下へのリクエストはレスポンスがtext/htmlでもpage_viewを記録しない', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequest({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			headers: { accept: 'text/html' },
		}),
		next: async () =>
			new Response('<html></html>', {
				status: 200,
				headers: { 'content-type': 'text/html' },
			}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.deepStrictEqual(writes, []);
});

test('/models/配下へのリクエストはレスポンスがtext/htmlでもpage_viewを記録しない', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequest({
		request: new Request(
			'https://tools.codelife.cafe/models/transcribe/tiny/main/config.json',
			{ headers: { accept: 'text/html' } },
		),
		next: async () =>
			new Response('<html></html>', {
				status: 200,
				headers: { 'content-type': 'text/html' },
			}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.deepStrictEqual(writes, []);
});

test('page_view記録処理が例外を投げてもレスポンスは正常に配信される', async () => {
	const response = await onRequest({
		request: new Request('https://tools.codelife.cafe/json-formatter', {
			headers: { accept: 'text/html' },
		}),
		next: async () =>
			new Response('<html>OK</html>', {
				status: 200,
				headers: { 'content-type': 'text/html' },
			}),
		env: {
			EVENTS: {
				writeDataPoint() {
					throw new Error('AE書き込み失敗');
				},
			},
		},
	});

	assert.strictEqual(response.status, 200);
	assert.strictEqual(await response.text(), '<html>OK</html>');
});

test('envが無い場合でもpage_view記録処理で例外を投げずレスポンスを返す', async () => {
	const response = await onRequest({
		request: new Request('https://tools.codelife.cafe/json-formatter', {
			headers: { accept: 'text/html' },
		}),
		next: async () =>
			new Response('<html>OK</html>', {
				status: 200,
				headers: { 'content-type': 'text/html' },
			}),
	});

	assert.strictEqual(response.status, 200);
});

test('?settings付きHTMLレスポンスはpage_view記録とX-Robots-Tag付与の両方を行う', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	const response = await onRequest({
		request: new Request(
			'https://tools.codelife.cafe/json-formatter?settings=abc',
			{ headers: { accept: 'text/html' } },
		),
		next: async () =>
			new Response('<html></html>', {
				status: 200,
				headers: { 'content-type': 'text/html' },
			}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});

	assert.strictEqual(response.headers.get('X-Robots-Tag'), 'noindex, follow');
	assert.strictEqual(writes.length, 1);
	assert.strictEqual(writes[0].blobs?.[1], '/json-formatter');
});
