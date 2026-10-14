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
// BufferSourceをResponseへ渡すと全コピーされるため、共有viewのstreamを使う。
// arrayBuffer()は検証済みの同じbufferを渡す。bodyUsed/一度だけの消費を維持。
function verifiedResponse(bytes: ArrayBuffer, asset: AssetFile): Response {
	let retained: ArrayBuffer | null = bytes;
	const response = new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(bytes));
				controller.close();
			},
		}),
		{
			headers: {
				'Content-Length': String(asset.bytes),
				'Content-Type': asset.path.endsWith('.json')
					? 'application/json'
					: 'application/octet-stream',
			},
		},
	);
	response.arrayBuffer = async () => {
		if (response.bodyUsed || response.body?.locked || !retained)
			throw new TypeError('Body has already been consumed');
		const result = retained;
		retained = null;
		await response.body?.cancel();
		return result;
	};
	return response;
}
export function assetCacheKey(asset: AssetFile, origin: string): string {
	const key = new URL(asset.url, origin);
	key.searchParams.set('verified-sha256', asset.sha256);
	return key.href;
}
// 直接ORTへ渡す経路はResponseを経由しない。cache書込み完了も推論の条件にしない。
export async function fetchVerifiedBytes(
	asset: AssetFile,
	options: Options,
): Promise<ArrayBuffer> {
	const url = new URL(asset.url, options.origin);
	if (url.origin !== new URL(options.origin).origin || url.search || url.hash)
		throw new Error('未登録のモデル資産です。');
	const cacheKey = assetCacheKey(asset, options.origin);
	if (options.cache) {
		const cached = await options.cache.match(cacheKey).catch(() => undefined);
		if (cached) {
			try {
				return await readAsset(cached, asset, options.onProgress);
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
	const bytes = await readAsset(response, asset, options.onProgress);
	if (options.cache) {
		// 1本のstreamをcacheへ渡し、result.cloneによるteeと全BufferSourceコピーを作らない。
		void options.cache
			.put(cacheKey, verifiedResponse(bytes, asset))
			.catch(() => {});
	}
	return bytes;
}
export async function fetchVerifiedAsset(
	asset: AssetFile,
	options: Options,
): Promise<Response> {
	return verifiedResponse(await fetchVerifiedBytes(asset, options), asset);
}
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
