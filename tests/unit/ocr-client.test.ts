import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
	OCR_MODEL_BASE_PATH,
	OCR_MODEL_FILES,
} from '../../src/lib/ocr/assets.ts';
import {
	OCR_ENGINE_FAILED_MESSAGE,
	OCR_TIMEOUT_MESSAGE,
	type OcrClientDeps,
	OcrError,
	type OcrProgress,
	recognizeImage,
	type WorkerLike,
} from '../../src/lib/ocr/client.ts';
import {
	type CacheLike,
	loadOcrModels,
	type ModelLoadDeps,
	OCR_MODEL_CACHE_NAME,
	OcrModelError,
} from '../../src/lib/ocr/model-cache.ts';

const ORIGIN = 'https://tools.example.test';
const MODEL_DIR = path.join(
	process.cwd(),
	'public',
	OCR_MODEL_BASE_PATH.replace(/^\/|\/$/g, ''),
);
const modelBytes = (name: string) =>
	new Uint8Array(fs.readFileSync(path.join(MODEL_DIR, `${name}.traineddata`)));
const JPN = modelBytes('jpn');
const ENG = modelBytes('eng');
const urlOf = (name: string) =>
	`${ORIGIN}${OCR_MODEL_BASE_PATH}${name}.traineddata`;

class FakeCache implements CacheLike {
	store = new Map<string, Uint8Array>();
	putFails = false;
	async match(url: string) {
		const bytes = this.store.get(url);
		return bytes ? new Response(bytes.slice()) : undefined;
	}
	async put(url: string, response: Response) {
		if (this.putFails) throw new Error('QuotaExceededError');
		this.store.set(url, new Uint8Array(await response.arrayBuffer()));
	}
	async delete(url: string) {
		return this.store.delete(url);
	}
	async keys() {
		return [...this.store.keys()].map((url) => ({ url }));
	}
}

type FetchCall = { url: string; init: RequestInit };

function makeModelDeps(
	options: {
		cache?: FakeCache | null;
		respond?: (url: string) => Response | Promise<Response>;
	} = {},
) {
	const calls: FetchCall[] = [];
	const cache = options.cache === undefined ? new FakeCache() : options.cache;
	const deps: ModelLoadDeps = {
		origin: ORIGIN,
		openCache: async () => cache,
		fetch: async (url, init) => {
			calls.push({ url, init });
			if (options.respond) return options.respond(url);
			const name = url.includes('jpn.') ? JPN : ENG;
			return new Response(name.slice(), { status: 200 });
		},
		sha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
	};
	return { deps, calls, cache };
}

