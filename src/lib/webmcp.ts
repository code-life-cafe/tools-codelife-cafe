export type WebMcpTool = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execute: (input: unknown) => Promise<unknown> | unknown;
};

type MaybeDisposable =
	| undefined
	| { dispose?: () => void; unregister?: () => void }
	| (() => void);

export function provideTools(tools: WebMcpTool[]): () => void {
	if (typeof window === 'undefined') return () => {};

	// 1. 最新 Chrome Imperative API 仕様 (document.modelContext.registerTool)
	if (
		typeof document !== 'undefined' &&
		document.modelContext &&
		typeof document.modelContext.registerTool === 'function'
	) {
		const docCtx = document.modelContext;
		const controller =
			typeof AbortController !== 'undefined' ? new AbortController() : null;
		const disposables: MaybeDisposable[] = [];

		for (const tool of tools) {
			try {
				const res = docCtx.registerTool(
					tool,
					controller ? { signal: controller.signal } : undefined,
				) as MaybeDisposable;
				if (res) disposables.push(res);
			} catch {
				/* no-op */
			}
		}

		return () => {
			try {
				if (controller) {
					controller.abort();
				}
				for (const d of disposables) {
					if (typeof d === 'function') {
						d();
					} else if (d && typeof d.dispose === 'function') {
						d.dispose();
					} else if (d && typeof d.unregister === 'function') {
						d.unregister();
					}
				}
			} catch {
				/* no-op */
			}
		};
	}

	// 2. 旧ドラフト仕様 (navigator.modelContext.provideContext)
	if (
		typeof navigator !== 'undefined' &&
		navigator.modelContext &&
		typeof navigator.modelContext.provideContext === 'function'
	) {
		const navCtx = navigator.modelContext;
		let disposable: MaybeDisposable;

		try {
			disposable = navCtx.provideContext({ tools }) as MaybeDisposable;
		} catch {
			return () => {};
		}

		return () => {
			try {
				if (typeof disposable === 'function') {
					disposable();
					return;
				}

				if (disposable && typeof disposable.dispose === 'function') {
					disposable.dispose();
					return;
				}

				if (disposable && typeof disposable.unregister === 'function') {
					disposable.unregister();
					return;
				}

				navCtx.clearContext?.();
			} catch {
				/* no-op */
			}
		};
	}

	return () => {};
}
