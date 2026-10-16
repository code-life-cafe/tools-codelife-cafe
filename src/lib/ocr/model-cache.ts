// model-cache.ts — OCR言語データ（静的モデル）の取得・検証・専用CacheStorage保存
//
// 保存するのはマニフェスト（assets.ts）に載った固定URLの静的ファイルだけ。
// 画像・ファイル名・認識結果は一切保存しない。取得物は bytes と SHA-256 を検証してから使う。
// 既存のService Workerは .traineddata を保存しないため、オフライン再認識はこのキャッシュが担う。

import type { OcrMode } from '../tools/image-ocr.ts';
import {
	OCR_MODEL_BASE_PATH,
	OCR_MODEL_FILES,
	type OcrAssetFile,
} from './assets.ts';

/** 専用CacheStorageの名前。モデルの版を変える場合は URL（revision）で区別される */
export const OCR_MODEL_CACHE_NAME = 'ocr-models-v1';

export type ModelLang = 'jpn' | 'eng';

export function languagesForMode(mode: OcrMode): ModelLang[] {
	return mode === 'eng' ? ['eng'] : ['jpn', 'eng'];
}

export type LoadedLanguage = { code: ModelLang; data: Uint8Array };

export type ModelLoadResult = {
	languages: LoadedLanguage[];
	/** 全言語を専用キャッシュから読み込んだ（ネットワーク取得なし） */
	fromCache: boolean;
	/** 保存できなかった（容量不足・無効など）。認識自体は続行できる */
	cacheWriteFailed: boolean;
};

export type OcrModelErrorCode = 'fetch-failed' | 'verify-failed' | 'aborted';

export class OcrModelError extends Error {
	readonly code: OcrModelErrorCode;
	constructor(code: OcrModelErrorCode, message: string) {
		super(message);
		this.name = 'OcrModelError';
		this.code = code;
	}
}

export const MODEL_FETCH_FAILED_MESSAGE =
	'文字認識に必要なデータを取得できませんでした。通信状況を確認して、もう一度お試しください。';
export const MODEL_VERIFY_FAILED_MESSAGE =
	'取得した文字認識データが想定と一致しません（破損の可能性があります）。時間をおいて、もう一度お試しください。';

/** Cache API のうち使う部分（テストで差し替え可能にする） */
export interface CacheLike {
	match(request: string): Promise<Response | undefined>;
	put(request: string, response: Response): Promise<void>;
	delete(request: string): Promise<boolean>;
	keys(): Promise<readonly { url: string }[]>;
}

export type ModelLoadDeps = {
	/** 専用キャッシュを開く。使えない環境では null を返す */
	openCache: () => Promise<CacheLike | null>;
	fetch: (url: string, init: RequestInit) => Promise<Response>;
	sha256: (bytes: Uint8Array) => Promise<string>;
	/** 配信元（例: https://tools.codelife.cafe） */
	origin: string;
};

export type ModelLoadOptions = {
	signal?: AbortSignal;
	/** 取得済みバイト数 / 合計バイト数（実測。架空の進捗は出さない） */
	onProgress?: (loadedBytes: number, totalBytes: number) => void;
};

export function defaultModelDeps(): ModelLoadDeps {
	return {
		openCache: async () => {
			try {
				if (typeof caches === 'undefined') return null;
				const cache = await caches.open(OCR_MODEL_CACHE_NAME);
				return {
					match: (url) => cache.match(url),
					put: (url, response) => cache.put(url, response),
					delete: (url) => cache.delete(url),
					keys: async () => (await cache.keys()) as readonly { url: string }[],
				};
			} catch {
				return null;
			}
		},
		fetch: (url, init) => fetch(url, init),
		sha256: async (bytes) => {
			const subtle = globalThis.crypto?.subtle;
			if (!subtle) throw new Error('crypto.subtle unavailable');
			// 型の都合で ArrayBuffer へコピーせず、実体のバッファ範囲だけを渡す
			const view = bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength,
			) as ArrayBuffer;
			const digest = new Uint8Array(await subtle.digest('SHA-256', view));
			return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join(
				'',
			);
		},
		origin: location.origin,
	};
}

export function modelUrl(origin: string, file: OcrAssetFile): string {
	return `${origin}${OCR_MODEL_BASE_PATH}${file.path}`;
}

export function modelFileFor(code: ModelLang): OcrAssetFile {
	const file = OCR_MODEL_FILES.find((f) => f.path === `${code}.traineddata`);
	if (!file) throw new Error(`manifest entry missing: ${code}`);
	return file;
}

async function verified(
	bytes: Uint8Array,
	file: OcrAssetFile,
	deps: ModelLoadDeps,
): Promise<boolean> {
	if (bytes.length !== file.bytes) return false;
	try {
		return (await deps.sha256(bytes)) === file.sha256;
	} catch {
		return false;
	}
}

