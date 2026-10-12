import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequest } from '../../functions/_middleware.ts';
import { isAnalyticsDisabledPath } from '../../src/lib/analytics-policy.ts';

test('解析停止ページは正規・旧・エンコードされたパスでserver page_viewを記録しない', async () => {
	for (const slug of ['transcribe', 'video-compress']) {
		for (const pathname of [
			`/${slug}`,
			`/${slug}/`,
			`/tools/${slug}`,
			`/tools/${slug}/`,
			`/%${slug.charCodeAt(0).toString(16)}${slug.slice(1)}/`,
			`/tools%2F${slug}/`,
		]) {
			assert.equal(isAnalyticsDisabledPath(pathname), true);
			for (const method of ['GET', 'HEAD']) {
				let writes = 0;
				const pending: Promise<unknown>[] = [];
				const response = await onRequest({
					request: new Request(
						`https://tools.codelife.cafe${pathname}?settings=abc`,
						{ method, headers: { 'user-agent': 'ClaudeBot' } },
					),
					next: async () =>
						new Response('<html>sample</html>', {
							headers: { 'content-type': 'text/html' },
						}),
					env: {
						EVENTS: {
							writeDataPoint() {
								writes++;
							},
						},
					},
					waitUntil(promise) {
						pending.push(promise);
					},
				});
				await Promise.all(pending);
				assert.equal(writes, 0, pathname);
				assert.equal(response.status, 200);
				assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, follow');
				assert.equal(await response.text(), '<html>sample</html>');
			}
		}
	}
});

test('他ページの既存page_view形式を維持し境界の別slugは除外しない', async () => {
	for (const path of [
		'/transcriber',
		'/video-compress-other',
		'/tools/color',
		'/color',
		'/%invalid',
	])
		assert.equal(isAnalyticsDisabledPath(path), false);
	const writes: unknown[] = [];
	await onRequest({
		request: new Request('https://tools.codelife.cafe/color?settings=abc', {
			headers: { 'user-agent': 'ClaudeBot' },
		}),
		next: async () =>
			new Response('<html>sample</html>', {
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
	assert.deepEqual(writes, [
		{
			blobs: ['page_view', '/color', '', '', '', 'ai_agent'],
			indexes: ['page_view'],
		},
	]);
});
