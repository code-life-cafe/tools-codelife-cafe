// audio-browser.ts — ブラウザ依存の音声入力処理（検証・duration 取得・デコード）
//
// - duration は decodeAudioData の**前**に <audio> の loadedmetadata で取得し、
//   15分超をデコード前に検知する（デコード後の発覚を防ぐ）。
// - duration が Infinity / 取得不可の場合はデコードへ進み、AudioBuffer の長さで再判定する。
// - 純粋ロジック（ダウンミックス・リサンプル・長さ判定）は audio-core.ts。
//
// ブラウザ API 依存のため Node のユニットテスト対象外。Playwright のブラウザテストで検証する。

import { TARGET_SAMPLE_RATE, toMono16k } from './audio-core.ts';
import type { ErrorCode } from './protocol.ts';

/** 対応拡張子（input の accept 属性にも使う） */
export const SUPPORTED_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.mp4'] as const;

export const ACCEPT_ATTRIBUTE = SUPPORTED_EXTENSIONS.join(',');

/**
 * 入力ファイルサイズの上限。
 * 15分の 48kHz ステレオ WAV が約 165MB、一般的な mp4 でも十分収まる。
 * これを超えるファイルは ArrayBuffer 化の時点でメモリを圧迫するため受け付けない。
 */
export const MAX_FILE_SIZE = 300 * 1024 * 1024;

/** <audio> のメタデータ取得を待つ上限。超えたらデコード後判定へ委ねる */
const METADATA_TIMEOUT_MS = 15_000;

export type AudioFileValidation =
	| { ok: true }
	| { ok: false; code: ErrorCode; message: string };

export function validateAudioFile(file: {
	name: string;
	size: number;
}): AudioFileValidation {
	const lower = file.name.toLowerCase();
	if (!SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
		return {
			ok: false,
			code: 'decode-failed',
			message: `対応していないファイル形式です。${SUPPORTED_EXTENSIONS.join(' / ')} のいずれかを選んでください。`,
		};
	}
	if (file.size > MAX_FILE_SIZE) {
		return {
			ok: false,
			code: 'memory-risk',
			message: `ファイルサイズが上限（${Math.round(MAX_FILE_SIZE / 1024 ** 2)}MB）を超えています。`,
		};
	}
	return { ok: true };
}

/**
 * デコード前に音声の長さ（秒）を取得する。
 * 取得できない・ストリーミング扱いで Infinity になる場合は NaN を返し、
 * 呼び出し側はデコード後の AudioBuffer 長で再判定する。
 *
 * `signal` を渡すと、呼び出し側がファイル変更・クリア・アンマウント時に
 * 即座にキャンセルできる（成功・エラー・タイムアウト・abort の全経路で
 * タイマー・イベントリスナー・Object URL・audio.src を解放する）。
 */
export function readDurationSec(
	file: Blob,
	signal?: AbortSignal,
): Promise<number> {
	return new Promise((resolve) => {
		if (typeof document === 'undefined' || signal?.aborted) {
			resolve(Number.NaN);
			return;
		}
		const url = URL.createObjectURL(file);
		const audio = document.createElement('audio');
		audio.preload = 'metadata';

		let settled = false;
		const onLoaded = () => finish(audio.duration);
		const onError = () => finish(Number.NaN);
		const onAbort = () => finish(Number.NaN);
		const finish = (value: number) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			audio.removeEventListener('loadedmetadata', onLoaded);
			audio.removeEventListener('error', onError);
			signal?.removeEventListener('abort', onAbort);
			audio.removeAttribute('src');
			audio.load();
			URL.revokeObjectURL(url);
			resolve(Number.isFinite(value) && value > 0 ? value : Number.NaN);
		};

		const timer = setTimeout(() => finish(Number.NaN), METADATA_TIMEOUT_MS);
		audio.addEventListener('loadedmetadata', onLoaded, { once: true });
		audio.addEventListener('error', onError, { once: true });
		signal?.addEventListener('abort', onAbort, { once: true });
		audio.src = url;
	});
}

export type DecodedAudio = {
	/** Whisper 入力（16kHz モノラル） */
	audio: Float32Array;
	durationSec: number;
	/** デコードに使われたサンプルレート（メモリ見積もりの実測値） */
	sampleRate: number;
	channels: number;
};

type AudioContextCtor = new (options?: { sampleRate?: number }) => AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
	if (typeof window === 'undefined') return null;
	const w = window as unknown as {
		AudioContext?: AudioContextCtor;
		webkitAudioContext?: AudioContextCtor;
	};
	return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * 音声/動画ファイルをデコードし、16kHz モノラルの Float32 PCM を返す。
 * 可能なら AudioContext を 16kHz で作り、ブラウザ側でリサンプルさせてメモリを節約する
 * （非対応環境では既定レートでデコードし、audio-core の線形補間でリサンプルする）。
 */
export async function decodeAudioFile(file: Blob): Promise<DecodedAudio> {
	const Ctor = getAudioContextCtor();
	if (!Ctor) {
		throw new Error('この環境では音声のデコードに対応していません。');
	}

	let context: AudioContext;
	try {
		context = new Ctor({ sampleRate: TARGET_SAMPLE_RATE });
	} catch {
		context = new Ctor();
	}

	try {
		const buffer = await file.arrayBuffer();
		const decoded = await context.decodeAudioData(buffer);
		const channels: Float32Array[] = [];
		for (let i = 0; i < decoded.numberOfChannels; i++) {
			channels.push(decoded.getChannelData(i));
		}
		return {
			audio: toMono16k(channels, decoded.sampleRate),
			durationSec: decoded.duration,
			sampleRate: decoded.sampleRate,
			channels: decoded.numberOfChannels,
		};
	} finally {
		await context.close().catch(() => undefined);
	}
}
