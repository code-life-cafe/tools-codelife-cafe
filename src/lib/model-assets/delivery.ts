import type { AssetFile, ModelAsset } from './manifest.ts';

type ObjectBody = {
	body: ReadableStream | null;
	size: number;
	httpEtag: string;
};
export type AssetBucket = {
	get(key: string): Promise<ObjectBody | null>;
	head(key: string): Promise<ObjectBody | null>;
};
export function modelDelivery(models: readonly ModelAsset[]) {
	const paths = new Map<string, { file: AssetFile; key: string }>();
	for (const model of models)
		for (const file of model.files)
			paths.set(file.url, {
				file,
				key: `${model.tool}/${model.name}/${model.revision}/${file.sha256}/${file.path}`,
			});
	return async ({
		request,
		env,
	}: {
		request: Request;
		env: { TRANSCRIBE_MODELS?: AssetBucket };
	}): Promise<Response> => {
		const failure = (status: number) =>
			new Response('Model unavailable', {
				status,
				headers: { 'Cache-Control': 'no-store' },
			});
		if (request.method !== 'GET' && request.method !== 'HEAD')
			return new Response('Method Not Allowed', {
				status: 405,
				headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
			});
		const url = new URL(request.url);
		const entry = paths.get(url.pathname);
		if (!entry || url.search) return failure(404);
		if (!env.TRANSCRIBE_MODELS) return failure(503);
		let object: ObjectBody | null;
		try {
			object = await env.TRANSCRIBE_MODELS[
				request.method === 'HEAD' ? 'head' : 'get'
			](entry.key);
		} catch {
			return failure(503);
		}
		if (!object) return failure(404);
		if (
			object.size !== entry.file.bytes ||
			(request.method === 'GET' && !object.body)
		)
			return failure(503);
		return new Response(request.method === 'HEAD' ? null : object.body, {
			headers: {
				'Content-Type': entry.file.path.endsWith('.json')
					? 'application/json; charset=utf-8'
					: 'application/octet-stream',
				'Content-Length': String(object.size),
				ETag: object.httpEtag,
				'Cache-Control': 'public, max-age=31536000, immutable, no-transform',
				'X-Content-Type-Options': 'nosniff',
				'Cross-Origin-Resource-Policy': 'same-origin',
				'Accept-Ranges': 'none',
			},
		});
	};
}
