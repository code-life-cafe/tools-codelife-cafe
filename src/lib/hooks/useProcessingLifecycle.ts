// useProcessingLifecycle — バッチ処理系フックが共有するライフサイクル管理プリミティブ
// runIdによる中断検知・キャンセル伝播・リソース（ObjectURL等）解放を一元管理する。
// 状態機械そのもの（createRunTracker / createResourceTracker）は React に依存しない
// 純粋な関数として切り出しており、DOM無しで単体テストできる。

import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';

/** runIdによるラン管理・キャンセル伝播を担う（React非依存） */
export function createRunTracker() {
	let runId = 0;
	let cancelled = false;

	return {
		/** 新しいランを開始し、そのrunIdを返す。キャンセル状態はリセットされる */
		beginRun(): number {
			cancelled = false;
			runId += 1;
			return runId;
		},
		/** runIdが現在のランと一致し、かつキャンセルされていないか */
		isCurrent(id: number): boolean {
			return !cancelled && runId === id;
		},
		/** 進行中のランを中断としてマークする（以降そのランの isCurrent は false になる） */
		cancel(): void {
			cancelled = true;
			runId += 1;
		},
	};
}

/** アイテムが保持するリソース（ObjectURL等）の追跡・一括解放を担う（React非依存） */
export function createResourceTracker<TResource>() {
	let resources: TResource[] = [];

	return {
		/** 追跡対象を差し替える（解放は行わない） */
		track(next: TResource[]): void {
			resources = next;
		},
		/** 現在追跡中の全リソースに対して release を呼ぶ */
		releaseAll(release?: (resource: TResource) => void): void {
			for (const r of resources) release?.(r);
		},
	};
}

export type UseProcessingLifecycleOptions<TResource> = {
	/** 追跡中のリソース（ObjectURL等）を解放する。アンマウント時・releaseAll呼び出し時に呼ばれる */
	release?: (resource: TResource) => void;
};

export type ProcessingLifecycle<TResource> = {
	/** 追跡中リソースの最新値を保持する安定参照 */
	resourcesRef: RefObject<TResource[]>;
	/** 追跡対象を更新する（解放は行わない） */
	track: (resources: TResource[]) => void;
	/** 現在追跡中の全リソースを解放する */
	releaseAll: () => void;
	/** 新しいランを開始し、そのrunIdを返す（キャンセル状態をリセット） */
	beginRun: () => number;
	/** runIdが現在のランと一致し、かつキャンセルされていないか */
	isCurrent: (runId: number) => boolean;
	/** 進行中のランを中断としてマークする */
	cancel: () => void;
};

/**
 * バッチ処理系フック（useBatchProcessing等）から利用する共通プリミティブ。
 * runIdによる中断検知・キャンセル伝播・アンマウント時のリソース解放を提供する。
 */
export function useProcessingLifecycle<TResource>(
	options: UseProcessingLifecycleOptions<TResource> = {},
): ProcessingLifecycle<TResource> {
	const releaseRef = useRef(options.release);
	releaseRef.current = options.release;

	const runTrackerRef = useRef<ReturnType<typeof createRunTracker> | null>(
		null,
	);
	if (!runTrackerRef.current) runTrackerRef.current = createRunTracker();
	const runTracker = runTrackerRef.current;

	const resourceTrackerRef = useRef<ReturnType<
		typeof createResourceTracker<TResource>
	> | null>(null);
	if (!resourceTrackerRef.current) {
		resourceTrackerRef.current = createResourceTracker<TResource>();
	}
	const resourceTracker = resourceTrackerRef.current;

	const resourcesRef = useRef<TResource[]>([]);

	// アンマウント時に追跡中の全リソースを解放する
	useEffect(() => {
		return () => resourceTracker.releaseAll(releaseRef.current);
	}, [resourceTracker]);

	const track = useCallback(
		(next: TResource[]) => {
			resourcesRef.current = next;
			resourceTracker.track(next);
		},
		[resourceTracker],
	);

	const releaseAll = useCallback(
		() => resourceTracker.releaseAll(releaseRef.current),
		[resourceTracker],
	);

	const beginRun = useCallback(() => runTracker.beginRun(), [runTracker]);

	const isCurrent = useCallback(
		(runId: number) => runTracker.isCurrent(runId),
		[runTracker],
	);

	const cancel = useCallback(() => runTracker.cancel(), [runTracker]);

	return useMemo(
		() => ({ resourcesRef, track, releaseAll, beginRun, isCurrent, cancel }),
		[track, releaseAll, beginRun, isCurrent, cancel],
	);
}
