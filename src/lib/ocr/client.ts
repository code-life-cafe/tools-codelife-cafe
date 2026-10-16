// client.ts — OCRエンジン（Tesseract.js 7.0.0 の固定Worker）との接続と寿命管理
//
// 公式の createWorker は使わない。7.0.0 は言語データを {code,data} で渡すと initialize が
// 言語名に `l.data` を連結してしまい初期化に失敗する（実測）。さらに createWorker は
// 初期化完了まで Worker を返さず、キャンセル/タイムアウト時に終了できない。
// そこで固定した worker.min.js（assets.ts のSHA-256で検証済み）を直接 Worker として起動し、
// 公式Workerが受け付けるメッセージ（load / loadLanguage / initialize / recognize）だけを送る。
// - 1回の認識ごとに Worker を作り、成功・失敗・キャンセル・タイムアウトの全経路で terminate する
// - Worker が応答しなくなっても自前の Promise を必ず確定させる（terminate後は応答が来ない）
// - 言語データは同一オリジンの静的ファイルのみ（CDN既定値へのフォールバックなし）
// - 画像は Worker へ渡すのみで、保存・通信しない

import {
	checkOcrDimensions,
	OCR_TIMEOUT_MS,
	type OcrMode,
} from '../tools/image-ocr.ts';
import { OCR_VENDOR_BASE_PATH } from './assets.ts';
import {
	type LoadedLanguage,
	loadOcrModels,
	type ModelLoadDeps,
	OcrModelError,
} from './model-cache.ts';

export type OcrPhase = 'model' | 'engine' | 'recognize';

/** ratio が null の工程は進捗率を取得できない（架空の百分率を出さない） */
export type OcrProgress = { phase: OcrPhase; ratio: number | null };

export type OcrErrorCode =
	| 'aborted'
	| 'timeout'
	| 'model'
	| 'engine'
	| 'decode'
	| 'too-large';

export class OcrError extends Error {
	readonly code: OcrErrorCode;
	constructor(code: OcrErrorCode, message: string) {
		super(message);
		this.name = 'OcrError';
		this.code = code;
	}
}

export const OCR_ENGINE_FAILED_MESSAGE =
	'文字認識エンジンの実行に失敗しました。ページを再読み込みして、もう一度お試しください。';
export const OCR_TIMEOUT_MESSAGE =
	'認識に時間がかかりすぎたため停止しました（120秒）。画像を切り抜いたり縮小して、もう一度お試しください。';
export const OCR_DECODE_FAILED_MESSAGE =
	'画像を読み込めませんでした。ファイルが破損している可能性があります。';

/** Worker のうち使う部分（テストで差し替え可能にする） */
export interface WorkerLike {
	postMessage(message: unknown, transfer?: Transferable[]): void;
	terminate(): void;
	onmessage: ((event: { data: unknown }) => void) | null;
	onerror: ((event: { message?: string }) => void) | null;
	onmessageerror: ((event: unknown) => void) | null;
}

export type OcrClientDeps = {
	createWorker: () => WorkerLike;
	models: ModelLoadDeps | undefined;
	corePath: string;
};

export function defaultClientDeps(): OcrClientDeps {
	return {
		// DOMのWorkerは WorkerLike が使う部分（postMessage/terminate/onmessage/onerror）を満たす
		createWorker: () =>
			new Worker(
				new URL(`${OCR_VENDOR_BASE_PATH}worker.min.js`, location.origin),
			) as unknown as WorkerLike,
		models: undefined,
		corePath: new URL(`${OCR_VENDOR_BASE_PATH}core/`, location.origin).href,
	};
}

export type RecognizeOptions = {
	mode: OcrMode;
	signal?: AbortSignal;
	/** 認識開始（エンジン起動）からのタイムアウト。既定 120秒 */
	timeoutMs?: number;
	onProgress?: (progress: OcrProgress) => void;
	/** 専用キャッシュへ保存できなかった場合に呼ばれる（認識は続行する） */
	onModelCacheUnavailable?: () => void;
};