describe('loadOcrModels: 固定URL・検証・専用キャッシュ', () => {
	it('初回は同一オリジンの固定URLから取得して検証・保存し、2回目はネットワークなしで読み込む（オフライン）', async () => {
		const { deps, calls, cache } = makeModelDeps();
		const first = await loadOcrModels('jpn+eng', {}, deps);
		assert.equal(first.fromCache, false);
		assert.equal(first.cacheWriteFailed, false);
		assert.deepEqual(
			first.languages.map((l) => l.code),
			['jpn', 'eng'],
		);
		assert.deepEqual(
			calls.map((c) => c.url),
			[urlOf('jpn'), urlOf('eng')],
		);
		assert.ok(calls.every((c) => c.init.credentials === 'omit'));
		assert.equal(cache?.store.size, 2);

		// オフライン相当: fetch が呼ばれたら失敗させる
		const offline = makeModelDeps({
			cache,
			respond: () => {
				throw new Error('offline');
			},
		});
		const second = await loadOcrModels('jpn+eng', {}, offline.deps);
		assert.equal(second.fromCache, true);
		assert.equal(offline.calls.length, 0);
		assert.deepEqual(second.languages[0].data, JPN);
	});

	it('英語のみのモードは eng だけを取得する', async () => {
		const { deps, calls } = makeModelDeps();
		const r = await loadOcrModels('eng', {}, deps);
		assert.deepEqual(
			r.languages.map((l) => l.code),
			['eng'],
		);
		assert.deepEqual(
			calls.map((c) => c.url),
			[urlOf('eng')],
		);
	});

	it('マニフェスト外のURL・別オリジンへは取得しない', async () => {
		const { deps, calls } = makeModelDeps();
		await loadOcrModels('jpn+eng', {}, deps);
		const allowed = new Set(
			OCR_MODEL_FILES.map((f) => `${ORIGIN}${OCR_MODEL_BASE_PATH}${f.path}`),
		);
		assert.ok(calls.every((c) => allowed.has(c.url)));
	});

	it('SHA-256 が一致しないデータは使わず保存もしない', async () => {
		const bad = ENG.slice();
		bad[100] ^= 0xff;
		const { deps, cache } = makeModelDeps({
			respond: () => new Response(bad, { status: 200 }),
		});
		await assert.rejects(
			loadOcrModels('eng', {}, deps),
			(e: unknown) => e instanceof OcrModelError && e.code === 'verify-failed',
		);
		assert.equal(cache?.store.size, 0);
	});

	it('想定サイズより大きい・小さいデータは拒否する', async () => {
		for (const body of [
			new Uint8Array([...ENG, 1]),
			ENG.slice(0, ENG.length - 1),
		]) {
			const { deps } = makeModelDeps({
				respond: () => new Response(body, { status: 200 }),
			});
			await assert.rejects(
				loadOcrModels('eng', {}, deps),
				(e: unknown) =>
					e instanceof OcrModelError && e.code === 'verify-failed',
			);
		}
	});

	it('404・通信失敗は fetch-failed で、日本語メッセージ', async () => {
		const notFound = makeModelDeps({
			respond: () => new Response('nope', { status: 404 }),
		});
		await assert.rejects(
			loadOcrModels('eng', {}, notFound.deps),
			(e: unknown) =>
				e instanceof OcrModelError &&
				e.code === 'fetch-failed' &&
				/[ぁ-ん]/.test(e.message),
		);
		const network = makeModelDeps({
			respond: () => {
				throw new TypeError('Failed to fetch');
			},
		});
		await assert.rejects(
			loadOcrModels('eng', {}, network.deps),
			(e: unknown) => e instanceof OcrModelError && e.code === 'fetch-failed',
		);
	});

	it('キャッシュ内の破損データは削除して取得し直す', async () => {
		const cache = new FakeCache();
		const broken = ENG.slice();
		broken[0] ^= 1;
		cache.store.set(urlOf('eng'), broken);
		const { deps, calls } = makeModelDeps({ cache });
		const r = await loadOcrModels('eng', {}, deps);
		assert.equal(r.fromCache, false);
		assert.equal(calls.length, 1);
		assert.deepEqual(cache.store.get(urlOf('eng')), ENG);
	});

	it('保存に失敗（容量不足）してもオンラインで読み込み、失敗を通知する', async () => {
		const cache = new FakeCache();
		cache.putFails = true;
		const { deps } = makeModelDeps({ cache });
		const r = await loadOcrModels('eng', {}, deps);
		assert.equal(r.cacheWriteFailed, true);
		assert.deepEqual(r.languages[0].data, ENG);
	});

	it('CacheStorageが使えない環境でもオンラインで読み込む', async () => {
		const { deps } = makeModelDeps({ cache: null });
		const r = await loadOcrModels('eng', {}, deps);
		assert.equal(r.cacheWriteFailed, true);
		assert.equal(r.languages.length, 1);
	});

	it('古いrevisionのキャッシュは整理し、現行のものは残す', async () => {
		const cache = new FakeCache();
		cache.store.set(`${ORIGIN}/models/ocr/old-revision/jpn.traineddata`, JPN);
		cache.store.set(urlOf('eng'), ENG);
		const { deps } = makeModelDeps({ cache });
		await loadOcrModels('eng', {}, deps);
		assert.deepEqual([...cache.store.keys()], [urlOf('eng')]);
	});

	it('進捗は実バイトで、合計に達する', async () => {
		const { deps } = makeModelDeps();
		const seen: [number, number][] = [];
		await loadOcrModels(
			'jpn+eng',
			{ onProgress: (d, t) => seen.push([d, t]) },
			deps,
		);
		const total = JPN.length + ENG.length;
		assert.deepEqual(seen[0], [0, total]);
		assert.deepEqual(seen.at(-1), [total, total]);
		assert.ok(
			seen.every(
				([d, t], i) => t === total && (i === 0 || d >= seen[i - 1][0]),
			),
		);
	});

	it('取得中の中断は aborted で、保存しない', async () => {
		const controller = new AbortController();
		const { deps, cache } = makeModelDeps({
			respond: () => {
				controller.abort();
				return new Response(ENG.slice(), { status: 200 });
			},
		});
		await assert.rejects(
			loadOcrModels('eng', { signal: controller.signal }, deps),
			(e: unknown) => e instanceof OcrModelError && e.code === 'aborted',
		);
		assert.equal(cache?.store.size, 0);
	});

	it('専用キャッシュ名は固定', () => {
		assert.equal(OCR_MODEL_CACHE_NAME, 'ocr-models-v1');
	});
});

