import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequest } from '../../functions/_middleware.ts';
import { onRequestPost } from '../../functions/api/event.ts';

test('page_view preserves the Analytics Engine binding receiver, including waitUntil', async () => {
	for (const deferred of [false, true]) {
		const writes: unknown[] = [];
		const pending: Promise<unknown>[] = [];
		const binding = {
			writeDataPoint(data: unknown) {
				assert.equal(this, binding);
				writes.push(data);
			},
		};
		const response = await onRequest({
			request: new Request('https://tools.codelife.cafe/color/'),
			next: async () =>
				new Response('ok', { headers: { 'Content-Type': 'text/html' } }),
			env: { EVENTS: binding },
			...(deferred
				? {
						waitUntil: (promise: Promise<unknown>) => {
							pending.push(promise);
						},
					}
				: {}),
		});
		await Promise.all(pending);
		assert.equal(await response.text(), 'ok');
		assert.equal(writes.length, 1);
	}
});

test('synthetic monitoring does not persist page_view or custom events', async () => {
	const writes: unknown[] = [];
	const env = {
		EVENTS: {
			writeDataPoint(data: unknown) {
				writes.push(data);
			},
		},
	};
	const headers = {
		'X-CLC-Synthetic': '1',
		'Content-Type': 'application/json',
	};
	const page = await onRequest({
		request: new Request('https://tools.codelife.cafe/color/?settings=abc', {
			headers,
		}),
		next: async () =>
			new Response('ok', { headers: { 'Content-Type': 'text/html' } }),
		env,
	});
	const event = await onRequestPost({
		request: new Request('https://tools.codelife.cafe/api/event', {
			method: 'POST',
			headers,
			body: JSON.stringify({
				event: 'tool_run',
				props: { tool: 'color', source: 'button', dedupeKey: 'test' },
			}),
		}),
		env,
	});
	assert.equal(await page.text(), 'ok');
	assert.equal(page.headers.get('X-Robots-Tag'), 'noindex, follow');
	assert.equal(event.status, 204);
	assert.deepEqual(writes, []);
});

test('only the explicit synthetic value opts out; ordinary events retain their schema', async () => {
	for (const value of [undefined, '0', 'true']) {
		const writes: Array<{ blobs?: string[]; indexes?: string[] }> = [];
		const headers = new Headers({
			'Content-Type': 'application/json',
			'User-Agent': 'Mozilla/5.0',
		});
		if (value !== undefined) headers.set('X-CLC-Synthetic', value);
		const env = {
			EVENTS: {
				writeDataPoint(data: { blobs?: string[]; indexes?: string[] }) {
					writes.push(data);
				},
			},
		};
		await onRequest({
			request: new Request('https://tools.codelife.cafe/color/', { headers }),
			next: async () =>
				new Response('ok', { headers: { 'Content-Type': 'text/html' } }),
			env,
		});
		await onRequestPost({
			request: new Request('https://tools.codelife.cafe/api/event', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					event: 'tool_run',
					props: { tool: 'color', source: 'button', dedupeKey: 'run-key' },
					sessionId: 'tab-key',
				}),
			}),
			env,
		});
		assert.deepEqual(writes, [
			{
				blobs: ['page_view', '/color/', '', '', '', 'human'],
				indexes: ['page_view'],
			},
			{
				blobs: [
					'tool_run',
					'color',
					'',
					'',
					'tab-key',
					'human',
					'button',
					'run-key',
				],
				indexes: ['tool_run'],
			},
		]);
	}
});
