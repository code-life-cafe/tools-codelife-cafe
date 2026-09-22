// 実行方法: npm run test:unit
// 単体実行: node --test tests/unit/qr-reader.test.ts
//
// zxing-wasm を使った実際のデコード処理（Worker内）はブラウザ専用のため E2E で検証する。
// ここでは純粋関数（フォーマット判定・重複検出・永続化・CSV生成）を対象とする。
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
	addResult,
	buildCsv,
	clearResults,
	detectFormat,
	evaluateCameraDetection,
	isOpenableUrl,
	loadAutosaveSetting,
	loadResults,
	SCAN_REDETECTION_GAP_MS,
	type ScanContinuityState,
	type ScanResult,
	saveAutosaveSetting,
	saveResults,
} from '../../src/lib/tools/qr-reader.ts';

// --- localStorage / crypto の簡易モック（Node環境） ---
class MemoryStorage {
	private store = new Map<string, string>();
	getItem(key: string) {
		return this.store.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.store.set(key, value);
	}
	removeItem(key: string) {
		this.store.delete(key);
	}
	clear() {
		this.store.clear();
	}
}

// biome-ignore lint/suspicious/noExplicitAny: テスト用グローバルモック
(globalThis as any).localStorage = new MemoryStorage();

beforeEach(() => {
	(globalThis.localStorage as unknown as MemoryStorage).clear();
});

// --- detectFormat ---

test('detectFormat: WIFI: プレフィックスを検出する（大文字小文字区別なし）', () => {
	assert.equal(detectFormat('WIFI:T:WPA;S:test;P:pass;;'), 'wifi');
	assert.equal(detectFormat('wifi:T:WPA;S:test;P:pass;;'), 'wifi');
	assert.equal(detectFormat('WiFi:T:WPA;S:test;P:pass;;'), 'wifi');
});

test('detectFormat: BEGIN:VCARD を検出する（大文字小文字区別なし）', () => {
	assert.equal(detectFormat('BEGIN:VCARD\nVERSION:3.0\nEND:VCARD'), 'vcard');
	assert.equal(detectFormat('begin:vcard\nEND:VCARD'), 'vcard');
});

test('detectFormat: http/https URLを検出する（大文字小文字区別なし）', () => {
	assert.equal(detectFormat('https://example.com'), 'url');
	assert.equal(detectFormat('HTTP://example.com'), 'url');
	assert.equal(detectFormat('HTTPS://example.com/path?q=1'), 'url');
});

test('detectFormat: プレーンテキストは text になる', () => {
	assert.equal(detectFormat('こんにちは'), 'text');
	assert.equal(detectFormat('plain text 123'), 'text');
});

test('detectFormat: バイナリらしき文字列は other になる', () => {
	const binary = String.fromCharCode(0, 1, 2, 3, 4, 5, 6, 7, 8, 200, 201, 202);
	assert.equal(detectFormat(binary), 'other');
});

test('detectFormat: javascript: スキームは url と判定されない', () => {
	assert.notEqual(detectFormat('javascript:alert(1)'), 'url');
});

// --- isOpenableUrl ---

test('isOpenableUrl: http/https は開ける', () => {
	assert.equal(isOpenableUrl('https://example.com'), true);
	assert.equal(isOpenableUrl('http://example.com'), true);
});

test('isOpenableUrl: javascript:/data:/file: は開けない', () => {
	assert.equal(isOpenableUrl('javascript:alert(1)'), false);
	assert.equal(
		isOpenableUrl('data:text/html,<script>alert(1)</script>'),
		false,
	);
	assert.equal(isOpenableUrl('file:///etc/passwd'), false);
});

test('isOpenableUrl: URL以外のフォーマットは開けない', () => {
	assert.equal(isOpenableUrl('plain text'), false);
	assert.equal(isOpenableUrl('WIFI:T:WPA;S:a;P:b;;'), false);
});

// --- addResult ---

test('addResult: 新規値は duplicate=false で先頭に追加される', () => {
	const result = addResult([], 'https://example.com', 'camera');
	assert.equal(result.length, 1);
	assert.equal(result[0].duplicate, false);
	assert.equal(result[0].rawValue, 'https://example.com');
	assert.equal(result[0].format, 'url');
});

test('addResult: 既存と同じ値は duplicate=true になる', () => {
	const first = addResult([], 'same-value', 'camera');
	const second = addResult(first, 'same-value', { image: 'a.png' });
	assert.equal(second.length, 2);
	assert.equal(second[0].duplicate, true);
	assert.equal(second[1].duplicate, false);
});

// --- CSV ---

