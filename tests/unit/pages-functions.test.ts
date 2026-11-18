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
			blobs: [
				'tool_run',
				'json-formatter',
				'',
				'',
				'abc-123',
				'unknown',
				'unknown',
				'',
			],
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
		'unknown',
		'',
	]);
});

test('tool_runのsource/dedupeKeyを検証してblob7/blob8に格納する', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequestPost({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			body: JSON.stringify({
				event: 'tool_run',
				props: {
					tool: 'base64',
					source: 'drop',
					dedupeKey: '11111111-1111-1111-1111-111111111111',
				},
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
		'base64',
		'',
		'',
		'',
		'unknown',
		'drop',
		'11111111-1111-1111-1111-111111111111',
	]);
});

test('未知のsource値は許可リストにないため unknown にフォールバックする', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequestPost({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			body: JSON.stringify({
				event: 'tool_run',
				props: { tool: 'base64', source: 'not-a-real-source' },
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

	assert.strictEqual(writes[0].blobs?.[6], 'unknown');
});

test('過長なdedupeKeyは無視して空文字にする', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequestPost({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			body: JSON.stringify({
				event: 'tool_run',
				props: { tool: 'base64', source: 'button', dedupeKey: 'x'.repeat(200) },
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

	assert.strictEqual(writes[0].blobs?.[6], 'button');
	assert.strictEqual(writes[0].blobs?.[7], '');
});

test('tool_run以外のイベントにはsource/dedupeKey用のblobを付与しない', async () => {
	const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
	await onRequestPost({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			body: JSON.stringify({
				event: 'tool_engage',
				props: { tool: 'base64' },
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
		'tool_engage',
		'base64',
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

// ---------------------------------------------------------------------------
// /api/event の入力検証（自由文・過大な本文を書き込ませない）
// ---------------------------------------------------------------------------

async function postEvent(
	payload: unknown,
	init: { rawBody?: string; headers?: Record<string, string> } = {},
) {
	const writes: Array<{
		blobs?: string[];
		doubles?: number[];
		indexes?: string[];
	}> = [];
	const response = await onRequestPost({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			body: init.rawBody ?? JSON.stringify(payload),
			headers: { origin: 'https://tools.codelife.cafe', ...init.headers },
		}),
		env: {
			EVENTS: {
				writeDataPoint(data) {
					writes.push(data);
				},
			},
		},
	});
	return { response, writes };
}

test('slug形式でないtool（自由文・過長・大文字・空）は書き込まない', async () => {
	for (const tool of [
		'user@example.com の入力本文',
		'a'.repeat(65),
		'Base64',
		'',
		'base64/../x',
		'<script>',
	]) {
		for (const event of ['tool_run', 'tool_engage', 'shared_url_open']) {
			const { response, writes } = await postEvent({
				event,
				props: { tool, source: 'button' },
			});
			assert.strictEqual(response.status, 204);
			assert.deepStrictEqual(writes, [], `${event}: ${tool}`);
		}
		const restored = await postEvent({
			event: 'settings_restore',
			props: { tool, source: 'url' },
		});
		assert.deepStrictEqual(restored.writes, [], `settings_restore: ${tool}`);
	}
});

test('slug形式のtoolは上限64文字まで書き込む（境界値）', async () => {
	const tool = `a${'-b'.repeat(31)}c`;
	assert.strictEqual(tool.length, 64);
	const { writes } = await postEvent({
		event: 'tool_engage',
		props: { tool },
	});
	assert.strictEqual(writes.length, 1);
	assert.strictEqual(writes[0].blobs?.[1], tool);
});

test('related_click / top_block_click は識別子と表示位置の範囲を検証する', async () => {
	const ok = await postEvent({
		event: 'related_click',
		props: {
			from: 'base64',
			to: 'url-encoder',
			setId: 'developer',
			position: 2,
		},
	});
	assert.deepStrictEqual(ok.writes, [
		{
			blobs: [
				'related_click',
				'base64',
				'url-encoder',
				'developer',
				'',
				'unknown',
			],
			doubles: [2],
			indexes: ['related_click'],
		},
	]);

	// setIdだけが不正な場合は、イベントは残してsetIdを空にする
	const badSet = await postEvent({
		event: 'related_click',
		props: {
			from: 'base64',
			to: 'url-encoder',
			setId: '自由文 text',
			position: 0,
		},
	});
	assert.strictEqual(badSet.writes.length, 1);
	assert.strictEqual(badSet.writes[0].blobs?.[3], '');

	for (const props of [
		{ from: 'base64', to: 'free text', position: 0 },
		{ from: 'x'.repeat(100), to: 'base64', position: 0 },
		{ from: 'base64', to: 'url-encoder', position: -1 },
		{ from: 'base64', to: 'url-encoder', position: 1.5 },
		{ from: 'base64', to: 'url-encoder', position: 1000 },
		{ from: 'base64', to: 'url-encoder', position: Number.MAX_VALUE },
	]) {
		const { writes } = await postEvent({ event: 'related_click', props });
		assert.deepStrictEqual(writes, [], JSON.stringify(props));
	}

	const top = await postEvent({
		event: 'top_block_click',
		props: { block: 'csv-preprocessing', tool: 'csv-fixer', position: 999 },
	});
	assert.strictEqual(top.writes.length, 1);
	for (const props of [
		{ block: 'free text block', tool: 'csv-fixer', position: 0 },
		{ block: 'csv-preprocessing', tool: 'CSV Fixer', position: 0 },
		{ block: 'csv-preprocessing', tool: 'csv-fixer', position: 1e9 },
	]) {
		const { writes } = await postEvent({ event: 'top_block_click', props });
		assert.deepStrictEqual(writes, [], JSON.stringify(props));
	}
});

test('search_empty は既知の文字数区分だけを書き込む', async () => {
	for (const lengthBucket of ['0', '1-3', '4-10', '11-30', '31+']) {
		const { writes } = await postEvent({
			event: 'search_empty',
			props: { lengthBucket, hasJapanese: true },
		});
		assert.strictEqual(writes.length, 1, lengthBucket);
		assert.strictEqual(writes[0].blobs?.[2], lengthBucket);
	}
	const { writes } = await postEvent({
		event: 'search_empty',
		props: { lengthBucket: '検索した語句そのもの', hasJapanese: true },
	});
	assert.deepStrictEqual(writes, []);
});

test('記号を含むsessionId / dedupeKeyは空文字にする（イベント自体は残す）', async () => {
	const { writes } = await postEvent({
		event: 'tool_run',
		props: { tool: 'base64', source: 'button', dedupeKey: 'key with <space>' },
		sessionId: 'mail@example.com',
	});
	assert.strictEqual(writes.length, 1);
	assert.strictEqual(writes[0].blobs?.[4], '');
	assert.strictEqual(writes[0].blobs?.[7], '');
});

test('上限を超える本文は解釈せずに破棄する（境界値）', async () => {
	const build = (length: number) => {
		const base = JSON.stringify({
			event: 'tool_engage',
			props: { tool: 'base64' },
			pad: '',
		});
		return base.replace(
			'"pad":""',
			`"pad":"${'x'.repeat(length - base.length)}"`,
		);
	};
	const atLimit = build(4096);
	assert.strictEqual(atLimit.length, 4096);
	assert.strictEqual(
		(await postEvent(null, { rawBody: atLimit })).writes.length,
		1,
	);

	const over = await postEvent(null, { rawBody: build(4097) });
	assert.strictEqual(over.response.status, 204);
	assert.deepStrictEqual(over.writes, []);
});

test('JSONでない本文・オブジェクトでない本文は204で破棄する', async () => {
	for (const rawBody of ['not json', 'null', '[]', '"tool_run"', '']) {
		const { response, writes } = await postEvent(null, { rawBody });
		assert.strictEqual(response.status, 204);
		assert.deepStrictEqual(writes, [], rawBody);
	}
});
