import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequest } from '../../functions/_middleware.ts';

type Point = { blobs?: string[]; indexes?: string[] };

async function observe({
	method = 'GET',
	status = 200,
	path = '/color/',
	contentType = 'text/html; charset=utf-8',
	synthetic = false,
	deferred = false,
} = {}) {
	const writes: Point[] = [];
	const pending: Promise<unknown>[] = [];
	const headers = new Headers({ 'User-Agent': 'Mozilla/5.0', Accept: '*/*' });
	if (synthetic) headers.set('X-CLC-Synthetic', '1');
	const original = new Response(null, {
		status,
		headers: { 'Content-Type': contentType },
	});
	const binding = {
		writeDataPoint(point: Point) {
			assert.equal(this, binding);
			writes.push(point);
		},
	};
	const response = await onRequest({
		request: new Request(`https://tools.codelife.cafe${path}`, {
			method,
			headers,
		}),
		next: async () => original,
		env: { EVENTS: binding },
		...(deferred
			? {
					waitUntil(promise: Promise<unknown>) {
						pending.push(promise);
					},
				}
			: {}),
	});
	await Promise.all(pending);
	return { response, original, writes };
}

test('successful complete HTML GET records exactly one existing-schema page_view', async () => {
	for (const deferred of [false, true]) {
		const { response, original, writes } = await observe({ deferred });
		assert.equal(response, original);
		assert.deepEqual(writes, [
			{
				blobs: ['page_view', '/color/', '', '', '', 'human'],
				indexes: ['page_view'],
			},
		]);
	}
});

for (const method of ['HEAD', 'POST', 'PUT', 'OPTIONS', 'DELETE']) {
	test(`${method} HTML response is delivered without page_view`, async () => {
		const { response, original, writes } = await observe({ method });
		assert.equal(response, original);
		assert.deepEqual(writes, []);
	});
}

for (const status of [
	201, 202, 204, 205, 206, 300, 301, 302, 303, 304, 307, 308, 400, 403, 404,
	405, 429, 500, 502, 503,
]) {
	test(`HTML status ${status} does not count as a successful complete page GET`, async () => {
		const { response, original, writes } = await observe({
			status,
			deferred: true,
		});
		assert.equal(response, original);
		assert.equal(response.status, status);
		assert.deepEqual(writes, []);
	});
}

for (const contentType of [
	'application/json',
	'text/plain',
	'application/javascript',
	'application/xhtml+xml',
	'application/x-text/html',
	'text/html-other',
	'application/json; note=text/html',
	'',
]) {
	test(`GET 200 with non-HTML Content-Type ${JSON.stringify(contentType)} is not recorded`, async () => {
		const { response, original, writes } = await observe({ contentType });
		assert.equal(response, original);
		assert.deepEqual(writes, []);
	});
}

for (const contentType of [
	'TEXT/HTML; Charset=UTF-8',
	'text/html ; charset=utf-8',
]) {
	test(`valid HTML media type ${contentType} is counted`, async () => {
		const { writes } = await observe({ contentType });
		assert.equal(writes.length, 1);
	});
}

test('settings noindex and delivery status survive excluded HEAD and error responses', async () => {
	for (const options of [
		{ method: 'HEAD', status: 200 },
		{ method: 'GET', status: 404 },
		{ method: 'GET', status: 503 },
	]) {
		const { response, writes } = await observe({
			...options,
			path: '/color/?settings=synthetic',
		});
		assert.equal(response.status, options.status);
		assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, follow');
		assert.deepEqual(writes, []);
	}
});

for (const path of [
	'/api/event',
	'/models/example',
	'/transcribe/',
	'/video-compress/',
	'/tools/transcribe/',
	'/tools/video-compress/',
]) {
	test(`successful HTML GET remains excluded at ${path}`, async () => {
		const { writes } = await observe({ path });
		assert.deepEqual(writes, []);
	});
}

test('synthetic GET 200 still delivers HTML without persisting page_view', async () => {
	const { response, original, writes } = await observe({
		synthetic: true,
		deferred: true,
	});
	assert.equal(response, original);
	assert.deepEqual(writes, []);
});

test('GET 200 HTML SPA fallback cannot be distinguished from a real page by this filter', async () => {
	const { writes } = await observe({ path: '/synthetic-missing-route/' });
	assert.equal(writes.length, 1);
	assert.equal(writes[0].blobs?.[1], '/synthetic-missing-route/');
});