test('buildCsv: UTF-8 BOMを含む', async () => {
	const results: ScanResult[] = [
		{
			id: '1',
			rawValue: 'https://example.com',
			format: 'url',
			source: 'camera',
			scannedAt: '2026-07-03T00:00:00.000Z',
			duplicate: false,
		},
	];
	const blob = buildCsv(results);
	// Blob.text() は TextDecoder の既定動作で BOM を除去してしまうため、
	// 生バイト列（EF BB BF）で検証する。
	const bytes = new Uint8Array(await blob.arrayBuffer());
	assert.equal(bytes[0], 0xef);
	assert.equal(bytes[1], 0xbb);
	assert.equal(bytes[2], 0xbf);
});

test('buildCsv: 列順は No,日時,値,形式,取得元,重複', async () => {
	const results: ScanResult[] = [
		{
			id: '1',
			rawValue: 'hello',
			format: 'text',
			source: 'camera',
			scannedAt: '2026-07-03T00:00:00.000Z',
			duplicate: false,
		},
	];
	const blob = buildCsv(results);
	const text = (await blob.text()).replace(/^﻿/, '');
	const lines = text.split('\r\n');
	assert.equal(lines[0], 'No,日時,値,形式,取得元,重複');
	assert.match(
		lines[1],
		/^1,2026-07-03T00:00:00\.000Z,hello,テキスト,カメラ,$/,
	);
});

test('buildCsv: 重複フラグが CSV に反映される', async () => {
	const results: ScanResult[] = [
		{
			id: '1',
			rawValue: 'dup',
			format: 'text',
			source: 'camera',
			scannedAt: '2026-07-03T00:00:00.000Z',
			duplicate: true,
		},
	];
	const blob = buildCsv(results);
	const text = (await blob.text()).replace(/^﻿/, '');
	assert.match(text, /,重複\r\n1,.*,重複$/);
});

test('buildCsv: 数式インジェクション対策（半角記号）', async () => {
	const values = ['=1+1', '+1', '-1', '@SUM(A1)', '\t=cmd', '\rfoo', '\nfoo'];
	for (const value of values) {
		const results: ScanResult[] = [
			{
				id: '1',
				rawValue: value,
				format: 'text',
				source: 'camera',
				scannedAt: '2026-07-03T00:00:00.000Z',
				duplicate: false,
			},
		];
		const blob = buildCsv(results);
		const text = (await blob.text()).replace(/^﻿/, '');
		const secondLine = text.split('\r\n')[1];
		// セル内容は値カラム（3番目）に ' が先頭付与されているか、引用符で囲まれた上で先頭に付与されている
		assert.ok(
			secondLine.includes(`'${value}`.replace(/[\r\n]/g, '')) ||
				/"'/.test(secondLine),
			`expected neutralized cell for ${JSON.stringify(value)}, got: ${secondLine}`,
		);
	}
});

test('buildCsv: 数式インジェクション対策（全角記号）', async () => {
	const values = ['＝1', '＋1', '－1', '＠SUM'];
	for (const value of values) {
		const results: ScanResult[] = [
			{
				id: '1',
				rawValue: value,
				format: 'text',
				source: 'camera',
				scannedAt: '2026-07-03T00:00:00.000Z',
				duplicate: false,
			},
		];
		const blob = buildCsv(results);
		const text = (await blob.text()).replace(/^﻿/, '');
		const secondLine = text.split('\r\n')[1];
		assert.ok(secondLine.includes(`'${value}`));
	}
});

test('buildCsv: 通常の値は先頭に引用符を付与しない', async () => {
	const results: ScanResult[] = [
		{
			id: '1',
			rawValue: 'https://example.com',
			format: 'url',
			source: 'camera',
			scannedAt: '2026-07-03T00:00:00.000Z',
			duplicate: false,
		},
	];
	const blob = buildCsv(results);
	const text = (await blob.text()).replace(/^﻿/, '');
	const secondLine = text.split('\r\n')[1];
	assert.ok(secondLine.includes(',https://example.com,'));
});

// --- 保存/読み込み（versioned envelope） ---

test('saveResults/loadResults: versioned envelope でラウンドトリップする', () => {
	const results: ScanResult[] = [
		{
			id: '1',
			rawValue: 'a',
			format: 'text',
			source: 'camera',
			scannedAt: '2026-07-03T00:00:00.000Z',
			duplicate: false,
		},
	];
	saveResults(results);
	const loaded = loadResults();
	assert.deepEqual(loaded, results);
});

