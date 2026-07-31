// useCopyFeedback — コピー成否フィードバック表示の共通フック
// CopyButton や各ツールの「設定を共有」「結果コピー」ボタンで重複していた
// copied/failed の2状態 + リセット用 setTimeout をここへ統合する。
// タイマー管理（scheduleReset/cancelReset）は React に依存しない純粋関数として切り出しており、
// useToolAnalytics の trackRunDebounced と同様に DOM無しで単体テストできる。

import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from './clipboard.ts';

export type CopyFeedbackState = 'idle' | 'copied' | 'failed';

/** リセットタイマーの保持先（React非依存・単体テスト対象） */
export type ResetHandle = { current: ReturnType<typeof setTimeout> | null };

/**
 * handle に保留中のタイマーがあれば解除してから、delayMs 後に fn を1回だけ実行するよう
 * 再スケジュールする。連打時に古いタイマーが新しい表示を早期に消してしまわないよう、
 * 呼び出しごとに必ず前回のタイマーを解除してから積み直す。
 */
export function scheduleReset(
	handle: ResetHandle,
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
export function cancelReset(handle: ResetHandle): void {
	if (handle.current !== null) {
		clearTimeout(handle.current);
		handle.current = null;
	}
}

/**
 * copyText を呼び出し、成否を copied/failed として resetMs 後に idle へ戻る一時表示で保持する。
 * アンマウント時にはリセットタイマーを解除する。
 */
export function useCopyFeedback(resetMs = 2000) {
	const [state, setState] = useState<CopyFeedbackState>('idle');
	const handleRef = useRef<ResetHandle>({ current: null });

	useEffect(() => {
		const handle = handleRef.current;
		return () => cancelReset(handle);
	}, []);

	const copy = useCallback(
		async (text: string) => {
			const ok = await copyText(text);
			setState(ok ? 'copied' : 'failed');
			scheduleReset(handleRef.current, () => setState('idle'), resetMs);
			return ok;
		},
		[resetMs],
	);

	return { state, copy } as const;
}
