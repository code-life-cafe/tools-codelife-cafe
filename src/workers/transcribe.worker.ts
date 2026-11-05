// transcribe.worker.ts — ブラウザ内 Whisper 文字起こしの推論 Worker
//
// 正本: https://app.notion.com/p/396dfd36033681cba834ecd64d6167b3 「詳細設計書 4. / 8.」
//
// 不変条件（プライバシー）:
// - 音声・文字起こしテキストを外部へ送らない。
// - モデルは同一オリジン `/models/transcribe/` からのみ取得する（allowRemoteModels = false）。
// - ONNX Runtime の WASM は自サイト `/vendor/onnx-wasm/` に固定する（jsDelivr 既定を禁止）。
//
// このファイルが唯一の推論実行箇所。キャンセルはメインスレッドの worker.terminate() が正のため、
// プロトコルに cancel は存在しない。

import { env, pipeline, WhisperTextStreamer } from '@huggingface/transformers';
import {
	finalizeTranscript,
	isSilentAudio,
	type WhisperOutput,
} from '../lib/tools/transcribe.ts';
import { TARGET_SAMPLE_RATE } from '../lib/transcribe/audio-core.ts';
import {
	getModelArtifact,
	MODEL_BASE_PATH,
	ONNX_WASM_BASE_PATH,
} from '../lib/transcribe/model-manifest.ts';
import { requiredFiles } from '../lib/transcribe/models.ts';
import type {
	ErrorCode,
	ModelId,
	TranscribeDevice,
	WorkerRequest,
	WorkerResponse,
} from '../lib/transcribe/protocol.ts';
import { normalizeSegments } from '../lib/transcribe/segments.ts';

// --- 取得先の固定（外部フォールバック禁止） ---

env.allowRemoteModels = false;
env.allowLocalModels = true;
// 同一オリジンの Cloudflare ルート経由で R2 を配信する。絶対URL・remoteHost は使用しない
env.localModelPath = MODEL_BASE_PATH;
env.useBrowserCache = true;

const wasmBackend = env.backends?.onnx?.wasm;
if (wasmBackend) {
	// SharedArrayBuffer を要求しない設定（COOP/COEP を他ツールに波及させない）
	wasmBackend.numThreads = 1;
	wasmBackend.simd = true;
	wasmBackend.proxy = false;
	// transformers.js は import 時に cdn.jsdelivr.net を既定値として書き込むため、必ず上書きする。
	// Safari は asyncify 版が動かないため非 asyncify を使う（transformers.js の既定分岐と同じ）。
	const isSafari =
		typeof navigator !== 'undefined' &&
		/^((?!chrome|android).)*safari/i.test(navigator.userAgent);
	const base = isSafari
		? 'ort-wasm-simd-threaded'
		: 'ort-wasm-simd-threaded.asyncify';
	wasmBackend.wasmPaths = {
		mjs: `${ONNX_WASM_BASE_PATH}${base}.mjs`,
		wasm: `${ONNX_WASM_BASE_PATH}${base}.wasm`,
	};
}

self.addEventListener('unhandledrejection', (event) => {
	event.preventDefault();
});

// --- 推論パラメータ（正本「詳細設計書 8.」） ---

const CHUNK_LENGTH_S = 30;
const STRIDE_LENGTH_S = 5;
/** チャンクの前進量（秒）。transformers.js の jump = window - 2 * stride と一致させる */
const JUMP_S = CHUNK_LENGTH_S - 2 * STRIDE_LENGTH_S;

// biome-ignore lint/suspicious/noExplicitAny: Transformers.js のパイプライン型は公開されていない
type AsrPipeline = any;

let transcriber: AsrPipeline | null = null;
let loadedKey: string | null = null;

function post(message: WorkerResponse): void {
	self.postMessage(message);
}

/** アプリ側でも同じ式でチャンク数を数える（推論進捗の分母にする） */
export function countChunks(sampleCount: number): number {
	const window = TARGET_SAMPLE_RATE * CHUNK_LENGTH_S;
	const jump = TARGET_SAMPLE_RATE * JUMP_S;
	if (sampleCount <= window) return 1;
	let offset = 0;
	let count = 0;
	for (;;) {
		count++;
		if (offset + window >= sampleCount) break;
		offset += jump;
	}
	return count;
}

// --- エラー正規化（ErrorCode 6種へ集約） ---

function toErrorCode(error: unknown, phase: 'load' | 'infer'): ErrorCode {
	const message = error instanceof Error ? error.message : String(error);
	const lower = message.toLowerCase();
	if (
		lower.includes('out of memory') ||
		lower.includes('oom') ||
		lower.includes('allocation failed') ||
		lower.includes('array buffer allocation')
	) {
		return 'oom';
	}
	if (phase === 'load') return 'model-load-failed';
	return 'unsupported-browser';
}

function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// --- モデルロード ---

