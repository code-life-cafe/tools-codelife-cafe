// qr-reader.ts — QRコード読み取りツールの純粋ロジック
// デコード自体は Web Worker（zxing-wasm/reader）に隔離し、ここでは
// フォーマット判定・重複検出・永続化（localStorage）・CSV出力のみを担う。
// UI（React）からは Worker の詳細を隠蔽する。

import type {
	WorkerErrorMessage,
	WorkerRequest,
	WorkerResultMessage,
} from '@/workers/qr-reader.worker';

// --- 型定義 ---

export type DecodedSymbol = {
	text: string;
};

export type ScanFormat = 'url' | 'vcard' | 'wifi' | 'text' | 'other';

export type ScanSource = 'camera' | { image: string };

export type ScanResult = {
	id: string;
	rawValue: string;
	format: ScanFormat;
	source: ScanSource;
	scannedAt: string;
	duplicate: boolean;
};

// --- フォーマット判定 ---

/**
 * 制御文字（タブ・改行を除く）や印字不能バイトを高い割合で含む場合は
 * バイナリとみなし 'other' を返す。
 */
function looksBinary(value: string): boolean {
	if (value.length === 0) return false;
	let controlCount = 0;
	for (const ch of value) {
		const code = ch.codePointAt(0) ?? 0;
		const isPrintable =
			code === 0x09 ||
			code === 0x0a ||
			code === 0x0d ||
			(code >= 0x20 && code !== 0x7f);
		if (!isPrintable) controlCount++;
	}
	return controlCount / value.length > 0.1;
}

/**
 * QRコードの生データからコンテンツ種別を判定する。
 * プレフィックス比較は大文字小文字を区別しない。
 */
export function detectFormat(rawValue: string): ScanFormat {
	const trimmed = rawValue;
	const upper = trimmed.toUpperCase();

	if (upper.startsWith('WIFI:')) return 'wifi';
	if (upper.startsWith('BEGIN:VCARD')) return 'vcard';
	if (
		trimmed.toLowerCase().startsWith('http://') ||
		trimmed.toLowerCase().startsWith('https://')
	) {
		return 'url';
	}

	if (looksBinary(trimmed)) return 'other';

	return 'text';
}

/**
 * "開く" ボタンを表示してよいか判定する。
 * format が url かつ プロトコルが http/https の場合のみ true。
 * javascript: / data: / file: 等の危険なスキームは常に false。
 */
export function isOpenableUrl(rawValue: string): boolean {
	if (detectFormat(rawValue) !== 'url') return false;
	try {
		const url = new URL(rawValue);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

// --- 結果リスト操作 ---

export function addResult(
	existing: ScanResult[],
	rawValue: string,
	source: ScanSource,
): ScanResult[] {
	const duplicate = existing.some((r) => r.rawValue === rawValue);
	const result: ScanResult = {
		id: crypto.randomUUID(),
		rawValue,
		format: detectFormat(rawValue),
		source,
		scannedAt: new Date().toISOString(),
		duplicate,
	};
	return [result, ...existing];
}

// --- 永続化（localStorage） ---
//
// 注意（AGENTS.mdの例外・意図的な設計判断）:
// AGENTS.mdの原則は「localStorage/URLに保存してよいのは設定値だけ。入力本文・
// ファイル内容・画像データ・個人情報を保存してはいけない」だが、本ツールの
// 自動保存機能（qr-reader:results）はスキャン結果（Wi-Fiパスワード・vCard等の
// 個人情報を含みうるrawValue）を保存する、この原則に対する唯一かつ明示的な
// 例外である。これはNotion設計書のUC-1（受付・イベント業務での「うっかり
// リロード」によるデータ消失防止）を満たすための必須要件であり、以下の緩和策を
// 実装した上でユーザーが明示的にオプトインする場合のみ有効化される:
//   - 既定でOFF（ONにしない限り一切書き込まない）
//   - 初回ON時に「Wi-Fiパスワード等が端末内に平文保存される」同意ダイアログを表示
//   - ON→OFF切替時は確認の上で保存データを即座に削除
//   - 復元時も自動上書き/自動破棄はせず必ずユーザー確認を挟む
// 詳細はAutosaveToggleコンポーネントとNotion設計書を参照。
const STORAGE_KEY = 'qr-reader:results';
const AUTOSAVE_KEY = 'qr-reader:autosave';
const STORAGE_VERSION = 1;

type StoredEnvelope = {
	version: number;
	savedAt: string;
	results: ScanResult[];
};

function isScanResult(value: unknown): value is ScanResult {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.id === 'string' &&
		typeof v.rawValue === 'string' &&
		typeof v.format === 'string' &&
		typeof v.scannedAt === 'string' &&
		typeof v.duplicate === 'boolean' &&
		(v.source === 'camera' ||
			(typeof v.source === 'object' &&
				v.source !== null &&
				typeof (v.source as { image?: unknown }).image === 'string'))
	);
}

function isValidEnvelope(value: unknown): value is StoredEnvelope {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	if (v.version !== STORAGE_VERSION) return false;
	if (typeof v.savedAt !== 'string') return false;
	if (!Array.isArray(v.results)) return false;
	return v.results.every(isScanResult);
}

/**
 * 結果一覧を versioned envelope 形式で localStorage に保存する。
 * 呼び出し側（UI）が autosave 設定を確認してから呼ぶこと。
 */
export function saveResults(results: ScanResult[]): void {
	const envelope: StoredEnvelope = {
		version: STORAGE_VERSION,
		savedAt: new Date().toISOString(),
		results,
	};
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
	} catch {
		// 容量超過・プライベートモード等は無視（自動保存は best-effort）
	}
}

