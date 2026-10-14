import type { AssetFile } from './manifest.ts';
export type AssetCache = {
	match(key: string): Promise<Response | undefined>;
	put(key: string, response: Response): Promise<void>;
	delete(key: string): Promise<boolean>;
};
type Options = {
	origin: string;
	fetcher?: typeof fetch;
	cache?: AssetCache | null;
	onProgress?: (loaded: number, total: number) => void;
};
export async function verifyAsset(
	bytes: ArrayBuffer,
	asset: Pick<AssetFile, 'bytes' | 'sha256'>,
): Promise<void> {
	if (bytes.byteLength !== asset.bytes)
		throw new Error('モデル資産のサイズが一致しません。');
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	const hash = Array.from(digest, (value) =>
		value.toString(16).padStart(2, '0'),
	).join('');
	if (hash !== asset.sha256)
		throw new Error('モデル資産のハッシュが一致しません。');
}
async function readAsset(
	response: Response,
	asset: AssetFile,
	progress?: Options['onProgress'],
): Promise<ArrayBuffer> {
	if (response.status !== 200 || response.redirected)
		throw new Error('モデル資産を取得できません。');
	const declared = response.headers.get('content-length');
	if (declared !== null && Number(declared) !== asset.bytes) {
		await response.body?.cancel();
		throw new Error('モデル資産のサイズが一致しません。');
	}
	if (!response.body) throw new Error('モデル資産が空です。');
	const output = new Uint8Array(asset.bytes);
	const reader = response.body.getReader();
	let offset = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (offset + value.length > output.length)
				throw new Error('モデル資産のサイズが一致しません。');
			output.set(value, offset);
			offset += value.length;
			progress?.(offset, asset.bytes);
		}
	} catch (error) {
		await reader.cancel().catch(() => {});
		throw error;
	} finally {
		reader.releaseLock();
	}
	if (offset !== output.length)
		throw new Error('モデル資産のサイズが一致しません。');
	await verifyAsset(output.buffer, asset);
	return output.buffer;
}
function verifiedResponse(bytes: ArrayBuffer, asset: AssetFile): Response {
	return new Response(bytes, {
		headers: {
			'Content-Length': String(asset.bytes),
			'Content-Type': asset.path.endsWith('.json')
				? 'application/json'
				: 'application/octet-stream',
		},
	});
}
// 期待hashを専用キャッシュキーへ含め、SW/HTTPキャッシュは再利用しない。
export function assetCacheKey(asset: AssetFile, origin: string): string {
	const key = new URL(asset.url, origin);
	key.searchParams.set('verified-sha256', asset.sha256);
	return key.href;
}
export async function fetchVerifiedAsset(
	asset: AssetFile,
	options: Options,
): Promise<Response> {
	const url = new URL(asset.url, options.origin);
	if (url.origin !== new URL(options.origin).origin || url.search || url.hash)
		throw new Error('未登録のモデル資産です。');
	const cacheKey = assetCacheKey(asset, options.origin);
	if (options.cache) {
		const cached = await options.cache.match(cacheKey).catch(() => undefined);
		if (cached) {
			try {
				return verifiedResponse(
					await readAsset(cached, asset, options.onProgress),
					asset,
				);
			} catch {
				await options.cache.delete(cacheKey).catch(() => false);
			}
		}
	}
	let response: Response;
	try {
		response = await (options.fetcher ?? fetch)(url.href, {
			method: 'GET',
			mode: 'same-origin',
			credentials: 'omit',
			redirect: 'error',
			cache: 'no-store',
		});
	} catch {
		throw new Error('モデル資産を取得できません。');
	}
	const result = verifiedResponse(
		await readAsset(response, asset, options.onProgress),
		asset,
	);
	await options.cache?.put(cacheKey, result.clone()).catch(() => {});
	return result;
}
// ライブラリ専用取得API。未知URL/別originを通信前に拒否。
export function createVerifiedModelFetch(
	assets: readonly AssetFile[],
	options: Options,
): typeof fetch {
	const allowed = new Map(
		assets.map((asset) => [new URL(asset.url, options.origin).href, asset]),
	);
	return async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		const absolute = new URL(url, options.origin);
		const method =
			init?.method ?? (input instanceof Request ? input.method : 'GET');
		const asset = allowed.get(absolute.href);
		if (!asset || method !== 'GET') throw new Error('未登録のモデル資産です。');
		return fetchVerifiedAsset(asset, options);
	};
}
