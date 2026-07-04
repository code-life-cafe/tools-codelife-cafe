// useBatchProcessing — 複数ファイル逐次処理の共通フック
// 進捗表示・キャンセル・中断検知（runId）・ObjectURL 等のリソース解放という
// バッチ処理ページ共通の状態機械を一元管理する。
// ランのライフサイクル管理は useProcessingLifecycle に委譲している。
// 使用例: ImageCompressPage / ImageConvertPage（即時開始）、
//         ImageEditPage / ImageMetadataPage / ExifToolPage（選択と処理開始を分離する2段階フロー）

import { useCallback, useRef, useState } from 'react';
import { useProcessingLifecycle } from './useProcessingLifecycle.ts';

/** バッチ処理対象アイテムに最低限必要なフィールド */
export type BatchItemBase = {
	id: string;
	status: 'pending' | 'done' | 'error';
	error?: string;
};

export type BatchProgress = { done: number; total: number };

export type BatchCompletion = { done: number; failed: number; total: number };

/** runBatch が要求するラン管理の最小インターフェース（React非依存） */
export type BatchRunner = {
	beginRun: () => number;
	isCurrent: (runId: number) => boolean;
};

export type BatchRunHandlers<TItem extends BatchItemBase> = {
	onRunStart: (total: number) => void;
	/** 成功したアイテムに適用する差分パッチ */
	onItemSuccess: (item: TItem, patch: Partial<TItem>) => void;
	/** ラン中断後に届いた成功パッチ（アイテムには反映しない。リソース解放のために渡される） */
	onStalePatch: (patch: Partial<TItem>) => void;
	onItemError: (item: TItem, message: string) => void;
	onProgress: (progress: BatchProgress) => void;
	/** ラン継続中に最後まで完了した場合のみ呼ばれる（キャンセル・中断時は呼ばれない） */
	onRunComplete: (completion: BatchCompletion) => void;
};

/** 1アイテムを処理して成功時の差分を返す。失敗時は throw する */
export type BatchItemProcessor<TItem extends BatchItemBase> = (
	item: TItem,
) => Promise<Partial<TItem>>;

/**
 * target を先頭から逐次処理する（React非依存）。
 * runner.isCurrent が false になった時点（キャンセル・新しいランの開始）で中断し、
 * 中断後に届いた成功パッチは onStalePatch でリソース解放できるよう渡す。
 */
export async function runBatch<TItem extends BatchItemBase>(
	runner: BatchRunner,
	target: TItem[],
	processItem: BatchItemProcessor<TItem>,
	handlers: BatchRunHandlers<TItem>,
	fallbackErrorMessage: string,
): Promise<void> {
	const runId = runner.beginRun();
	handlers.onRunStart(target.length);
	let done = 0;
	let failed = 0;

	for (let i = 0; i < target.length; i++) {
		if (!runner.isCurrent(runId)) return;
		const item = target[i];
		try {
			const patch = await processItem(item);
			if (!runner.isCurrent(runId)) {
				// 中断後に届いた結果はアイテムへ反映せず、リソースだけ解放する
				handlers.onStalePatch(patch);
				return;
			}
			handlers.onItemSuccess(item, patch);
			done++;
		} catch (err) {
			handlers.onItemError(
				item,
				err instanceof Error ? err.message : fallbackErrorMessage,
			);
			failed++;
		}
		if (runner.isCurrent(runId)) {
			handlers.onProgress({ done: i + 1, total: target.length });
		}
		// イベントループへ yield して UI フリーズを防ぐ
		await new Promise((resolve) => setTimeout(resolve, 0));
	}

	if (runner.isCurrent(runId)) {
		handlers.onRunComplete({ done, failed, total: target.length });
	}
}

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
		(target: TItem[], processItem: BatchItemProcessor<TItem>) =>
			runBatch(
				lifecycle,
				target,
				processItem,
				{
					onRunStart: (total) => {
						setProcessing(true);
						setCompletion(null);
						setProgress({ done: 0, total });
					},
					onItemSuccess: (item, patch) =>
						updateItem(item.id, { ...patch, status: 'done' } as Partial<TItem>),
					onStalePatch: (patch) => releasePatch?.(patch),
					onItemError: (item, message) =>
						updateItem(item.id, {
							status: 'error',
							error: message,
						} as Partial<TItem>),
					onProgress: setProgress,
					onRunComplete: (result) => {
						setProcessing(false);
						setCompletion(result);
						onRunCompleteRef.current?.(result);
					},
				},
				fallbackErrorMessage,
			),
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

	/**
	 * 前回の items のリソースを解放してから target に差し替えるが、処理は開始しない。
	 * ファイル選択と処理開始のタイミングを分離したい2段階フロー（クロップ調整後に実行 等）で使う。
	 */
	const hold = useCallback(
		(target: TItem[]) => {
			lifecycle.releaseAll();
			setItems(target);
		},
		[lifecycle],
	);

	/** hold() で保持済みの現在の items を対象に処理を開始する */
	const startHeld = useCallback(
		(processItem: BatchItemProcessor<TItem>) =>
			void run(itemsRef.current, processItem),
		[run, itemsRef],
	);

	/**
	 * 既存の items のリソースは解放せず、末尾に追加する。
	 * 複数回に分けて選択を蓄積したい2段階フロー（都度追加・個別削除）で使う。
	 */
	const append = useCallback((next: TItem[]) => {
		setItems((prev) => [...prev, ...next]);
	}, []);

	/** id で指定した1アイテムのみリソースを解放して取り除く */
	const removeItem = useCallback(
		(id: string) => {
			setItems((prev) => {
				const target = prev.find((it) => it.id === id);
				if (target) options.releaseItem?.(target);
				return prev.filter((it) => it.id !== id);
			});
		},
		[options.releaseItem],
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
		hold,
		startHeld,
		append,
		removeItem,
		reprocess,
		cancel,
		clear,
	};
}