// ---- Worker のメッセージ往復（公式Workerと同じ形式の偽物） ----

type Sent = { action: string; payload: Record<string, unknown>; jobId: string };

class FakeWorker implements WorkerLike {
	onmessage: WorkerLike['onmessage'] = null;
	onerror: WorkerLike['onerror'] = null;
	onmessageerror: WorkerLike['onmessageerror'] = null;
	sent: Sent[] = [];
	terminated = 0;
	/** action ごとの応答。未定義なら応答しない（固まったWorkerの再現） */
	handlers: Record<
		string,
		(msg: Sent, reply: (status: string, data?: unknown) => void) => void
	> = {};

	postMessage(message: unknown) {
		const msg = message as Sent & { workerId: string };
		this.sent.push(msg);
		const handler = this.handlers[msg.action];
		handler?.(msg, (status, data) =>
			queueMicrotask(() =>
				this.onmessage?.({
					data: {
						workerId: msg.workerId,
						jobId: msg.jobId,
						action: msg.action,
						status,
						data,
					},
				}),
			),
		);
	}
	terminate() {
		this.terminated++;
	}
	/** terminate後でも届きうる遅延メッセージ */
	emit(data: unknown) {
		this.onmessage?.({ data });
	}
}

function okWorker(text = '認識結果\r\nabc'): FakeWorker {
	const w = new FakeWorker();
	w.handlers = {
		load: (_m, reply) => reply('resolve', { loaded: true }),
		loadLanguage: (_m, reply) => reply('resolve'),
		initialize: (_m, reply) => reply('resolve'),
		recognize: (_m, reply) => {
			reply('progress', { progress: 0.5, status: 'recognizing text' });
			reply('resolve', { text });
		},
	};
	return w;
}

function makeDeps(worker: FakeWorker, models = makeModelDeps().deps) {
	let created = 0;
	const deps: OcrClientDeps = {
		createWorker: () => {
			created++;
			return worker;
		},
		models,
		corePath: `${ORIGIN}/vendor/ocr/7.0.0/core/`,
	};
	return { deps, created: () => created };
}

const image = () => new Uint8Array([1, 2, 3]);

