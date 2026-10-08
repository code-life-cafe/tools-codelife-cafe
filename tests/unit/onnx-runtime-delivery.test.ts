import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequest } from '../../functions/vendor/onnx-wasm/[[path]].ts';
import {
	ONNX_WASM_BASE_PATH,
	RUNTIME_ARTIFACT,
} from '../../src/lib/transcribe/model-manifest.ts';

test('runtime delivery serves only manifest keys with explicit MIME and immutable headers', async () => {
	for (const file of RUNTIME_ARTIFACT.files) {
		const calls: string[] = [];
		const object = () => ({
			body: new Blob(['fixture']).stream(),
			size: file.bytes,
			httpEtag: '"fixture"',
		});
		const env = {
			TRANSCRIBE_MODELS: {
				get: async (key: string) => {
					calls.push(key);
					return object();
				},
				head: async (key: string) => {
					calls.push(key);
					return object();
				},
			},
		};
		for (const method of ['GET', 'HEAD']) {
			const response = await onRequest({
				request: new Request(
					`https://tools.codelife.cafe${ONNX_WASM_BASE_PATH}${file.path}`,
					{ method },
				),
				env,
			});
			assert.equal(response.status, 200);
			assert.equal(
				response.headers.get('Content-Type'),
				file.path.endsWith('.wasm')
					? 'application/wasm'
					: 'text/javascript; charset=utf-8',
			);
			assert.equal(response.headers.get('Content-Length'), String(file.bytes));
			assert.equal(
				response.headers.get('Cache-Control'),
				'public, max-age=31536000, immutable, no-transform',
			);
			assert.equal(
				response.headers.get('Cross-Origin-Resource-Policy'),
				'same-origin',
			);
			assert.equal(
				method === 'HEAD' ? response.body : await response.text(),
				method === 'HEAD' ? null : 'fixture',
			);
		}
		assert.deepEqual(
			calls,
			Array(2).fill(
				`onnx-wasm/${RUNTIME_ARTIFACT.onnxRuntimeVersion}/${file.sha256}/${file.path}`,
			),
		);
		const cached = await onRequest({
			request: new Request(
				`https://tools.codelife.cafe${ONNX_WASM_BASE_PATH}${file.path}`,
				{ headers: { 'If-None-Match': '"fixture"' } },
			),
			env,
		});
		assert.equal(cached.status, 304);
		assert.equal(cached.body, null);
	}
});

test('runtime delivery fails closed for missing binding/object, wrong size, empty body and R2 failure', async () => {
	const file = RUNTIME_ARTIFACT.files[0];
	const request = new Request(
		`https://tools.codelife.cafe${ONNX_WASM_BASE_PATH}${file.path}`,
	);
	for (const [get, status] of [
		[async () => null, 404],
		[
			async () => ({
				body: new Blob(['x']).stream(),
				size: 1,
				httpEtag: '"x"',
			}),
			503,
		],
		[async () => ({ body: null, size: file.bytes, httpEtag: '"x"' }), 503],
		[
			async () => {
				throw new Error('R2 unavailable');
			},
			503,
		],
	] as const) {
		const response = await onRequest({
			request,
			env: { TRANSCRIBE_MODELS: { get, head: get } },
		});
		assert.equal(response.status, status);
		assert.equal(response.headers.get('Cache-Control'), 'no-store');
		assert.equal(response.headers.get('Location'), null);
	}
	assert.equal((await onRequest({ request, env: {} })).status, 503);
});

test('runtime delivery rejects unknown, old-version and encoded paths before accessing R2', async () => {
	for (const suffix of [
		'unknown.wasm',
		'%6frt-wasm-simd-threaded.mjs',
		'../old/runtime.wasm',
	]) {
		const response = await onRequest({
			request: new Request(
				`https://tools.codelife.cafe${ONNX_WASM_BASE_PATH}${suffix}`,
			),
			env: {},
		});
		assert.equal(response.status, 404);
	}
	assert.equal(
		(
			await onRequest({
				request: new Request(
					`https://tools.codelife.cafe${ONNX_WASM_BASE_PATH}${RUNTIME_ARTIFACT.files[0].path}`,
					{ method: 'POST' },
				),
				env: {},
			})
		).status,
		405,
	);
});
