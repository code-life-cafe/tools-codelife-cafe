// async.ts — 非同期処理の小さな共通ヘルパー。

/** 重い同期処理の合間にイベントループへ制御を返し、UIの更新や中断操作を通す */
export function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}
