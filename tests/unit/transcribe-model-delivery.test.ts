import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequest } from '../../functions/models/transcribe/[[path]].ts';
import { MODEL_ARTIFACTS } from '../../src/lib/transcribe/model-manifest.ts';

const ORIGIN = 'https://tools.codelife.cafe';
const tiny = MODEL_ARTIFACTS[0];
const configKey = `transcribe/${tiny.name}/${tiny.revision}/config.json`;
const configPath = `/models/${configKey}`;

function mockStorage(expectedKey: string, content: string | null = 'モデル') {
	const calls: [string, string][] = [];
	const read = async (method: string, key: string) => {
		calls.push([method, key]);
		if (key !== expectedKey || content === null) return null;
		const blob = new Blob([content]);
		return {
			body: method === 'GET' ? blob.stream() : null,
			size: blob.size,
			httpEtag: '"model-fixture"',
			writeHttpMetadata(headers: Headers) {
				headers.set('Content-Type', 'application/x-fixture');
				headers.set('Content-Language', 'ja');
			},
		};
	};
	return {
		calls,
		env: {
			TRANSCRIBE_MODELS: {
				get: (key: string) => read('GET', key),
				head: (key: string) => read('HEAD', key),
			},
		},
	};
}

for (const model of MODEL_ARTIFACTS) {
	for (const method of ['GET', 'HEAD']) {
		test(`${model.id} の正規 ${method} は R2 の正しいキーから 200 と配信ヘッダーを返す`, async () => {
			assert.ok(model.files.length > 0);
			for (const file of model.files) {
				const key = `transcribe/${model.name}/${model.revision}/${file.path}`;
				const content = JSON.stringify({ model: model.id, file: file.path });
				const { env, calls } = mockStorage(key, content);
				const response = await onRequest({
					request: new Request(`${ORIGIN}/models/${key}`, { method }),
					env,
				});
				assert.equal(response.status, 200, file.path);
				assert.deepEqual(calls, [[method, key]]);
				assert.equal(
					response.headers.get('Content-Type'),
					file.path.endsWith('.json')
						? 'application/json; charset=utf-8'
						: file.path.endsWith('.txt')
							? 'text/plain; charset=utf-8'
							: 'application/octet-stream',
				);
				assert.equal(response.headers.get('Content-Language'), 'ja');
				assert.equal(response.headers.get('ETag'), '"model-fixture"');
				assert.equal(
					response.headers.get('Cache-Control'),
					'public, max-age=31536000, immutable',
				);
				assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
				assert.equal(response.headers.get('Accept-Ranges'), 'none');
				if (method === 'HEAD') {
					assert.equal(response.body, null);
					assert.equal(await response.text(), '');
					assert.equal(
						response.headers.get('Content-Length'),
						String(new Blob([content]).size),
					);
				} else {
					assert.equal(await response.text(), content);
				}
			}
		});
	}
}

for (const method of ['GET', 'HEAD']) {
	for (const suffix of ['%ZZ', '%E0%A4%A']) {
		test(`不正なエンコード ${suffix} の ${method} は例外ではなく no-store の 404 を返す`, async () => {
			const { env, calls } = mockStorage(configKey);
			const response = await onRequest({
				request: new Request(`${ORIGIN}/models/transcribe/${suffix}`, {
					method,
				}),
				env,
			});
			assert.equal(response.status, 404);
			assert.equal(response.headers.get('Cache-Control'), 'no-store');
			assert.equal(response.headers.get('Location'), null);
			assert.deepEqual(calls, []);
		});
	}

	test(`未知・旧・異常パスの ${method} は R2 にアクセスせず 404 を返す`, async () => {
		for (const suffix of [
			'unknown/config.json',
			`${tiny.name}/config.json`,
			`${tiny.name}/${tiny.revision}/unknown.json`,
			`${tiny.name}/${tiny.revision}/config.json%00`,
			`${tiny.name}/${tiny.revision}/..%2fconfig.json`,
			`${tiny.name}/${tiny.revision}/config.json%2fextra`,
		]) {
			const { env, calls } = mockStorage(configKey);
			const response = await onRequest({
				request: new Request(`${ORIGIN}/models/transcribe/${suffix}`, {
					method,
				}),
				env,
			});
			assert.equal(response.status, 404, suffix);
			assert.equal(response.headers.get('Cache-Control'), 'no-store');
			assert.equal(response.headers.get('Location'), null);
			assert.deepEqual(calls, []);
		}
	});

	test(`バケット未設定の正規 ${method} は no-store の 503 を返す`, async () => {
		const response = await onRequest({
			request: new Request(`${ORIGIN}${configPath}`, { method }),
			env: {},
		});
		assert.equal(response.status, 503);
		assert.equal(response.headers.get('Cache-Control'), 'no-store');
		assert.equal(response.headers.get('Location'), null);
	});

	test(`オブジェクトが存在しない正規 ${method} は no-store の 404 を返す`, async () => {
		const { env, calls } = mockStorage(configKey, null);
		const response = await onRequest({
			request: new Request(`${ORIGIN}${configPath}`, { method }),
			env,
		});
		assert.equal(response.status, 404);
		assert.equal(response.headers.get('Cache-Control'), 'no-store');
		assert.equal(response.headers.get('Location'), null);
		assert.deepEqual(calls, [[method, configKey]]);
	});
}

test('正しいエンコードとクエリ付きの正規 URL はデコードした R2 キーで取得する', async () => {
	const { env, calls } = mockStorage(configKey);
	const response = await onRequest({
		request: new Request(
			`${ORIGIN}${configPath.replace('config.json', '%63onfig.json')}?v=1`,
		),
		env,
	});
	assert.equal(response.status, 200);
	assert.equal(await response.text(), 'モデル');
	assert.deepEqual(calls, [['GET', configKey]]);
});

test('GET と HEAD 以外は R2 にアクセスせず 405 を返す', async () => {
	const { env, calls } = mockStorage(configKey);
	const response = await onRequest({
		request: new Request(`${ORIGIN}${configPath}`, { method: 'POST' }),
		env,
	});
	assert.equal(response.status, 405);
	assert.equal(response.headers.get('Allow'), 'GET, HEAD');
	assert.deepEqual(calls, []);
});