export type RecognizeResult = {
	text: string;
	/** 言語データを専用キャッシュだけから読み込めた */
	modelFromCache: boolean;
};

type Pending = {
	resolve: (data: unknown) => void;
	reject: (error: Error) => void;
	onProgress?: (progress: number | null) => void;
};

/** 公式Workerとのメッセージ往復を行う薄いラッパー */
class EngineChannel {
	private seq = 0;
	private readonly pending = new Map<string, Pending>();
	closed = false;

	private readonly worker: WorkerLike;

	constructor(worker: WorkerLike, onFatal: (message: string) => void) {
		this.worker = worker;
		worker.onmessage = (event) => this.onMessage(event.data);
		worker.onerror = (event) => onFatal(event.message ?? 'worker error');
		worker.onmessageerror = () => onFatal('worker message error');
	}

	private onMessage(raw: unknown): void {
		if (this.closed || raw === null || typeof raw !== 'object') return;
		const data = raw as {
			jobId?: string;
			status?: string;
			data?: unknown;
		};
		const job =
			data.jobId === undefined ? undefined : this.pending.get(data.jobId);
		if (!job) return;
		if (data.status === 'progress') {
			const p = (data.data as { progress?: unknown } | undefined)?.progress;
			job.onProgress?.(typeof p === 'number' ? p : null);
			return;
		}
		this.pending.delete(data.jobId as string);
		if (data.status === 'resolve') job.resolve(data.data);
		else job.reject(new Error(String(data.data)));
	}

	send(
		action: string,
		payload: unknown,
		onProgress?: (progress: number | null) => void,
		transfer?: Transferable[],
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (this.closed) {
				reject(new Error('closed'));
				return;
			}
			const jobId = `ocr-${++this.seq}`;
			this.pending.set(jobId, { resolve, reject, onProgress });
			this.worker.postMessage(
				{ workerId: 'ocr', jobId, action, payload },
				transfer ?? [],
			);
		});
	}

	/** 以後の応答を捨て、Workerを終了する。待機中のjobは呼び出し側が確定させる */
	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.worker.onmessage = null;
		this.worker.onerror = null;
		this.worker.onmessageerror = null;
		this.pending.clear();
		try {
			this.worker.terminate();
		} catch {
			// 既に終了している
		}
	}
}

const abortError = () => new OcrError('aborted', '中断されました。');

/**
 * 画像（PNGバイト列）を認識してテキストを返す。
 * 言語データの取得 → Worker起動 → 認識。どの経路でも Worker は終了し、Promiseは確定する。
 */
