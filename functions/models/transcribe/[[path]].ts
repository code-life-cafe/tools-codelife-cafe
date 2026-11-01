// /models/transcribe/** — Whisper ONNX モデルの同一オリジン配信（Cloudflare R2 プロキシ）
//
// なぜ同一オリジンなのか:
//   /transcribe は CSP の connect-src を 'self' に限定している（音声・テキストの流出経路を塞ぐため）。
//   既存ツール（/bg-remove）のようにクロスオリジンの models.tools.codelife.cafe を直接叩く方式は
//   この不変条件と両立しないため、Pages Function 経由で R2 を同一オリジンに見せる。
//
// マニフェスト（src/lib/transcribe/model-manifest.ts）に列挙されたパスだけを配信する。
// 未知のパス・暗黙のパス解決は 404 とし、Hugging Face 等へのフォールバックは行わない。
// パスには revision が含まれる（`<name>/<revision>/...`）ため、内容が変わると URL も変わる。
//
// Range には対応しない。transformers.js は `env.allowRemoteModels = false` かつ
// 相対 `localModelPath` の構成では Range 付きリクエストを出さない
// （`fetch_file_head` の `Range: bytes=0-0` は絶対 URL のときだけ実行される）。
// 中途半端な部分応答（206 / Content-Range / 416 を伴わない実装）を残さないため、
// リクエストの Range ヘッダーは無視して常に全体を 200 で返す。

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
	get(key: string): Promise<R2Object | null>;
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

/** マニフェスト由来の許可リスト（`whisper-tiny/<revision>/config.json` 形式） */
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
			: await bucket.get(objectKey);

	if (!object) return notFound();

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('Content-Type', contentTypeFor(key));
	headers.set('ETag', object.httpEtag);
	// URL に revision が含まれ、同じ URL の内容は差し替わらないため長期キャッシュ可能
	headers.set('Cache-Control', 'public, max-age=31536000, immutable');
	headers.set('X-Content-Type-Options', 'nosniff');
	// 部分取得には対応しない（不完全な Range 応答を返さないことを明示する）
	headers.set('Accept-Ranges', 'none');

	if (request.method === 'HEAD') {
		headers.set('Content-Length', String(object.size));
		return new Response(null, { status: 200, headers });
	}

	return new Response(object.body, { status: 200, headers });
};