describe('recognizeImage: Workerとの往復', () => {
	it('load→loadLanguage→initialize→recognize の順で送り、結果を返して Worker を終了する', async () => {
		const worker = okWorker();
		const { deps } = makeDeps(worker);
		const phases: OcrProgress[] = [];
		const result = await recognizeImage(
			image(),
			{ mode: 'jpn+eng', onProgress: (p) => phases.push(p) },
			deps,
		);
		assert.equal(result.text, '認識結果\r\nabc');
		assert.equal(result.modelFromCache, false);
		assert.deepEqual(
			worker.sent.map((s) => s.action),
			['load', 'loadLanguage', 'initialize', 'recognize'],
		);
		assert.equal(worker.terminated, 1);
		assert.deepEqual(
			[...new Set(phases.map((p) => p.phase))],
			['model', 'engine', 'recognize'],
		);
		// 進捗率を取得できない工程（エンジン起動）は null で、架空の値を出さない
		assert.ok(
			phases.filter((p) => p.phase === 'engine').every((p) => p.ratio === null),
		);
		assert.ok(phases.some((p) => p.phase === 'recognize' && p.ratio === 0.5));
	});

	it('initialize には言語名の文字列を渡し、loadLanguage にだけ {code,data} を渡す（7.0.0の不具合の回避）', async () => {
		const worker = okWorker();
		await recognizeImage(image(), { mode: 'jpn+eng' }, makeDeps(worker).deps);
		const load = worker.sent.find((s) => s.action === 'load');
		assert.deepEqual(load?.payload, {
			options: {
				lstmOnly: true,
				corePath: `${ORIGIN}/vendor/ocr/7.0.0/core/`,
				logging: false,
			},
		});
		const loadLang = worker.sent.find((s) => s.action === 'loadLanguage');
		const langs = loadLang?.payload.langs as {
			code: string;
			data: Uint8Array;
		}[];
		assert.deepEqual(
			langs.map((l) => l.code),
			['jpn', 'eng'],
		);
		assert.ok(langs[0].data instanceof Uint8Array);
		assert.deepEqual(loadLang?.payload.options, {
			cacheMethod: 'none',
			gzip: false,
			lstmOnly: true,
		});
		const init = worker.sent.find((s) => s.action === 'initialize');
		assert.deepEqual(init?.payload, { langs: 'jpn+eng', oem: 1, config: {} });
		const rec = worker.sent.find((s) => s.action === 'recognize');
		assert.deepEqual(rec?.payload.output, { text: true });
	});

	it('英語のみモードは eng だけを初期化する', async () => {
		const worker = okWorker();
		await recognizeImage(image(), { mode: 'eng' }, makeDeps(worker).deps);
		const init = worker.sent.find((s) => s.action === 'initialize');
		assert.equal(init?.payload.langs, 'eng');
	});

	it('認識中のキャンセルで aborted になり、Worker を終了し、遅延メッセージを無視する', async () => {
		const worker = okWorker();
		worker.handlers.recognize = () => {
			// 応答しない（認識が続いている状態）
		};
		const controller = new AbortController();
		const { deps } = makeDeps(worker);
		const promise = recognizeImage(
			image(),
			{
				mode: 'eng',
				signal: controller.signal,
				onProgress: (p) => {
					if (p.phase === 'recognize') controller.abort();
				},
			},
			deps,
		);
		await assert.rejects(
			promise,
			(e: unknown) => e instanceof OcrError && e.code === 'aborted',
		);
		assert.equal(worker.terminated, 1);
		// 終了後に届いた古い成功結果は何も起こさない
		const recJob = worker.sent.find((s) => s.action === 'recognize');
		assert.doesNotThrow(() =>
			worker.emit({
				jobId: recJob?.jobId,
				status: 'resolve',
				data: { text: '古い結果' },
			}),
		);
	});

	it('エンジン起動中（load応答なし）のキャンセルでも Worker を終了して確定する', async () => {
		const worker = new FakeWorker();
		const controller = new AbortController();
		const { deps } = makeDeps(worker);
		const promise = recognizeImage(
			image(),
			{
				mode: 'eng',
				signal: controller.signal,
				onProgress: (p) => p.phase === 'engine' && controller.abort(),
			},
			deps,
		);
		await assert.rejects(
			promise,
			(e: unknown) => e instanceof OcrError && e.code === 'aborted',
		);
		assert.equal(worker.terminated, 1);
	});

	it('120秒相当のタイムアウトでも（応答しないWorkerでも）Promiseを確定し、Worker を終了する', async () => {
		const worker = new FakeWorker();
		const started = Date.now();
		await assert.rejects(
			recognizeImage(
				image(),
				{ mode: 'eng', timeoutMs: 60 },
				makeDeps(worker).deps,
			),
			(e: unknown) =>
				e instanceof OcrError &&
				e.code === 'timeout' &&
				e.message === OCR_TIMEOUT_MESSAGE,
		);
		assert.ok(Date.now() - started < 2000);
		assert.equal(worker.terminated, 1);
	});

	it('既定のタイムアウトは120秒', async () => {
		const { OCR_TIMEOUT_MS } = await import('../../src/lib/tools/image-ocr.ts');
		assert.equal(OCR_TIMEOUT_MS, 120_000);
	});

	it('Workerが reject を返したら engine エラーで、Worker を終了する', async () => {
		const worker = okWorker();
		worker.handlers.initialize = (_m, reply) =>
			reply('reject', 'initialization failed');
		await assert.rejects(
			recognizeImage(image(), { mode: 'eng' }, makeDeps(worker).deps),
			(e: unknown) =>
				e instanceof OcrError &&
				e.code === 'engine' &&
				e.message === OCR_ENGINE_FAILED_MESSAGE,
		);
		assert.equal(worker.terminated, 1);
		assert.ok(!worker.sent.some((s) => s.action === 'recognize'));
	});

	it('Workerのエラーイベント（スクリプト読込失敗等）でも確定し、Worker を終了する', async () => {
		const worker = new FakeWorker();
		worker.handlers.load = () => {
			queueMicrotask(() => worker.onerror?.({ message: 'Failed to load' }));
		};
		await assert.rejects(
			recognizeImage(image(), { mode: 'eng' }, makeDeps(worker).deps),
			(e: unknown) => e instanceof OcrError && e.code === 'engine',
		);
		assert.equal(worker.terminated, 1);
	});

	it('結果にtextが無い場合はエンジンエラー', async () => {
		const worker = okWorker();
		worker.handlers.recognize = (_m, reply) => reply('resolve', {});
		await assert.rejects(
			recognizeImage(image(), { mode: 'eng' }, makeDeps(worker).deps),
			(e: unknown) => e instanceof OcrError && e.code === 'engine',
		);
	});

	it('開始前に中断済みなら Worker も作らない', async () => {
		const controller = new AbortController();
		controller.abort();
		const worker = okWorker();
		const { deps, created } = makeDeps(worker);
		await assert.rejects(
			recognizeImage(image(), { mode: 'eng', signal: controller.signal }, deps),
			(e: unknown) => e instanceof OcrError && e.code === 'aborted',
		);
		assert.equal(created(), 0);
	});

	it('言語データ取得中の中断・失敗では Worker を作らない', async () => {
		const controller = new AbortController();
		const worker = okWorker();
		const models = makeModelDeps({
			respond: () => {
				controller.abort();
				return new Response(ENG.slice(), { status: 200 });
			},
		});
		const a = makeDeps(worker, models.deps);
		await assert.rejects(
			recognizeImage(
				image(),
				{ mode: 'eng', signal: controller.signal },
				a.deps,
			),
			(e: unknown) => e instanceof OcrError && e.code === 'aborted',
		);
		assert.equal(a.created(), 0);

		const failing = makeModelDeps({
			respond: () => new Response('x', { status: 404 }),
		});
		const b = makeDeps(okWorker(), failing.deps);
		await assert.rejects(
			recognizeImage(image(), { mode: 'eng' }, b.deps),
			(e: unknown) =>
				e instanceof OcrError &&
				e.code === 'model' &&
				/[ぁ-ん]/.test(e.message),
		);
		assert.equal(b.created(), 0);
	});

	it('失敗後の再試行ができる（新しいWorkerで成功する）', async () => {
		const models = makeModelDeps();
		const bad = okWorker();
		bad.handlers.recognize = (_m, reply) => reply('reject', 'boom');
		await assert.rejects(
			recognizeImage(image(), { mode: 'eng' }, makeDeps(bad, models.deps).deps),
		);
		const good = okWorker('成功');
		const r = await recognizeImage(
			image(),
			{ mode: 'eng' },
			makeDeps(good, models.deps).deps,
		);
		assert.equal(r.text, '成功');
		assert.equal(r.modelFromCache, true);
	});

	it('専用キャッシュに保存できない場合は通知し、認識は続行する', async () => {
		const cache = new FakeCache();
		cache.putFails = true;
		const models = makeModelDeps({ cache });
		let notified = 0;
		const r = await recognizeImage(
			image(),
			{ mode: 'eng', onModelCacheUnavailable: () => notified++ },
			makeDeps(okWorker(), models.deps).deps,
		);
		assert.equal(r.text, '認識結果\r\nabc');
		assert.equal(notified, 1);
	});

	it('未処理のPromise拒否を残さない', async () => {
		let unhandled = 0;
		const onUnhandled = () => {
			unhandled++;
		};
		process.on('unhandledRejection', onUnhandled);
		try {
			const controller = new AbortController();
			const worker = okWorker();
			worker.handlers.recognize = () => undefined;
			const p = recognizeImage(
				image(),
				{
					mode: 'eng',
					signal: controller.signal,
					onProgress: (x) => x.phase === 'recognize' && controller.abort(),
				},
				makeDeps(worker).deps,
			);
			await assert.rejects(p);
			await new Promise((r) => setTimeout(r, 50));
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
		assert.equal(unhandled, 0);
	});
});
