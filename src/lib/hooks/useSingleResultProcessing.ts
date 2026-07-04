// useSingleResultProcessing — 「N入力→単一（一括）出力」パターンの共通フック
// 進捗表示・キャンセル・中断検知（runId）・結果リソース（ObjectURL等）の解放という
// 単一結果系ページ（PdfMergePage / PdfSplitPage / ImageMergePage 等）共通の
// 状態機械を一元管理する。ランのライフサイクル管理は useProcessingLifecycle に委譲している。

import { useCallback, useState } from 'react';
import { useProcessingLifecycle } from './useProcessingLifecycle.ts';

export type SingleResultProgress = { done: number; total: number };

/** runSingleResult が要求するラン管理の最小インターフェース（React非依存） */
export type SingleResultRunner = {
	beginRun: () => number;
	isCurrent: (runId: number) => boolean;
};

export type SingleResultProcessor<TResult> = (
	onProgress: (done: number, total: number) => void,
) => Promise<TResult>;

export type SingleResultHandlers<TResult> = {
	onProgress: (progress: SingleResultProgress) => void;
	/** ラン継続中に完了した場合のみ呼ばれる */
	onSuccess: (result: TResult) => void;
	/** 中断後（cancel／新しいランの開始）に処理が完了した場合、結果を解放するために呼ばれる */
	onStaleResult: (result: TResult) => void;
	/** ラン継続中に失敗した場合のみ呼ばれる */
	onError: (message: string) => void;
	/** ラン継続中に成功・失敗いずれかで完了した場合に呼ばれる（中断時は呼ばれない） */
	onSettled: () => void;
};

/**
 * 1ランの進捗コールバック中継・中断検知・中断後に届いた結果の解放を担う（React非依存）。
 * processor は onProgress を呼びながら処理を行い、完了時に単一の結果を返す。
 */
export async function runSingleResult<TResult>(
	runner: SingleResultRunner,
	processor: SingleResultProcessor<TResult>,
	handlers: SingleResultHandlers<TResult>,
	fallbackErrorMessage: string,
): Promise<void> {
	const runId = runner.beginRun();
	try {
		const result = await processor((done, total) => {
			if (runner.isCurrent(runId)) handlers.onProgress({ done, total });
		});
		if (!runner.isCurrent(runId)) {
			handlers.onStaleResult(result);
			return;
		}
		handlers.onSuccess(result);
	} catch (err) {
		if (!runner.isCurrent(runId)) return;
		handlers.onError(err instanceof Error ? err.message : fallbackErrorMessage);
	} finally {
		if (runner.isCurrent(runId)) handlers.onSettled();
	}
}

export type UseSingleResultProcessingOptions<TResult> = {
	/** 処理失敗時に設定する既定エラーメッセージ */
	fallbackErrorMessage: string;
	/** 結果が保持するリソース（ObjectURL等）を解放する。差し替え・クリア・アンマウント・中断時に呼ばれる */
	releaseResult?: (result: TResult) => void;
	/** 1ラン正常完了時に呼ばれる（キャンセル・中断時は呼ばれない） */
	onRunComplete?: () => void;
};

export function useSingleResultProcessing<TResult>(
	options: UseSingleResultProcessingOptions<TResult>,
) {
	const { fallbackErrorMessage, releaseResult, onRunComplete } = options;

	const [processing, setProcessing] = useState(false);
	const [progress, setProgress] = useState<SingleResultProgress>({
		done: 0,
		total: 0,
	});
	const [result, setResult] = useState<TResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	// runIdによる中断検知・キャンセル伝播・アンマウント時のリソース解放
	const lifecycle = useProcessingLifecycle<TResult>({ release: releaseResult });

	/** total を初期進捗として、processor を1ラン実行する */
	const run = useCallback(
		(total: number, processor: SingleResultProcessor<TResult>) => {
			lifecycle.releaseAll();
			lifecycle.track([]);
			setError(null);
			setResult(null);
			setProcessing(true);
			setProgress({ done: 0, total });

			return runSingleResult(
				lifecycle,
				processor,
				{
					onProgress: setProgress,
					onSuccess: (res) => {
						lifecycle.track([res]);
						setResult(res);
						onRunComplete?.();
					},
					onStaleResult: (res) => releaseResult?.(res),
					onError: setError,
					onSettled: () => setProcessing(false),
				},
				fallbackErrorMessage,
			);
		},
		[lifecycle, fallbackErrorMessage, releaseResult, onRunComplete],
	);

	/** 進行中の処理を中断する */
	const cancel = useCallback(() => {
		lifecycle.cancel();
		setProcessing(false);
	}, [lifecycle]);

	/** 表示中の結果を解放して非表示にする（トラッカーにも反映するため、次ランや unmount 時に二重解放しない） */
	const clearResult = useCallback(() => {
		lifecycle.releaseAll();
		lifecycle.track([]);
		setResult(null);
	}, [lifecycle]);

	/** 結果・エラーを破棄して初期状態に戻す */
	const clear = useCallback(() => {
		lifecycle.cancel();
		clearResult();
		setError(null);
		setProcessing(false);
		setProgress({ done: 0, total: 0 });
	}, [lifecycle, clearResult]);

	return {
		processing,
		progress,
		result,
		clearResult,
		error,
		setError,
		run,
		cancel,
		clear,
	};
}
