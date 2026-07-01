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
			blobs: ['settings_restore', 'json-formatter', 'url', ''],
			indexes: ['settings_restore'],
		},
	]);
});
