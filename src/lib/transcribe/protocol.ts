// protocol.ts — /transcribe の Worker メッセージ型とエラーコード（純粋な型・定数。DOM 非依存）
//
// 正本: https://app.notion.com/p/396dfd36033681cba834ecd64d6167b3 「詳細設計書 8.」
// この discriminated union が正本であり、UI・Worker の双方が厳密に準拠する。
//
// 重要:
// - デコード（decodeAudioData）はメインスレッドで行う。Worker が送る progress は model / infer のみ。
// - キャンセルの正はメインスレッド側の worker.terminate()。プロトコルに cancel は定義しない。

import type { ModelId } from './model-manifest.ts';
import type { TranscriptSegment } from './segments.ts';

export type { ModelId, TranscriptSegment };

export type TranscribeDevice = 'webgpu' | 'wasm';
export type TranscribeLanguage = 'ja' | 'auto';

export type ErrorCode =
	| 'decode-failed'
	| 'model-load-failed'
	| 'oom'
	| 'unsupported-browser'
	| 'file-too-long'
	| 'memory-risk';

// --- メインスレッド → Worker ---

export type WorkerRequest =
	| {
			type: 'load';
			modelId: ModelId;
			device: TranscribeDevice;
	  }
	| {
			type: 'transcribe';
			audio: Float32Array;
			language: TranscribeLanguage;
	  };

// --- Worker → メインスレッド ---

export type WorkerResponse =
	| {
			type: 'progress';
			kind: 'model';
			pct: number;
	  }
	| {
			type: 'progress';
			kind: 'infer';
			/** 実測できない場合は null（UI は経過時間を表示する） */
			pct: number | null;
			elapsedMs: number;
			processedChunks?: number;
			totalChunks?: number;
	  }
	| {
			type: 'ready';
			modelId: ModelId;
	  }
	| {
			type: 'segment';
			segment: TranscriptSegment;
	  }
	| {
			type: 'done';
			segments: TranscriptSegment[];
	  }
	| {
			type: 'error';
			code: ErrorCode;
			message: string;
	  };

// --- UI の状態機械（正本「詳細設計書 7.」） ---

export type TranscribeState =
	| { phase: 'idle' }
	| {
			phase: 'loading-model';
			modelId: ModelId;
			/** キャッシュ済みモデルは 'cache'。表示の出し分けにのみ使う（Worker プロトコルは不変） */
			source: 'network' | 'cache';
			/** cache の間は null（非決定表示）。network は実測 % を保持する */
			progress: number | null;
	  }
	| { phase: 'decoding' }
	| {
			phase: 'transcribing';
			progress: number | null;
			elapsedMs: number;
			partial: TranscriptSegment[];
	  }
	| { phase: 'done'; segments: TranscriptSegment[]; durationSec: number }
	| { phase: 'error'; code: ErrorCode; message: string };

/** 処理中（キャンセル可能・離脱警告対象）かどうか */
export function isBusy(state: TranscribeState): boolean {
	return (
		state.phase === 'loading-model' ||
		state.phase === 'decoding' ||
		state.phase === 'transcribing'
	);
}

// --- UI 表示用のエラーガイダンス（日本語） ---

export type ErrorGuidance = {
	title: string;
	description: string;
	/** 次に取れる行動 */
	hint: string;
};

export const ERROR_GUIDANCE: Record<ErrorCode, ErrorGuidance> = {
	'decode-failed': {
		title: '音声を読み取れませんでした',
		description:
			'ファイルが破損しているか、このブラウザが対応していない音声コーデックの可能性があります。',
		hint: 'mp3 / wav / m4a に変換してからもう一度お試しください。mp4 の場合は音声トラックが AAC のものが対象です。',
	},
	'model-load-failed': {
		title: 'モデルの読み込みに失敗しました',
		description:
			'モデルファイルの取得、またはキャッシュの読み出しに失敗しました。',
		hint: '通信状況を確認して再試行してください。繰り返し失敗する場合は、別のモデルサイズを選ぶか、しばらく待ってからお試しください。',
	},
	oom: {
		title: 'メモリが不足しました',
		description: '処理中に端末のメモリが足りなくなり、推論を継続できません。',
		hint: '他のタブを閉じるか、より小さいモデル（tiny / base）を選んで再試行してください。',
	},
	'unsupported-browser': {
		title: 'この環境では実行できませんでした',
		description:
			'文字起こしに必要な機能（WebAssembly / Web Worker）が使えないか、推論の実行中にランタイムが処理を継続できませんでした。',
		hint: '最新の Chrome / Edge / Safari / Firefox でお試しください。実行中に発生した場合は、より小さいモデル（tiny / base）に切り替えると回避できることがあります。',
	},
	'file-too-long': {
		title: '音声が長すぎます',
		description:
			'現在のバージョンでは 15 分以内の音声を対象としています（端末のメモリを使い切らないための制限です）。',
		hint: '音声を分割してから、15 分以内のファイルとしてお試しください。',
	},
	'memory-risk': {
		title: 'この端末では処理しきれない見込みです',
		description:
			'音声の長さと選択したモデルから、処理中にメモリが不足すると判断しました。',
		hint: 'より小さいモデル（tiny / base）を選ぶか、音声を短く分割してお試しください。',
	},
};
