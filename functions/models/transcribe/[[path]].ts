// /models/transcribe/** — Whisper ONNX モデルの同一オリジン配信（Cloudflare R2 プロキシ）
//
// なぜ同一オリジンなのか:
//   /transcribe は CSP の connect-src を 'self' に限定している（音声・テキストの流出経路を塞ぐため）。
//   既存ツール（/bg-remove）のようにクロスオリジンの models.tools.codelife.cafe を直接叩く方式は
//   この不変条件と両立しないため、Pages Function 経由で R2 を同一オリジンに見せる。
//
// マニフェスト（src/lib/transcribe/model-manifest.ts）に列挙されたパスだけを配信する。
// 未知のパス・暗黙のパス解決は 404 とし、Hugging Face 等へのフォールバックは行わない。

import {
	listAllowedModelPaths,
	MODEL_BASE_PATH,
} from '../../../src/lib/transcribe/model-manifest.ts';

type R2Object = {
	body: ReadableStream | null;
	size: number;
	httpEtag: string;
	writeHttpMetadata: (headers: Headers) => void;
};

type R2Bucket = {
	get(
		key: string,
		options?: { range?: unknown; onlyIf?: unknown },
	): Promise<R2Object | null>;
	head(key: string): Promise<R2Object | null>;
};

interface Env {
	/** wrangler.jsonc の r2_buckets バインディング */
	TRANSCRIBE_MODELS?: R2Bucket;
}

type Context = {
	request: Request;
	env: Env;
};

/** R2 バケット内のキープレフィックス（既存の /bg-remove 用オブジェクトと混在させない） */
const R2_PREFIX = 'transcribe/';

/** マニフェスト由来の許可リスト（`whisper-tiny/config.json` 形式） */
const ALLOWED_KEYS = new Set(
	listAllowedModelPaths().map((path) => path.slice(MODEL_BASE_PATH.length)),
);

const CONTENT_TYPES: Record<string, string> = {
	json: 'application/json; charset=utf-8',
	onnx: 'application/octet-stream',
	txt: 'text/plain; charset=utf-8',
};

function contentTypeFor(key: string): string {
	const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
	return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function notFound(): Response {
	return new Response('Not Found', {
		status: 404,
		headers: { 'Cache-Control': 'no-store' },
	});
}

export const onRequest = async (context: Context): Promise<Response> => {
	const { request, env } = context;

	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response('Method Not Allowed', {
			status: 405,
			headers: { Allow: 'GET, HEAD' },
		});
	}

	const url = new URL(request.url);
	const key = decodeURIComponent(url.pathname.slice(MODEL_BASE_PATH.length));

	// マニフェストに無いパスは配信しない（暗黙のパス解決を許可しない）
	if (!ALLOWED_KEYS.has(key)) return notFound();

	const bucket = env.TRANSCRIBE_MODELS;
	if (!bucket) {
		// バインディング未設定（Phase A2 未完了）。推測でフォールバックせず明示的に失敗させる
		return new Response('Model storage is not configured', {
			status: 503,
			headers: { 'Cache-Control': 'no-store' },
		});
	}

	const objectKey = `${R2_PREFIX}${key}`;
	const object =
		request.method === 'HEAD'
			? await bucket.head(objectKey)
			: await bucket.get(objectKey, {
					range: request.headers.get('range') ?? undefined,
				});

	if (!object) return notFound();

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('Content-Type', contentTypeFor(key));
	headers.set('ETag', object.httpEtag);
	// マニフェストで内容が固定されており、revision 変更時はパスも変わるため長期キャッシュ可能
	headers.set('Cache-Control', 'public, max-age=31536000, immutable');
	headers.set('X-Content-Type-Options', 'nosniff');

	if (request.method === 'HEAD') {
		headers.set('Content-Length', String(object.size));
		return new Response(null, { status: 200, headers });
	}

	return new Response(object.body, { status: 200, headers });
};