/**
 * localStorage から結果一覧を読み込む。
 * バージョン不一致や壊れたデータの場合は null を返し、自動復元しない。
 */
export function loadResults(): ScanResult[] | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isValidEnvelope(parsed)) return null;
		return parsed.results;
	} catch {
		return null;
	}
}

export function clearResults(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore
	}
}

export function saveAutosaveSetting(enabled: boolean): void {
	try {
		localStorage.setItem(AUTOSAVE_KEY, enabled ? '1' : '0');
	} catch {
		// ignore
	}
}

export function loadAutosaveSetting(): boolean {
	try {
		return localStorage.getItem(AUTOSAVE_KEY) === '1';
	} catch {
		return false;
	}
}

// --- スキャン成功フィードバック（ビープ音・振動） ---
//
// 完全クライアントサイドの通知API（Web Audio API / Vibration API）のみを使い、
// 新規npm依存は追加しない。失敗してもスキャン機能自体は止めず、静かに無視する。
const BEEP_KEY = 'qr-reader:beep';

export function saveBeepSetting(enabled: boolean): void {
	try {
		localStorage.setItem(BEEP_KEY, enabled ? '1' : '0');
	} catch {
		// ignore
	}
}

export function loadBeepSetting(): boolean {
	try {
		return localStorage.getItem(BEEP_KEY) === '1';
	} catch {
		return false;
	}
}

let audioContext: AudioContext | null = null;

/**
 * ビープ音再生用の AudioContext を明示的なユーザー操作（トグルON等）の
 * タイミングで初期化・resumeする。自動再生ポリシー対策。
 */
export function initBeepAudioContext(): void {
	try {
		if (!audioContext) {
			audioContext = new AudioContext();
		}
		if (audioContext.state === 'suspended') {
			void audioContext.resume();
		}
	} catch {
		// AudioContext 非対応環境等は無視
	}
}

/**
 * 短いビープ音を OscillatorNode で生成して再生する。音声ファイルは使用しない。
 * 再生失敗時（AudioContext未初期化・自動再生制限等）はスキャン機能を止めず無視する。
 */
export function playBeep(): void {
	try {
		if (!audioContext) {
			audioContext = new AudioContext();
		}
		if (audioContext.state === 'suspended') {
			void audioContext.resume();
		}
		const oscillator = audioContext.createOscillator();
		const gain = audioContext.createGain();
		oscillator.type = 'sine';
		oscillator.frequency.value = 880;
		gain.gain.setValueAtTime(0.15, audioContext.currentTime);
		gain.gain.exponentialRampToValueAtTime(
			0.001,
			audioContext.currentTime + 0.12,
		);
		oscillator.connect(gain);
		gain.connect(audioContext.destination);
		oscillator.start();
		oscillator.stop(audioContext.currentTime + 0.12);
	} catch {
		// ignore
	}
}

/**
 * 対応端末のみ短時間振動する。iOS Safari等 navigator.vibrate 非対応環境では
 * 機能検出により何もしない（エラーにしない）。
 */
export function vibrateDevice(): void {
	try {
		if (typeof navigator.vibrate === 'function') {
			navigator.vibrate(50);
		}
	} catch {
		// ignore
	}
}

// --- CSV出力 ---