async function readBody(
	response: Response,
	file: OcrAssetFile,
	signal: AbortSignal | undefined,
	onChunk: (n: number) => void,
): Promise<Uint8Array> {
	const out = new Uint8Array(file.bytes);
	let received = 0;
	const append = (chunk: Uint8Array) => {
		// 想定より大きいデータはメモリを使い切る前に拒否する
		if (received + chunk.length > file.bytes) {
			throw new OcrModelError('verify-failed', MODEL_VERIFY_FAILED_MESSAGE);
		}
		out.set(chunk, received);
		received += chunk.length;
		onChunk(chunk.length);
	};
	if (response.body) {
		const reader = response.body.getReader();
		try {
			for (;;) {
				if (signal?.aborted) {
					throw new OcrModelError('aborted', '中断されました。');
				}
				const { done, value } = await reader.read();
				if (done) break;
				append(value);
			}
		} finally {
			void reader.cancel().catch(() => undefined);
		}
	} else {
		append(new Uint8Array(await response.arrayBuffer()));
	}
	return out.subarray(0, received);
}

/**
 * 指定モードに必要な言語データを、専用キャッシュまたは同一オリジンから取得して検証済みで返す。
 * キャッシュが使えない・保存に失敗しても、ネットワーク取得で続行する。
 */
export async function loadOcrModels(
	mode: OcrMode,
	options: ModelLoadOptions = {},
	deps: ModelLoadDeps = defaultModelDeps(),
): Promise<ModelLoadResult> {
	const { signal, onProgress } = options;
	const wanted = languagesForMode(mode).map((code) => ({
		code,
		file: modelFileFor(code),
	}));
	const total = wanted.reduce((n, w) => n + w.file.bytes, 0);
	let loaded = 0;
	onProgress?.(0, total);
	const checkAbort = () => {
		if (signal?.aborted) throw new OcrModelError('aborted', '中断されました。');
	};

	const cache = await deps.openCache();
	checkAbort();

	// 現在のマニフェストに無い古いモデル（旧revision）のキャッシュを整理する
	if (cache) {
		try {
			const known = new Set(
				OCR_MODEL_FILES.map((f) => modelUrl(deps.origin, f)),
			);
			for (const request of await cache.keys()) {
				if (!known.has(request.url)) await cache.delete(request.url);
			}
		} catch {
			// 整理に失敗しても認識には影響しない
		}
	}

	const languages: LoadedLanguage[] = [];
	let allFromCache = true;
	let cacheWriteFailed = false;

	for (const { code, file } of wanted) {
		const url = modelUrl(deps.origin, file);
		let bytes: Uint8Array | null = null;

		if (cache) {
			try {
				const hit = await cache.match(url);
				if (hit) {
					const candidate = new Uint8Array(await hit.arrayBuffer());
					if (await verified(candidate, file, deps)) {
						bytes = candidate;
					} else {
						await cache.delete(url);
					}
				}
			} catch {
				bytes = null;
			}
		}
		checkAbort();

		if (bytes) {
			loaded += file.bytes;
			onProgress?.(loaded, total);
		} else {
			allFromCache = false;
			let response: Response;
			try {
				response = await deps.fetch(url, {
					signal,
					credentials: 'omit',
					cache: 'no-cache',
				});
			} catch {
				if (signal?.aborted) {
					throw new OcrModelError('aborted', '中断されました。');
				}
				throw new OcrModelError('fetch-failed', MODEL_FETCH_FAILED_MESSAGE);
			}
			if (!response.ok) {
				throw new OcrModelError('fetch-failed', MODEL_FETCH_FAILED_MESSAGE);
			}
			let received: Uint8Array;
			try {
				received = await readBody(response, file, signal, (n) => {
					loaded += n;
					onProgress?.(loaded, total);
				});
			} catch (error) {
				if (error instanceof OcrModelError) throw error;
				if (signal?.aborted) {
					throw new OcrModelError('aborted', '中断されました。');
				}
				throw new OcrModelError('fetch-failed', MODEL_FETCH_FAILED_MESSAGE);
			}
			if (!(await verified(received, file, deps))) {
				throw new OcrModelError('verify-failed', MODEL_VERIFY_FAILED_MESSAGE);
			}
			bytes = received;
			if (cache) {
				try {
					await cache.put(
						url,
						new Response(received.slice(), {
							headers: { 'Content-Type': 'application/octet-stream' },
						}),
					);
				} catch {
					cacheWriteFailed = true;
				}
			} else {
				cacheWriteFailed = true;
			}
		}
		languages.push({ code, data: bytes });
	}

	return { languages, fromCache: allFromCache, cacheWriteFailed };
}
