// 初期化・推論・モデル切替を同じFIFOで直列化する。
// 解放に失敗した旧sessionは保持し、新しいsessionとの重複確保を防ぐ。
export function createPipelineLifecycle<
	M,
	P extends { dispose(): Promise<unknown> },
>(load: (mode: M, id: string) => Promise<P>) {
	let current: { mode: M; pipeline: P; retiring: boolean } | null = null;
	let tail: Promise<void> = Promise.resolve();
	return {
		run<T>(
			mode: M,
			id: string,
			operation: (pipeline: P) => Promise<T>,
		): Promise<T> {
			const task = tail.then(async () => {
				if (current && (current.mode !== mode || current.retiring)) {
					current.retiring = true;
					await current.pipeline.dispose();
					current = null;
				}
				if (!current)
					current = { mode, pipeline: await load(mode, id), retiring: false };
				return operation(current.pipeline);
			});
			// 失敗した1件が後続の要求を止めない。
			tail = task.then(
				() => {},
				() => {},
			);
			return task;
		},
	};
}