const FORMAT_LABEL: Record<ScanFormat, string> = {
	url: 'URL',
	vcard: '連絡先(vCard)',
	wifi: 'Wi-Fi',
	text: 'テキスト',
	other: 'その他',
};

/**
 * CSVインジェクション対策: セルの先頭が = + - @ タブ CR LF、または
 * 全角の ＝ ＋ － ＠ の場合は先頭に ' を付与して数式評価を無効化する。
 */
function neutralizeFormulaInjection(value: string): string {
	if (/^[=+\-@\t\r\n＝＋－＠]/.test(value)) {
		return `'${value}`;
	}
	return value;
}

function escapeCsvCell(value: string): string {
	const neutralized = neutralizeFormulaInjection(value);
	if (/[",\n\r]/.test(neutralized)) {
		return `"${neutralized.replace(/"/g, '""')}"`;
	}
	return neutralized;
}

function formatSourceLabel(source: ScanSource): string {
	if (source === 'camera') return 'カメラ';
	return `画像: ${source.image}`;
}

/**
 * 結果一覧から CSV Blob（UTF-8 BOM付き）を生成する。
 * 列: No, 日時, 値, 形式, 取得元, 重複
 */
export function buildCsv(results: ScanResult[]): Blob {
	const header = ['No', '日時', '値', '形式', '取得元', '重複'];
	const rows = results.map((r, index) => [
		String(index + 1),
		r.scannedAt,
		r.rawValue,
		FORMAT_LABEL[r.format],
		formatSourceLabel(r.source),
		r.duplicate ? '重複' : '',
	]);

	const lines = [header, ...rows].map((row) =>
		row.map(escapeCsvCell).join(','),
	);
	const csvBody = lines.join('\r\n');
	const bom = '﻿';

	return new Blob([bom + csvBody], { type: 'text/csv;charset=utf-8' });
}

function formatTimestampForFileName(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * CSV Blob をダウンロードする。既定ファイル名: qr-scan-results_{yyyyMMdd_HHmm}.csv
 */
export function downloadCsv(blob: Blob, fileName?: string): void {
	const name =
		fileName ?? `qr-scan-results_${formatTimestampForFileName(new Date())}.csv`;
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

// --- Worker ラッパー ---

export type { DecodedSymbol as DecodeSymbolResult };

let worker: Worker | null = null;

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(
			new URL('../../workers/qr-reader.worker.ts', import.meta.url),
			{ type: 'module' },
		);
	}
	return worker;
}

export function terminateWorker(): void {
	if (worker) {
		worker.terminate();
		worker = null;
	}
}

/**
 * カメラフレーム（ImageData）を Worker に送信してQRコードをデコードする。
 * 呼び出し側で「同時に1件まで」のバックプレッシャー制御を行うこと。
 */
export function decodeFrame(
	imageData: ImageData,
	maxSymbols = 64,
): Promise<DecodedSymbol[]> {
	return new Promise((resolve, reject) => {
		const w = getWorker();
		const id = crypto.randomUUID();

		const handler = (
			e: MessageEvent<WorkerResultMessage | WorkerErrorMessage>,
		) => {
			const msg = e.data;
			if (msg.id !== id) return;
			w.removeEventListener('message', handler);
			if (msg.type === 'result') {
				resolve(msg.symbols);
			} else {
				reject(new Error(msg.message));
			}
		};

		w.addEventListener('message', handler);
		w.postMessage({
			type: 'decodeFrame',
			id,
			imageData,
			maxSymbols,
		} satisfies WorkerRequest);
	});
}

/**
 * 画像ファイル（Blob）を Worker に送信してQRコードをデコードする。
 */
export function decodeImageFile(
	fileName: string,
	blob: Blob,
	maxSymbols = 64,
): Promise<DecodedSymbol[]> {
	return new Promise((resolve, reject) => {
		const w = getWorker();
		const id = crypto.randomUUID();

		const handler = (
			e: MessageEvent<WorkerResultMessage | WorkerErrorMessage>,
		) => {
			const msg = e.data;
			if (msg.id !== id) return;
			w.removeEventListener('message', handler);
			if (msg.type === 'result') {
				resolve(msg.symbols);
			} else {
				reject(new Error(msg.message));
			}
		};

		w.addEventListener('message', handler);
		w.postMessage({
			type: 'decodeImageFile',
			id,
			fileName,
			blob,
			maxSymbols,
		} satisfies WorkerRequest);
	});
}
