// 公開runtimeを既存R2から同一オリジンで配信する。モデルとはhash付きキーで分離。
import {
	ONNX_WASM_BASE_PATH,
	RUNTIME_ARTIFACT,
} from '../../../src/lib/transcribe/model-manifest.ts';

type RuntimeObject = {
	body: ReadableStream | null;
	size: number;
	httpEtag: string;
};
type RuntimeBucket = {
	get(key: string): Promise<RuntimeObject | null>;
	head(key: string): Promise<RuntimeObject | null>;
};
type Context = {
	request: Request;
	env: { TRANSCRIBE_MODELS?: RuntimeBucket };
};

const ALLOWED = new Map(
	RUNTIME_ARTIFACT.files.map((file) => [
		`${ONNX_WASM_BASE_PATH}${file.path}`,
		file,
	]),
);

function failure(status: number): Response {
	return new Response(status === 404 ? 'Not Found' : 'Runtime unavailable', {
		status,
		headers: { 'Cache-Control': 'no-store' },
	});
}

export const onRequest = async ({ request, env }: Context): Promise<Response> => {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response('Method Not Allowed', {
			status: 405,
			headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
		});
	}
	const file = ALLOWED.get(new URL(request.url).pathname);
	if (!file) return failure(404);
	const bucket = env.TRANSCRIBE_MODELS;
	if (!bucket) return failure(503);
	// hashを含むキーで別buildを混在させない。配置時・リリース時に実体hashも検証する。
	const key = `onnx-wasm/${RUNTIME_ARTIFACT.onnxRuntimeVersion}/${file.sha256}/${file.path}`;
	let object: RuntimeObject | null;
	try {
		object = await bucket[request.method === 'HEAD' ? 'head' : 'get'](key);
	} catch {
		return failure(503);
	}
	if (!object) return failure(404);
	if (object.size !== file.bytes) return failure(503);
	if (request.method === 'GET' && !object.body) return failure(503);
	const headers = new Headers({
		'Content-Type': file.path.endsWith('.wasm')
			? 'application/wasm'
			: 'text/javascript; charset=utf-8',
		'Content-Length': String(object.size),
		'Cache-Control': 'public, max-age=31536000, immutable, no-transform',
		ETag: object.httpEtag,
		'X-Content-Type-Options': 'nosniff',
		'Cross-Origin-Resource-Policy': 'same-origin',
		'Accept-Ranges': 'none',
	});
	if (request.headers.get('If-None-Match') === object.httpEtag) {
		headers.delete('Content-Length');
		return new Response(null, { status: 304, headers });
	}
	return new Response(request.method === 'HEAD' ? null : object.body, {
		status: 200,
		headers,
	});
};
