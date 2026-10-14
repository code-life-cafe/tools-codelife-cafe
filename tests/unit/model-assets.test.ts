import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { onRequest as bgDelivery } from '../../functions/models/bg-remove/[[path]].ts';
import { onRequest as upDelivery } from '../../functions/models/upscale/[[path]].ts';
import { modelDelivery } from '../../src/lib/model-assets/delivery.ts';
import {
	type AssetFile,
	MODEL_ASSETS,
} from '../../src/lib/model-assets/manifest.ts';
import {
	type AssetCache,
	assetCacheKey,
	createVerifiedModelFetch,
	fetchVerifiedAsset,
	fetchVerifiedBytes,
	verifyAsset,
} from '../../src/lib/model-assets/verified-fetch.ts';

const origin = 'https://tools.codelife.cafe';
const good = new TextEncoder().encode('{"model":"test"}');
const asset: AssetFile = {
	path: 'config.json',
	url: '/models/bg-remove/test/revision/config.json',
	bytes: good.length,
	sha256: createHash('sha256').update(good).digest('hex'),
};
const copy = () => good.slice().buffer;
function cacheFixture(): {
	cache: AssetCache;
	values: Map<string, Response>;
	deleted: string[];
} {
	const values = new Map<string, Response>();
	const deleted: string[] = [];
	return {
		values,
		deleted,
		cache: {
			match: async (key) => values.get(key)?.clone(),
			put: async (key, response) => {
				values.set(key, response);
			},
			delete: async (key) => {
				deleted.push(key);
				return values.delete(key);
			},
		},
	};
}
test('正常な設定とONNXを通し、同サイズの1byte改変・短縮・追加を拒否する', async () => {
	await verifyAsset(copy(), asset);
	const changed = good.slice();
	changed[0] ^= 1;
	await assert.rejects(verifyAsset(changed.buffer, asset), /ハッシュ/);
	await assert.rejects(verifyAsset(good.slice(1).buffer, asset), /サイズ/);
	await assert.rejects(
		verifyAsset(new Uint8Array(good.length + 1).buffer, asset),
		/サイズ/,
	);
});
test('取得とキャッシュ再利用の両方で検証し、追加通信なしで正常cacheを返す', async () => {
	const { cache } = cacheFixture();
	let requests = 0;
	const fetcher: typeof fetch = async (_input, init) => {
		requests++;
		assert.equal(init?.redirect, 'error');
		assert.equal(init?.credentials, 'omit');
		assert.equal(init?.cache, 'no-store');
		return new Response(copy());
	};
	const options = { origin, cache, fetcher };
	assert.equal(
		await (await fetchVerifiedAsset(asset, options)).text(),
		new TextDecoder().decode(good),
	);
	assert.equal(
		await (await fetchVerifiedAsset(asset, options)).text(),
		new TextDecoder().decode(good),
	);
	assert.equal(requests, 1);
});
test('破損cacheの対象キーだけを削除し、1回だけ再取得する', async () => {
	const { cache, values, deleted } = cacheFixture();
	const key = assetCacheKey(asset, origin);
	const changed = good.slice();
	changed[0] ^= 1;
	values.set(key, new Response(changed));
	values.set(`${origin}/unrelated`, new Response('keep'));
	let requests = 0;
	await fetchVerifiedAsset(asset, {
		origin,
		cache,
		fetcher: async () => {
			requests++;
			return new Response(copy());
		},
	});
	assert.equal(requests, 1);
	assert.deepEqual(deleted, [key]);
	assert.equal(await values.get(`${origin}/unrelated`)?.text(), 'keep');
});
test('破損cacheと再取得が両方不一致なら停止し、無限再試行しない', async () => {
	const { cache, values } = cacheFixture();
	values.set(assetCacheKey(asset, origin), new Response('bad'));
	let requests = 0;
	await assert.rejects(
		fetchVerifiedAsset(asset, {
			origin,
			cache,
			fetcher: async () => {
				requests++;
				return new Response('bad');
			},
		}),
		/サイズ/,
	);
	assert.equal(requests, 1);
	assert.equal(values.size, 0);
});
test('初回の同サイズハッシュ不一致を返さずcacheへ保存しない', async () => {
	const { cache, values } = cacheFixture();
	const changed = good.slice();
	changed[2] ^= 1;
	await assert.rejects(
		fetchVerifiedAsset(asset, {
			origin,
			cache,
			fetcher: async () => new Response(changed),
		}),
		/ハッシュ/,
	);
	assert.equal(values.size, 0);
});
test('未知資産・外部origin・main・query・POSTを通信前に拒否', async () => {
	let requests = 0;
	const guarded = createVerifiedModelFetch([asset], {
		origin,
		fetcher: async () => {
			requests++;
			return new Response(copy());
		},
	});
	for (const url of [
		'https://huggingface.co/model',
		'/models/bg-remove/test/main/config.json',
		`${asset.url}?x=1`,
		'/unknown',
		`${asset.url}#x`,
	])
		await assert.rejects(guarded(url), /未登録/);
	await assert.rejects(guarded(asset.url, { method: 'POST' }), /未登録/);
	assert.equal(requests, 0);
});
test('404・206・長さの嘘・過剰ストリーム・中断を拒否しcacheへ保存しない', async () => {
	const { cache, values } = cacheFixture();
	for (const response of [
		new Response('Not Found', { status: 404 }),
		new Response(copy(), { status: 206 }),
		new Response(copy(), { headers: { 'content-length': '1' } }),
		new Response(new Uint8Array(good.length + 1)),
		new Response(
			new ReadableStream({
				start(controller) {
					controller.error(new Error('interrupted'));
				},
			}),
		),
	])
		await assert.rejects(
			fetchVerifiedAsset(asset, {
				origin,
				cache,
				fetcher: async () => response,
			}),
		);
	assert.equal(values.size, 0);
});
test('cache使用不能でも検証は必須で、正常資産のみ返す', async () => {
	const broken: AssetCache = {
		match: async () => {
			throw Error();
		},
		put: async () => {
			throw Error();
		},
		delete: async () => false,
	};
	await fetchVerifiedAsset(asset, {
		origin,
		cache: broken,
		fetcher: async () => new Response(copy()),
	});
	await assert.rejects(
		fetchVerifiedAsset(asset, {
			origin,
			cache: broken,
			fetcher: async () => new Response('bad'),
		}),
		/サイズ/,
	);
});
test('固定モデル一覧は完全SHA・サイズ・ハッシュ付きで必要な既存モデルだけ', () => {
	assert.deepEqual(
		MODEL_ASSETS.map((model) => model.name),
		['modnet', 'ben2', 'realesrgan-x4plus', 'realesr-general-x4v3'],
	);
	for (const model of MODEL_ASSETS) {
		assert.match(model.revision, /^[a-f0-9]{40}$/);
		for (const file of model.files) {
			assert.match(file.sha256, /^[a-f0-9]{64}$/);
			assert(file.bytes > 0);
			assert(file.url.startsWith('/models/'));
		}
	}
});
test('登録済モデル配信のGET/HEADはhash付きキーを使い、未知URLはbucketへ届かない', async () => {
	const model = MODEL_ASSETS[0];
	const file = model.files[0];
	const keys: string[] = [];
	const handler = modelDelivery([model]);
	const bucket = {
		get: async (key: string) => {
			keys.push(key);
			return {
				body: new Response(new Uint8Array(file.bytes)).body,
				size: file.bytes,
				httpEtag: '"test"',
			};
		},
		head: async (key: string) => {
			keys.push(key);
			return { body: null, size: file.bytes, httpEtag: '"test"' };
		},
	};
	for (const method of ['GET', 'HEAD']) {
		const result = await handler({
			request: new Request(origin + file.url, { method }),
			env: { TRANSCRIBE_MODELS: bucket },
		});
		assert.equal(result.status, 200);
		assert.equal(result.headers.get('content-length'), String(file.bytes));
		assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff');
		if (method === 'HEAD') assert.equal(await result.text(), '');
	}
	assert.deepEqual(
		keys,
		Array(2).fill(
			`${model.tool}/${model.name}/${model.revision}/${file.sha256}/${file.path}`,
		),
	);
	for (const path of [
		'/models/bg-remove/unknown',
		`${file.url}?x=1`,
		file.url.replace(model.revision, 'main'),
		'/models/bg-remove/%2e%2e/secret',
	])
		assert.equal(
			(
				await handler({
					request: new Request(origin + path),
					env: { TRANSCRIBE_MODELS: bucket },
				})
			).status,
			404,
		);
	assert.equal(keys.length, 2);
});
test('配信はPOST拒否・欠落404・未設定/例外/サイズ不一致503', async () => {
	const file = MODEL_ASSETS[0].files[0];
	const request = new Request(origin + file.url);
	assert.equal(
		(
			await bgDelivery({
				request: new Request(request, { method: 'POST' }),
				env: {},
			})
		).status,
		405,
	);
	assert.equal((await bgDelivery({ request, env: {} })).status, 503);
	for (const [value, status] of [
		[null, 404],
		[{ body: null, size: 1, httpEtag: 'x' }, 503],
	] as const) {
		const bucket = { get: async () => value, head: async () => value };
		assert.equal(
			(await bgDelivery({ request, env: { TRANSCRIBE_MODELS: bucket } }))
				.status,
			status,
		);
	}
	const bucket = {
		get: async () => {
			throw Error();
		},
		head: async () => {
			throw Error();
		},
	};
	assert.equal(
		(await bgDelivery({ request, env: { TRANSCRIBE_MODELS: bucket } })).status,
		503,
	);
	assert.equal((await upDelivery({ request, env: {} })).status, 404);
});