test('loadResults: バージョン不一致は null（自動復元しない）', () => {
	globalThis.localStorage.setItem(
		'qr-reader:results',
		JSON.stringify({ version: 999, savedAt: 'x', results: [] }),
	);
	assert.equal(loadResults(), null);
});

test('loadResults: 壊れたJSONは null', () => {
	globalThis.localStorage.setItem('qr-reader:results', '{not valid json');
	assert.equal(loadResults(), null);
});

test('loadResults: 未保存時は null', () => {
	assert.equal(loadResults(), null);
});

test('clearResults: 保存データを削除する', () => {
	saveResults([
		{
			id: '1',
			rawValue: 'a',
			format: 'text',
			source: 'camera',
			scannedAt: '2026-07-03T00:00:00.000Z',
			duplicate: false,
		},
	]);
	clearResults();
	assert.equal(loadResults(), null);
});

// --- autosave 設定 ---

test('loadAutosaveSetting: 既定は false', () => {
	assert.equal(loadAutosaveSetting(), false);
});

test('saveAutosaveSetting/loadAutosaveSetting: ラウンドトリップする', () => {
	saveAutosaveSetting(true);
	assert.equal(loadAutosaveSetting(), true);
	saveAutosaveSetting(false);
	assert.equal(loadAutosaveSetting(), false);
});

// --- evaluateCameraDetection（カメラ連続フレームの重複検出） ---
//
// 本番回帰の再現: QR Readerのカメラデコードループは200ms間隔で毎フレーム
// Workerに問い合わせるため、修正前は同一QRを数十秒カメラに映し続けるだけで
// 大量のtool_runが発火していた（3 visitsで587件）。以下は「1回の有効読み取り
// につきイベント数が有界になる」というAcceptance Criteriaを、実際のカメラ/RAF
// ループ抜きで決定的に検証する。

test('evaluateCameraDetection: 初回検出は新規スキャンと判定される', () => {
	const { isNewScan, nextState } = evaluateCameraDetection(null, 'A', 1000);
	assert.equal(isNewScan, true);
	assert.deepEqual(nextState, { value: 'A', lastSeenAt: 1000 });
});

test('evaluateCameraDetection: 同一QRを長時間映し続けても新規スキャンは1回だけ（587件回帰の再現）', () => {
	// 200ms間隔のデコードループを60秒分（300フレーム）シミュレートする。
	let state: ScanContinuityState = null;
	let newScanCount = 0;
	for (let frame = 0; frame < 300; frame++) {
		const now = frame * 200;
		const result = evaluateCameraDetection(
			state,
			'https://tools.codelife.cafe/qr-reader',
			now,
		);
		state = result.nextState;
		if (result.isNewScan) newScanCount++;
	}
	assert.equal(newScanCount, 1);
});

test('evaluateCameraDetection: 猶予時間未満の再検出は新規スキャンとみなさない', () => {
	const first = evaluateCameraDetection(null, 'A', 0);
	const second = evaluateCameraDetection(
		first.nextState,
		'A',
		SCAN_REDETECTION_GAP_MS - 1,
	);
	assert.equal(second.isNewScan, false);
	// 猶予は検出のたびに延長される（最終検出時刻を基準に再計算する）
	assert.deepEqual(second.nextState, {
		value: 'A',
		lastSeenAt: SCAN_REDETECTION_GAP_MS - 1,
	});
});

test('evaluateCameraDetection: 猶予時間以上経過してからの同一QR再出現は新規スキャン扱い（明示的な再スキャン）', () => {
	const first = evaluateCameraDetection(null, 'A', 0);
	const second = evaluateCameraDetection(
		first.nextState,
		'A',
		SCAN_REDETECTION_GAP_MS,
	);
	assert.equal(second.isNewScan, true);
});

test('evaluateCameraDetection: 境界値ちょうど（猶予時間と同値）は新規スキャン扱い', () => {
	const state: ScanContinuityState = { value: 'A', lastSeenAt: 5000 };
	const result = evaluateCameraDetection(
		state,
		'A',
		5000 + SCAN_REDETECTION_GAP_MS,
	);
	assert.equal(result.isNewScan, true);
});

test('evaluateCameraDetection: 異なるQRの連続読み取りはそれぞれ新規スキャンになる', () => {
	let state: ScanContinuityState = null;
	const results: boolean[] = [];
	for (const [value, at] of [
		['A', 0],
		['B', 200],
		['A', 400],
		['C', 600],
	] as const) {
		const result = evaluateCameraDetection(state, value, at);
		state = result.nextState;
		results.push(result.isNewScan);
	}
	assert.deepEqual(results, [true, true, true, true]);
});
