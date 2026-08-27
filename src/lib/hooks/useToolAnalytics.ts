import { useCallback, useEffect, useRef } from 'react';
import { generateDedupeKey, type ToolRunSource, track } from '../analytics.ts';

// 「初回操作」とみなすユーザー操作イベント。
// マウント（＝擬似PV）ではなく、実際にツールへ触れた最初の操作で tool_engage を発火させる。
const ENGAGE_EVENTS = ['pointerdown', 'keydown'] as const;

// 入力依存の再計算（useEffect の deps に生の入力を含む場合）で trackRun を呼ぶツール向けの
// デバウンス時間。「入力停止後1回だけ」発火させ、ツール間で tool_run を比較可能にする。
export const DEBOUNCE_MS = 500;

/** trackRunDebounced が使う保留中タイマーの保持先（React 非依存・単体テスト対象） */
export type DebounceHandle = { current: ReturnType<typeof setTimeout> | null };

/**
 * handle に保留中のタイマーがあれば解除してから、delayMs 後に fn を1回だけ実行するよう
 * 再スケジュールする（一般的なデバウンス実装）。React に依存しないため node:test の
 * mock.timers で直接検証できる。
 */
export function scheduleDebounced(
	handle: DebounceHandle,
	fn: () => void,
	delayMs: number,
): void {
	if (handle.current !== null) {
		clearTimeout(handle.current);
	}
	handle.current = setTimeout(() => {
		handle.current = null;
		fn();
	}, delayMs);
}

/** handle に保留中のタイマーがあれば解除する（アンマウント時のクリーンアップ用） */
export function cancelDebounced(handle: DebounceHandle): void {
	if (handle.current !== null) {
		clearTimeout(handle.current);
		handle.current = null;
	}
}

export function useToolAnalytics(toolSlug: string) {
	const hasEngagedRef = useRef(false);

	// tool_engage は「個別ツールで初めて入力・操作があった時」に発火する（docs/analytics.md 準拠）。
	// マウント時の無条件発火はやめ、最初のポインタ/キー操作を捕捉して 1 回だけ送信する。
	useEffect(() => {
		if (!toolSlug || hasEngagedRef.current) return;

		const handleFirstInteraction = () => {
			if (hasEngagedRef.current) return;
			hasEngagedRef.current = true;
			track('tool_engage', { tool: toolSlug });
			for (const eventName of ENGAGE_EVENTS) {
				document.removeEventListener(eventName, handleFirstInteraction, true);
			}
		};

		for (const eventName of ENGAGE_EVENTS) {
			document.addEventListener(eventName, handleFirstInteraction, true);
		}

		return () => {
			for (const eventName of ENGAGE_EVENTS) {
				document.removeEventListener(eventName, handleFirstInteraction, true);
			}
		};
	}, [toolSlug]);

	// source省略時は明確な1アクション（ボタン押下等）の呼び出しが大半のため 'button' を既定値とする。
	const trackRun = useCallback(
		(source: ToolRunSource = 'button') => {
			if (!toolSlug) return;
			// 実行は明確なエンゲージメントなので、初回操作を捕捉できていなくても保険として engage を確定させる。
			if (!hasEngagedRef.current) {
				hasEngagedRef.current = true;
				track('tool_engage', { tool: toolSlug });
			}
			// dedupeKeyは呼び出し（＝1ユーザー操作）ごとに1つ発行する使い捨てUUID。
			track('tool_run', {
				tool: toolSlug,
				source,
				dedupeKey: generateDedupeKey(),
			});
		},
		[toolSlug],
	);

	// 入力依存の useEffect から呼ぶための trackRun。DEBOUNCE_MS 内の連続呼び出しは
	// 最後の1回にまとめられる（＝「入力停止後に1回だけ」発火する）。確定発火ごとに
	// source='debounced-input' として1つのdedupeKeyを発行する。
	const debounceHandleRef = useRef<DebounceHandle>({ current: null });

	const trackRunDebounced = useCallback(() => {
		if (!toolSlug) return;
		scheduleDebounced(
			debounceHandleRef.current,
			() => trackRun('debounced-input'),
			DEBOUNCE_MS,
		);
	}, [toolSlug, trackRun]);

	useEffect(() => {
		const handle = debounceHandleRef.current;
		return () => {
			cancelDebounced(handle);
		};
	}, []);

	const trackSharedUrlOpen = useCallback(() => {
		if (!toolSlug) return;
		track('shared_url_open', { tool: toolSlug });
	}, [toolSlug]);

	const trackSettingsRestore = useCallback(
		(source: 'localStorage' | 'url') => {
			if (!toolSlug) return;
			track('settings_restore', { tool: toolSlug, source });
		},
		[toolSlug],
	);

	return {
		trackRun,
		trackRunDebounced,
		trackSharedUrlOpen,
		trackSettingsRestore,
	};
}
