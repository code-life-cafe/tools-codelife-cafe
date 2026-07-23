import type { Page } from '@playwright/test';

/**
 * 本物の推論 Worker を差し替えるモック。
 * src/lib/transcribe/client.ts の `window.__TRANSCRIBE_WORKER_FACTORY__` フックを使う。
 * `window.__TRANSCRIBE_MOCK_MODE__` で挙動を切り替える。
 *
 * 実 Whisper モデルのロード・推論は CI へ持ち込まない（正本「詳細設計書 10-A」）。
 */
export const MOCK_WORKER = `
window.__TRANSCRIBE_MOCK_MODE__ = window.__TRANSCRIBE_MOCK_MODE__ || 'ok';
window.__TRANSCRIBE_MOCK_TERMINATED__ = 0;
window.__TRANSCRIBE_MOCK_LOAD_ATTEMPTS__ = 0;
window.__TRANSCRIBE_WORKER_FACTORY__ = () => {
	const listeners = { message: [], error: [] };
	let alive = true;
	const emit = (data) => {
		if (!alive) return;
		for (const fn of listeners.message) fn({ data });
	};
	const later = (ms, fn) => setTimeout(() => { if (alive) fn(); }, ms);
	return {
		addEventListener(type, fn) { (listeners[type] || []).push(fn); },
		removeEventListener(type, fn) {
			const list = listeners[type] || [];
			const i = list.indexOf(fn);
			if (i >= 0) list.splice(i, 1);
		},
		terminate() { alive = false; window.__TRANSCRIBE_MOCK_TERMINATED__++; },
		postMessage(request) {
			const mode = window.__TRANSCRIBE_MOCK_MODE__;
			if (request.type === 'load') {
				if (mode === 'stall') return;
				if (mode === 'load-error') {
					later(30, () => emit({ type: 'error', code: 'model-load-failed', message: 'mock load failure' }));
					return;
				}
				if (mode === 'load-error-once') {
					// 1回目だけ失敗させ、2回目以降は応答しない（stall）。
					// evictModelCache 後の再取得が確実に "loading-model" のまま観測できるよう、
					// タイマー競合を避けてテストを決定的にするためのモード。
					window.__TRANSCRIBE_MOCK_LOAD_ATTEMPTS__++;
					if (window.__TRANSCRIBE_MOCK_LOAD_ATTEMPTS__ === 1) {
						later(30, () => emit({ type: 'error', code: 'model-load-failed', message: 'mock load failure' }));
					}
					return;
				}
				later(20, () => emit({ type: 'progress', kind: 'model', pct: 40 }));
				later(40, () => emit({ type: 'progress', kind: 'model', pct: 100 }));
				later(60, () => emit({ type: 'ready', modelId: request.modelId }));
				return;
			}
			if (request.type === 'transcribe') {
				if (mode === 'infer-error') {
					later(30, () => emit({ type: 'error', code: 'oom', message: 'mock oom' }));
					return;
				}
				later(20, () => emit({ type: 'progress', kind: 'infer', pct: 0, elapsedMs: 0, processedChunks: 0, totalChunks: 2 }));
				later(40, () => emit({ type: 'segment', segment: { id: 1, start: 0, end: 1.5, text: 'こんにちは' } }));
				later(60, () => emit({ type: 'progress', kind: 'infer', pct: 50, elapsedMs: 500, processedChunks: 1, totalChunks: 2 }));
				later(90, () => emit({
					type: 'done',
					segments: [
						{ id: 1, start: 0, end: 1.5, text: 'こんにちは' },
						{ id: 2, start: 1.5, end: 3, text: 'テストです' },
					],
				}));
			}
		},
	};
};
`;

/**
 * ブラウザ側のリソース解放を数えるための計測。
 * audio-browser.ts が作る Object URL と AudioContext が、
 * 成功・失敗のどちらの経路でも解放されることを検証する。
 */
export const RESOURCE_PROBE = `
window.__probe = { urlCreated: 0, urlRevoked: 0, ctxCreated: 0, ctxClosed: 0 };
const _create = URL.createObjectURL.bind(URL);
const _revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => { window.__probe.urlCreated++; return _create(blob); };
URL.revokeObjectURL = (url) => { window.__probe.urlRevoked++; return _revoke(url); };
const _AudioContext = window.AudioContext;
if (_AudioContext) {
	class CountingAudioContext extends _AudioContext {
		constructor(options) {
			super(options);
			window.__probe.ctxCreated++;
		}
		close() {
			window.__probe.ctxClosed++;
			return super.close();
		}
	}
	window.AudioContext = CountingAudioContext;
}
`;

/** `<audio>` の duration を常に Infinity にして、デコード前判定を取得不能にする */
export const FORCE_INFINITE_DURATION = `
Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
	configurable: true,
	get() { return Infinity; },
});
`;

/**
 * `<audio>.src` への実際の代入を ms 遅らせ、loadedmetadata の発火を遅延させる。
 * ファイル選択直後の「ファイル名が先に表示される」「確認中は開始ボタンが無効」を
 * 観測するためのテスト用ヘルパー。`readDurationSec` の cleanup（removeAttribute/load）は
 * このsetterを経由しないため、abortやキャンセル経路には影響しない。
 */
export function delayAudioSrc(ms: number): string {
	return `
(() => {
	const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
	Object.defineProperty(HTMLMediaElement.prototype, 'src', {
		configurable: true,
		get() { return desc.get.call(this); },
		set(value) {
			setTimeout(() => desc.set.call(this, value), ${ms});
		},
	});
})();
`;
}

/**
 * `delayAudioSrc` の「1回目の代入だけ」を遅らせる版。
 * 2ファイル目以降は即座に反映されるため、
 * 「1ファイル目の解析中に2ファイル目を選び直す」競合を安定して再現できる。
 */
export function delayFirstAudioSrc(ms: number): string {
	return `
(() => {
	const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
	let used = false;
	Object.defineProperty(HTMLMediaElement.prototype, 'src', {
		configurable: true,
		get() { return desc.get.call(this); },
		set(value) {
			if (!used) {
				used = true;
				setTimeout(() => desc.set.call(this, value), ${ms});
			} else {
				desc.set.call(this, value);
			}
		},
	});
})();
`;
}

export type MockMode =
	| 'ok'
	| 'stall'
	| 'load-error'
	| 'load-error-once'
	| 'infer-error';

export async function installMock(
	page: Page,
	mode: MockMode = 'ok',
	extraInitScripts: readonly string[] = [],
): Promise<void> {
	await page.addInitScript(
		`window.__TRANSCRIBE_MOCK_MODE__ = ${JSON.stringify(mode)};`,
	);
	await page.addInitScript(MOCK_WORKER);
	for (const script of extraInitScripts) {
		await page.addInitScript(script);
	}
}
