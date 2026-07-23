// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/transcribe-cache.test.ts
//
// 「キャッシュ済み（再ダウンロード不要）」判定と、対象限定のキャッシュ削除。
// Cache Storage は差し替え可能にしてあるため、DOM なしで検証できる。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	type CacheStorageLike,
	evictModelCache,
	isModelCached,
	listModelFileUrls,
	resolveModelLoadSource,
} from '../../src/lib/transcribe/cache.ts';
import { MODEL_ARTIFACTS } from '../../src/lib/transcribe/model-manifest.ts';

/** 与えられた URL だけが入っている Cache Storage のスタブ */
function fakeCaches(urls: readonly string[]): CacheStorageLike {
	const stored = new Set(urls);
	return {
		keys: async () => ['transformers-cache'],
		open: async () => ({
			match: async (url: string) => (stored.has(url) ? {} : undefined),
			delete: async (url: string) => stored.delete(url),
		}),
		match: async (url: string) => (stored.has(url) ? {} : undefined),
	};
}

const throwingCaches: CacheStorageLike = {
	keys: async () => {
		throw new Error('Cache API unavailable');
	},
	open: async () => {
		throw new Error('Cache API unavailable');
	},
	match: async () => {
		throw new Error('Cache API unavailable');
	},
};

const wasmUrls = listModelFileUrls('tiny', 'wasm');
const webgpuUrls = listModelFileUrls('tiny', 'webgpu');

// ---------------------------------------------------------------------------
// listModelFileUrls
// ---------------------------------------------------------------------------

test('listModelFileUrls: revision 付きの配信 URL を返す', () => {
	const artifact = MODEL_ARTIFACTS.find((m) => m.id === 'tiny');
	assert.ok(artifact);
	for (const url of wasmUrls) {
		assert.ok(
			url.includes(`/${artifact.revision}/`),
			`revision が含まれていません: ${url}`,
		);
	}
});

test('listModelFileUrls: デバイスで ONNX の顔ぶれが変わる', () => {
	const onlyOnnx = (urls: string[]) => urls.filter((u) => u.endsWith('.onnx'));
	assert.notDeepEqual(onlyOnnx(wasmUrls), onlyOnnx(webgpuUrls));
});

// ---------------------------------------------------------------------------
// isModelCached
// ---------------------------------------------------------------------------

test('isModelCached: 必須ファイルが全部あれば true', async () => {
	assert.equal(await isModelCached('tiny', 'wasm', fakeCaches(wasmUrls)), true);
});

test('isModelCached: config だけでは false', async () => {
	const only = wasmUrls.filter((u) => u.endsWith('config.json'));
	assert.equal(await isModelCached('tiny', 'wasm', fakeCaches(only)), false);
});

test('isModelCached: ONNX だけでは false', async () => {
	const only = wasmUrls.filter((u) => u.endsWith('.onnx'));
	assert.equal(await isModelCached('tiny', 'wasm', fakeCaches(only)), false);
});

test('isModelCached: 必須ファイルが1件でも欠けたら false', async () => {
	for (let i = 0; i < wasmUrls.length; i++) {
		const missingOne = wasmUrls.filter((_, index) => index !== i);
		assert.equal(
			await isModelCached('tiny', 'wasm', fakeCaches(missingOne)),
			false,
			`欠落: ${wasmUrls[i]}`,
		);
	}
});

test('isModelCached: 旧 revision のキャッシュだけでは false', async () => {
	const stale = wasmUrls.map((u) =>
		u.replace(/\/[0-9a-f]{40}\//, `/${'0'.repeat(40)}/`),
	);
	assert.equal(await isModelCached('tiny', 'wasm', fakeCaches(stale)), false);
});

test('isModelCached: 別デバイス用の ONNX しか無ければ false', async () => {
	// config 類は共通なので、webgpu 用一式があっても wasm 用としては未キャッシュ
	assert.equal(
		await isModelCached('tiny', 'wasm', fakeCaches(webgpuUrls)),
		false,
	);
	assert.equal(
		await isModelCached('tiny', 'webgpu', fakeCaches(wasmUrls)),
		false,
	);
});

test('isModelCached: 別モデルのキャッシュを「キャッシュ済み」と誤判定しない', async () => {
	const baseUrls = listModelFileUrls('base', 'wasm');
	assert.equal(
		await isModelCached('tiny', 'wasm', fakeCaches(baseUrls)),
		false,
	);
});

test('isModelCached: Cache API が使えない場合は false', async () => {
	assert.equal(await isModelCached('tiny', 'wasm', null), false);
});

test('isModelCached: Cache API が例外を投げたら false', async () => {
	assert.equal(await isModelCached('tiny', 'wasm', throwingCaches), false);
});

// ---------------------------------------------------------------------------
// evictModelCache
// ---------------------------------------------------------------------------

test('evictModelCache: 対象モデル・対象デバイスの URL だけを削除する', async () => {
	const stored = new Set([...wasmUrls, '/models/other-tool/model.onnx']);
	const storage: CacheStorageLike = {
		keys: async () => ['transformers-cache'],
		open: async () => ({
			match: async (url: string) => (stored.has(url) ? {} : undefined),
			delete: async (url: string) => stored.delete(url),
		}),
		match: async (url: string) => (stored.has(url) ? {} : undefined),
	};

	const deleted = await evictModelCache('tiny', 'wasm', storage);
	assert.equal(deleted, wasmUrls.length);
	assert.equal(stored.has('/models/other-tool/model.onnx'), true);
	assert.equal(stored.size, 1);
});

test('evictModelCache: Cache API が使えない場合は 0 件', async () => {
	assert.equal(await evictModelCache('tiny', 'wasm', null), 0);
});

test('evictModelCache: 例外時もそれまでの削除件数を返して落ちない', async () => {
	assert.equal(await evictModelCache('tiny', 'wasm', throwingCaches), 0);
});

// ---------------------------------------------------------------------------
// resolveModelLoadSource
// ---------------------------------------------------------------------------

test('resolveModelLoadSource: キャッシュ済みモデルは cache', () => {
	assert.equal(resolveModelLoadSource('tiny', ['tiny', 'base']), 'cache');
});

test('resolveModelLoadSource: 未キャッシュのモデルは network', () => {
	assert.equal(resolveModelLoadSource('small', ['tiny', 'base']), 'network');
});

test('resolveModelLoadSource: forceNetworkSource が true なら常に network', () => {
	assert.equal(
		resolveModelLoadSource('tiny', ['tiny'], { forceNetworkSource: true }),
		'network',
	);
});

test('resolveModelLoadSource: forceNetworkSource 省略時は既存のキャッシュ判定と同じ結果', () => {
	assert.equal(
		resolveModelLoadSource('tiny', ['tiny'], {}),
		resolveModelLoadSource('tiny', ['tiny']),
	);
	assert.equal(
		resolveModelLoadSource('small', ['tiny'], {}),
		resolveModelLoadSource('small', ['tiny']),
	);
});