export async function recognizeImage(
	image: Uint8Array,
	options: RecognizeOptions,
	deps: OcrClientDeps = defaultClientDeps(),
): Promise<RecognizeResult> {
	const { mode, signal, onProgress } = options;
	const timeoutMs = options.timeoutMs ?? OCR_TIMEOUT_MS;
	if (signal?.aborted) throw abortError();

	// 1) 言語データ（同一オリジン→検証→専用キャッシュ）。認識のタイムアウトには含めない
	onProgress?.({ phase: 'model', ratio: 0 });
	let languages: LoadedLanguage[];
	let modelFromCache = false;
	try {
		const loaded = await loadOcrModels(
			mode,
			{
				signal,
				onProgress: (done, total) =>
					onProgress?.({ phase: 'model', ratio: total > 0 ? done / total : 0 }),
			},
			deps.models,
		);
		languages = loaded.languages;
		modelFromCache = loaded.fromCache;
		if (loaded.cacheWriteFailed) options.onModelCacheUnavailable?.();
	} catch (error) {
		if (error instanceof OcrModelError) {
			if (error.code === 'aborted') throw abortError();
			throw new OcrError('model', error.message);
		}
		throw new OcrError('model', OCR_ENGINE_FAILED_MESSAGE);
	}
	if (signal?.aborted) throw abortError();

	// 2) Worker 起動〜認識。ここからタイムアウトを数える
	const worker = deps.createWorker();
	let channel: EngineChannel | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;

	try {
		return await new Promise<RecognizeResult>((resolve, reject) => {
			let settled = false;
			const finish = (action: () => void) => {
				if (settled) return;
				settled = true;
				action();
			};
			channel = new EngineChannel(worker, () =>
				finish(() => reject(new OcrError('engine', OCR_ENGINE_FAILED_MESSAGE))),
			);
			const ch = channel;
			timer = setTimeout(
				() =>
					finish(() => reject(new OcrError('timeout', OCR_TIMEOUT_MESSAGE))),
				timeoutMs,
			);
			onAbort = () => finish(() => reject(abortError()));
			signal?.addEventListener('abort', onAbort, { once: true });

			onProgress?.({ phase: 'engine', ratio: null });
			(async () => {
				await ch.send('load', {
					options: {
						lstmOnly: true,
						corePath: deps.corePath,
						logging: false,
					},
				});
				await ch.send('loadLanguage', {
					langs: languages,
					options: {
						cacheMethod: 'none',
						gzip: false,
						lstmOnly: true,
					},
				});
				// 実行時の言語名は文字列で指定する（{code,data} 配列は initialize が壊れる）
				await ch.send('initialize', {
					langs: languages.map((l) => l.code).join('+'),
					oem: 1,
					config: {},
				});
				onProgress?.({ phase: 'recognize', ratio: 0 });
				const result = (await ch.send(
					'recognize',
					{ image, options: {}, output: { text: true } },
					(p) => {
						if (p !== null) onProgress?.({ phase: 'recognize', ratio: p });
					},
					[image.buffer as ArrayBuffer],
				)) as { text?: unknown };
				if (typeof result?.text !== 'string') {
					throw new Error('no text in result');
				}
				return result.text;
			})().then(
				(text) => finish(() => resolve({ text, modelFromCache })),
				() =>
					finish(() =>
						reject(new OcrError('engine', OCR_ENGINE_FAILED_MESSAGE)),
					),
			);
		});
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		if (onAbort) signal?.removeEventListener('abort', onAbort);
		// 成功・失敗・キャンセル・タイムアウトのいずれでも Worker を終了する
		if (channel) (channel as EngineChannel).close();
		else worker.terminate();
	}
}

// ---------------------------------------------------------------------------
// 入力画像のデコード（EXIF向き・透過の白合成・PNG化）
// ---------------------------------------------------------------------------

/**
 * 画像ファイルをデコードし、EXIFの向きを反映して白背景に合成したPNGバイト列にする。
 * 寸法はデコード後にも再確認する（ヘッダー検査後の保険）。
 */
export async function decodeImageForOcr(file: Blob): Promise<{
	png: Uint8Array;
	width: number;
	height: number;
}> {
	let bitmap: ImageBitmap;
	try {
		try {
			bitmap = await createImageBitmap(file, {
				imageOrientation: 'from-image',
			});
		} catch {
			bitmap = await createImageBitmap(file);
		}
	} catch {
		throw new OcrError('decode', OCR_DECODE_FAILED_MESSAGE);
	}
	const { width, height } = bitmap;
	const dimensionError = checkOcrDimensions(width, height);
	if (dimensionError && !dimensionError.ok) {
		bitmap.close();
		throw new OcrError('too-large', dimensionError.message);
	}
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	try {
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new OcrError('decode', OCR_DECODE_FAILED_MESSAGE);
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, width, height);
		ctx.drawImage(bitmap, 0, 0);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/png'),
		);
		if (!blob) throw new OcrError('decode', OCR_DECODE_FAILED_MESSAGE);
		return {
			png: new Uint8Array(await blob.arrayBuffer()),
			width,
			height,
		};
	} finally {
		bitmap.close();
		// キャンバスのメモリを早めに解放する
		canvas.width = 0;
		canvas.height = 0;
	}
}