async function ensurePipeline(
	modelId: ModelId,
	device: TranscribeDevice,
): Promise<AsrPipeline> {
	const key = `${modelId}:${device}`;
	if (transcriber && loadedKey === key) return transcriber;

	const artifact = getModelArtifact(modelId);
	const expected = new Map(
		requiredFiles(artifact, device).map((f) => [f.path, f.bytes]),
	);
	const totalBytes = [...expected.values()].reduce((a, b) => a + b, 0);
	const loadedBytes = new Map<string, number>();
	let lastPct = -1;

	const reportModelProgress = () => {
		if (totalBytes <= 0) return;
		let sum = 0;
		for (const bytes of loadedBytes.values()) sum += bytes;
		const pct = Math.max(
			0,
			Math.min(100, Math.round((sum / totalBytes) * 100)),
		);
		if (pct === lastPct) return;
		lastPct = pct;
		post({ type: 'progress', kind: 'model', pct });
	};

	const dtype = artifact.dtype[device];

	transcriber = await pipeline(
		'automatic-speech-recognition',
		artifact.modelId,
		{
			device,
			// dtype はオブジェクトではなく**文字列**で渡し、全セッションへ一律に適用する。
			// transformers.js v4 のオブジェクト形式はキーが「セッション名」であり、
			// Whisper のエンコーダは `encoder_model` ではなく `model`（ファイル名は encoder_model）。
			// 取り違えると既定 dtype にフォールバックしてマニフェスト外の
			// `encoder_model.onnx`（fp32）を要求し、404 → model-load-failed になる。
			dtype,
			progress_callback: (event: {
				status?: string;
				file?: string;
				loaded?: number;
				total?: number;
				progress?: number;
			}) => {
				const file = event.file;
				if (!file) return;
				const expectedBytes = expected.get(file);
				// マニフェストに無いファイル・不正値は無視する（偽のパーセンテージを出さない）
				if (expectedBytes === undefined) return;
				if (event.status === 'done') {
					loadedBytes.set(file, expectedBytes);
					reportModelProgress();
					return;
				}
				const loaded = Number.isFinite(event.loaded)
					? (event.loaded as number)
					: Number.isFinite(event.progress)
						? ((event.progress as number) / 100) * expectedBytes
						: Number.NaN;
				if (!Number.isFinite(loaded)) return;
				loadedBytes.set(file, Math.max(0, Math.min(loaded, expectedBytes)));
				reportModelProgress();
			},
		},
	);

	loadedKey = key;
	// キャッシュ済みで progress_callback が発火しない場合でも 100% を保証する
	post({ type: 'progress', kind: 'model', pct: 100 });
	return transcriber;
}

// --- 推論 ---

async function transcribe(
	audio: Float32Array,
	language: 'ja' | 'auto',
): Promise<void> {
	if (!transcriber) {
		throw new Error('モデルが読み込まれていません。');
	}
	// 完全無音をWhisperへ渡すと反復文を生成することがある。小音量や部分的な無音はそのまま渡す。
	if (isSilentAudio(audio)) {
		post({ type: 'done', segments: [] });
		return;
	}

	const startedAt = Date.now();
	const totalChunks = countChunks(audio.length);
	let processedChunks = 0;
	let windowOffsetSec = 0;
	let segmentStart: number | null = null;
	let buffer = '';

	const reportInferProgress = () => {
		post({
			type: 'progress',
			kind: 'infer',
			pct: Math.max(
				0,
				Math.min(100, Math.round((processedChunks / totalChunks) * 100)),
			),
			elapsedMs: Date.now() - startedAt,
			processedChunks,
			totalChunks,
		});
	};

	reportInferProgress();

	// WhisperTextStreamer のタイムスタンプは 30 秒ウィンドウ内の相対時刻のため、
	// ウィンドウ開始位置を足して絶対時刻へ直す（暫定表示用。最終正本は done.segments）。
	const streamer = new WhisperTextStreamer(transcriber.tokenizer, {
		on_chunk_start: (time: number) => {
			segmentStart = windowOffsetSec + time;
			buffer = '';
		},
		callback_function: (text: string) => {
			buffer += text;
		},
		on_chunk_end: (time: number) => {
			if (segmentStart === null) return;
			const start = segmentStart;
			const end = windowOffsetSec + time;
			const text = buffer.trim();
			segmentStart = null;
			buffer = '';
			if (text.length === 0) return;
			const [segment] = normalizeSegments([
				{
					id: Math.round(start * 1000),
					start,
					end,
					text,
				},
			]);
			if (segment) post({ type: 'segment', segment });
		},
		on_finalize: () => {
			processedChunks = Math.min(totalChunks, processedChunks + 1);
			windowOffsetSec += JUMP_S;
			segmentStart = null;
			buffer = '';
			reportInferProgress();
		},
	});

	const output = (await transcriber(audio, {
		chunk_length_s: CHUNK_LENGTH_S,
		stride_length_s: STRIDE_LENGTH_S,
		return_timestamps: true,
		task: 'transcribe',
		...(language === 'auto' ? {} : { language: 'ja' }),
		streamer,
	})) as WhisperOutput;
	const segments = finalizeTranscript(
		output,
		audio.length / TARGET_SAMPLE_RATE,
	);

	post({ type: 'done', segments });
}

// --- メッセージハンドラ ---

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const request = event.data;
	try {
		if (request.type === 'load') {
			await ensurePipeline(request.modelId, request.device);
			post({ type: 'ready', modelId: request.modelId });
			return;
		}
		if (request.type === 'transcribe') {
			await transcribe(request.audio, request.language);
			return;
		}
	} catch (error) {
		post({
			type: 'error',
			code: toErrorCode(error, request.type === 'load' ? 'load' : 'infer'),
			message: toMessage(error),
		});
	}
};