test('検証したArrayBufferを直接消費し、Response変換経路でも同じbufferを返す', async () => {
	const original = crypto.subtle.digest;
	let validated: ArrayBuffer | undefined;
	crypto.subtle.digest = async (algorithm, data) => {
		validated = data as ArrayBuffer;
		return original.call(crypto.subtle, algorithm, data);
	};
	try {
		const options = { origin, fetcher: async () => new Response(copy()) };
		const direct = await fetchVerifiedBytes(asset, options);
		assert.strictEqual(direct, validated);
		const response = await fetchVerifiedAsset(asset, options);
		const buffer = validated;
		assert.strictEqual(await response.arrayBuffer(), buffer);
		assert(response.bodyUsed);
		await assert.rejects(response.arrayBuffer(), TypeError);
	} finally {
		crypto.subtle.digest = original;
	}
});
test('cache書込みが未完了でも検証済みbytesを推論へ返す', async () => {
	let finish: (() => void) | undefined;
	const cache: AssetCache = {
		match: async () => undefined,
		put: async (_key, response) => {
			assert.equal(await response.text(), new TextDecoder().decode(good));
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
		},
		delete: async () => false,
	};
	const pending = fetchVerifiedBytes(asset, {
		origin,
		cache,
		fetcher: async () => new Response(copy()),
	});
	const result = await Promise.race([
		pending,
		new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
	]);
	finish?.();
	assert(result, 'cache IO must not block inference');
	assert.equal(result.byteLength, asset.bytes);
});
