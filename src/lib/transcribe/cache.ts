// cache.ts — モデルのブラウザキャッシュ（Cache Storage）の確認と、対象限定の削除
//
// キャッシュの正は transformers.js 標準の Cache Storage（env.useBrowserCache）。
// R2 の Cache-Control は補助的な位置づけ（正本 FR-7 / R-5）。
//
// 「transcribe 用キャッシュ全体を消す」ではなく、マニフェストに列挙された URL だけを
// 削除することで、他ツール（/bg-remove 等）のキャッシュに影響を与えない。
//
// URL には revision が含まれる（`<name>/<revision>/...`）ため、旧 revision の
// キャッシュが残っていても「キャッシュ済み」とは判定されない。

import {
	getModelArtifact,
	MODEL_BASE_PATH,
	type ModelId,
} from './model-manifest.ts';
import { requiredFiles } from './models.ts';
import type { TranscribeDevice } from './protocol.ts';

/** Cache Storage の必要な部分だけを型にしたもの（テストで差し替えられるようにする） */
export type CacheLike = {
	match(request: string): Promise<unknown>;
	delete(request: string): Promise<boolean>;
};

export type CacheStorageLike = {
	keys(): Promise<string[]>;
	open(cacheName: string): Promise<CacheLike>;
	match(request: string): Promise<unknown>;
};

function defaultCacheStorage(): CacheStorageLike | null {
	return typeof caches === 'undefined'
		? null
		: (caches as unknown as CacheStorageLike);
}

function origin(): string {
	return typeof location !== 'undefined' ? location.origin : '';
}

/**
 * 指定デバイスで実際にロードされる全ファイルの配信 URL。
 * config / generation_config / preprocessor_config / tokenizer / tokenizer_config と、
 * そのデバイスの dtype に対応する ONNX が含まれる。
 */
export function listModelFileUrls(
	id: ModelId,
	device: TranscribeDevice,
): string[] {
	const artifact = getModelArtifact(id);
	const base = `${origin()}${MODEL_BASE_PATH}${artifact.repositoryPath}`;
	return requiredFiles(artifact, device).map((file) => `${base}${file.path}`);
}

/**
 * 「キャッシュ済み（再ダウンロード不要）」を判定する。
 *
 * 必須ファイルが**すべて**存在するときだけ true。1件でも欠けていれば false を返す。
 * 一部だけの確認では、破損キャッシュや途中で中断したダウンロードを
 * 「キャッシュ済み」と誤表示してしまうため。
 *
 * Cache API が使えない場合・走査中に例外が出た場合はいずれも安全側の false。
 */
export async function isModelCached(
	id: ModelId,
	device: TranscribeDevice,
	cacheStorage: CacheStorageLike | null = defaultCacheStorage(),
): Promise<boolean> {
	if (!cacheStorage) return false;
	try {
		for (const url of listModelFileUrls(id, device)) {
			if ((await cacheStorage.match(url)) === undefined) return false;
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * `loading-model` 開始時の取得元（`source`）を決定する。
 *
 * `forceNetworkSource` が true の場合は `cachedModelIds` を一切見ない。
 * `evictModelCache` 直後の `setCachedModelIds` は非同期更新のため、
 * 直後にこの関数を呼ぶとまだ削除前の古い `cachedModelIds` を参照してしまう
 * レースがある。キャッシュ削除→再取得の経路ではこのフラグで明示的に迂回する。
 */
export function resolveModelLoadSource(
	modelId: ModelId,
	cachedModelIds: readonly ModelId[],
	options?: { forceNetworkSource?: boolean },
): 'network' | 'cache' {
	if (options?.forceNetworkSource) return 'network';
	return cachedModelIds.includes(modelId) ? 'cache' : 'network';
}

/**
 * 対象モデル・対象デバイスのキャッシュエントリだけを削除する。削除できた件数を返す。
 * 破損キャッシュからの復旧に使う（再取得は1回限り。無限再試行は禁止）。
 */
export async function evictModelCache(
	id: ModelId,
	device: TranscribeDevice,
	cacheStorage: CacheStorageLike | null = defaultCacheStorage(),
): Promise<number> {
	if (!cacheStorage) return 0;
	const urls = listModelFileUrls(id, device);
	let deleted = 0;
	try {
		for (const name of await cacheStorage.keys()) {
			const cache = await cacheStorage.open(name);
			for (const url of urls) {
				if (await cache.delete(url)) deleted++;
			}
		}
	} catch {
		return deleted;
	}
	return deleted;
}
