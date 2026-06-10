// useHistoryState — undo/redo 付き状態管理フック
// past / present / future を単一 state で保持し、不整合を防ぐ

import { useCallback, useState } from 'react';

type History<T> = {
	past: T[];
	present: T;
	future: T[];
	/**
	 * transient 編集（スライダードラッグ等）開始時点の present。
	 * commit 時はこの値を past に積むことで、undo がドラッグ前の状態に戻る。
	 * null = transient 編集中ではない
	 */
	transientBase: T | null;
};

export type HistoryState<T> = {
	state: T;
	/** 履歴に積んで更新する（通常の確定操作） */
	set: (next: T) => void;
	/** 履歴に積まずに present のみ置換する（スライダードラッグ中など） */
	setTransient: (next: T) => void;
	undo: () => void;
	redo: () => void;
	/** 履歴ごと初期化する */
	reset: (next: T) => void;
	canUndo: boolean;
	canRedo: boolean;
};

export function useHistoryState<T>(initial: T, limit = 50): HistoryState<T> {
	const [history, setHistory] = useState<History<T>>({
		past: [],
		present: initial,
		future: [],
		transientBase: null,
	});

	const set = useCallback(
		(next: T) => {
			setHistory((h) => {
				// transient 編集中なら、その開始時点の状態を履歴に積む
				const past = [...h.past, h.transientBase ?? h.present];
				return {
					past: past.length > limit ? past.slice(past.length - limit) : past,
					present: next,
					future: [],
					transientBase: null,
				};
			});
		},
		[limit],
	);

	const setTransient = useCallback((next: T) => {
		setHistory((h) => ({
			...h,
			present: next,
			transientBase: h.transientBase ?? h.present,
		}));
	}, []);

	const undo = useCallback(() => {
		setHistory((h) => {
			if (h.past.length === 0) return h;
			return {
				past: h.past.slice(0, -1),
				present: h.past[h.past.length - 1],
				future: [h.present, ...h.future],
				transientBase: null,
			};
		});
	}, []);

	const redo = useCallback(() => {
		setHistory((h) => {
			if (h.future.length === 0) return h;
			return {
				past: [...h.past, h.present],
				present: h.future[0],
				future: h.future.slice(1),
				transientBase: null,
			};
		});
	}, []);

	const reset = useCallback((next: T) => {
		setHistory({ past: [], present: next, future: [], transientBase: null });
	}, []);

	return {
		state: history.present,
		set,
		setTransient,
		undo,
		redo,
		reset,
		canUndo: history.past.length > 0,
		canRedo: history.future.length > 0,
	};
}
