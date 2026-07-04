// useBatchProcessing — 複数ファイル逐次処理の共通フック
// 進捗表示・キャンセル・中断検知（runId）・ObjectURL 等のリソース解放という
// バッチ処理ページ共通の状態機械を一元管理する。
// ランのライフサイクル管理は useProcessingLifecycle に委譲している。
// 使用例: ImageCompressPage / ImageConvertPage

import { useCallback, useRef, useState } from 'react';
import { useProcessingLifecycle } from './useProcessingLifecycle';

/** バッチ処理対象アイテムに最低限必要なフィールド */
export type BatchItemBase = {
	id: string;
	status: 'pending' | 'done' | 'error';
	error?: string;
};

export type BatchProgress = { done: number; total: number };

export type BatchCompletion = { done: number; failed: number; total: number };

export type UseBatchProcessingOptions<TItem extends BatchItemBase> = {
	/** 処理失敗時にアイテムへ設定する既定エラーメッセージ */
	fallbackErrorMessage: string;
	/** アイテムが保持するリソース（ObjectURL 等）を解放する。差し替え・クリア・アンマウント時に呼ばれる */
	releaseItem?: (item: TItem) => void;
	/** 処理成功パッチがラン中断後に届いた場合に、パッチ側のリソースを解放する（例: 生成済み resultUrl の revoke） */
	releasePatch?: (patch: Partial<TItem>) => void;
	/** 1ラン正常完了時に呼ばれる（キャンセル・中断時は呼ばれない）。計測などに使用 */
	onRunComplete?: (completion: BatchCompletion) => void;
};

/** 1アイテムを処理して成功時の差分を返す。失敗時は throw する */
export type BatchItemProcessor<TItem extends BatchItemBase> = (
	item: TItem,
) => Promise<Partial<TItem>>;

export function useBatchProcessing<TItem extends BatchItemBase>(
	options: UseBatchProcessingOptions<TItem>,
) {
	const { fallbackErrorMessage, releasePatch, onRunComplete } = options;

	const [items, setItems] = useState<TItem[]>([]);
	const [processing, setProcessing] = useState(false);
	const [progress, setProgress] = useState<BatchProgress>({
		done: 0,
		total: 0,
	});
	const [completion, setCompletion] = useState<BatchCompletion | null>(null);
	const [error, setError] = useState<string | null>(null);

	// runIdによる中断検知・キャンセル伝播・アンマウント時のリソース解放
	const lifecycle = useProcessingLifecycle<TItem>({
		release: options.releaseItem,
	});
	lifecycle.track(items);
	const { resourcesRef: itemsRef } = lifecycle;

	// onRunComplete から安定参照するための ref
	const onRunCompleteRef = useRef(onRunComplete);
	onRunCompleteRef.current = onRunComplete;

	const updateItem = useCallback((id: string, patch: Partial<TItem>) => {
		setItems((prev) =>
			prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
		);
	}, []);

	/** target を先頭から逐次処理する（キャンセル・差し替えで中断） */
	const run = useCallback(
		async (target: TItem[], processItem: BatchItemProcessor<TItem>) => {
			const runId = lifecycle.beginRun();
			setProcessing(true);
			setCompletion(null);
			setProgress({ done: 0, total: target.length });
			let done = 0;
			let failed = 0;

			for (let i = 0; i < target.length; i++) {
				if (!lifecycle.isCurrent(runId)) break;
				const item = target[i];
				try {
					const patch = await processItem(item);
					if (!lifecycle.isCurrent(runId)) {
						// 中断後に届いた結果はアイテムへ反映せず、リソースだけ解放する
						releasePatch?.(patch);
						break;
					}
					updateItem(item.id, { ...patch, status: 'done' } as Partial<TItem>);
					done++;
				} catch (err) {
					updateItem(item.id, {
						status: 'error',
						error: err instanceof Error ? err.message : fallbackErrorMessage,
					} as Partial<TItem>);
					failed++;
				}
				if (lifecycle.isCurrent(runId)) {
					setProgress({ done: i + 1, total: target.length });
				}
				// イベントループへ yield して UI フリーズを防ぐ
				await new Promise((resolve) => setTimeout(resolve, 0));
			}

			if (lifecycle.isCurrent(runId)) {
				setProcessing(false);
				const result = { done, failed, total: target.length };
				setCompletion(result);
				onRunCompleteRef.current?.(result);
			}
		},
		[fallbackErrorMessage, releasePatch, updateItem, lifecycle],
	);

	/** 前回の items のリソースを解放してから target に差し替え、処理を開始する */
	const start = useCallback(
		(target: TItem[], processItem: BatchItemProcessor<TItem>) => {
			lifecycle.releaseAll();
			setItems(target);
			void run(target, processItem);
		},
		[run, lifecycle],
	);

	/** 現在の items を resetItem で初期化し直して再処理する（再圧縮・再変換） */
	const reprocess = useCallback(
		(
			resetItem: (item: TItem) => TItem,
			processItem: BatchItemProcessor<TItem>,
		) => {
			const reset = itemsRef.current.map(resetItem);
			setItems(reset);
			void run(reset, processItem);
		},
		[run, itemsRef],
	);

	/** 進行中の処理を中断する（items は保持） */
	const cancel = useCallback(() => {
		lifecycle.cancel();
		setProcessing(false);
		setCompletion(null);
	}, [lifecycle]);

	/** 全アイテムを破棄して初期状態に戻す */
	const clear = useCallback(() => {
		lifecycle.cancel();
		lifecycle.releaseAll();
		setItems([]);
		setError(null);
		setProcessing(false);
		setCompletion(null);
	}, [lifecycle]);

	/** 完了メッセージのみ消す（オプション変更時など） */
	const clearCompletion = useCallback(() => {
		setCompletion(null);
	}, []);

	return {
		items,
		itemsRef,
		updateItem,
		processing,
		progress,
		completion,
		error,
		setError,
		clearCompletion,
		start,
		reprocess,
		cancel,
		clear,
	};
}
