import type { WebMcpToolDefinition } from './webmcp/tool-factory.ts';

export type WebMcpTool = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execute: (input: unknown) => Promise<unknown> | unknown;
	annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
};

type MaybeDisposable =
	| undefined
	| { dispose?: () => void; unregister?: () => void }
	| (() => void);

function wrapToolForClient(tool: WebMcpToolDefinition): WebMcpTool {
	const wrapped: WebMcpTool = {
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
		async execute(input: unknown) {
			const result = await tool.run(input);
			if (result.ok) {
				return result.value;
			}
			return { error: result.error, isError: true };
		},
	};
	if (tool.outputSchema) {
		(wrapped as Record<string, unknown>).outputSchema = tool.outputSchema;
	}
	if (tool.annotations) {
		wrapped.annotations = tool.annotations;
	}
	return wrapped;
}

export function provideToolsFromFactory(
	tools: WebMcpToolDefinition[],
): () => void {
	return provideTools(tools.map(wrapToolForClient));
}

export function provideTools(tools: WebMcpTool[]): () => void {
	if (typeof window === 'undefined') return () => {};

	// 1. WebMCP仕様 (document.modelContext.registerTool)
	// registerTool() は Promise<undefined> を返し、登録解除は AbortSignal 経由のみ
	// （返り値にdispose/unregisterを持つハンドルは仕様上存在しない）。
	if (
		typeof document !== 'undefined' &&
		document.modelContext &&
		typeof document.modelContext.registerTool === 'function'
	) {
		const docCtx = document.modelContext;
		const controller =
			typeof AbortController !== 'undefined' ? new AbortController() : null;

		for (const tool of tools) {
			try {
				Promise.resolve(
					docCtx.registerTool(
						tool,
						controller ? { signal: controller.signal } : undefined,
					),
				).catch(() => {
					/* no-op: 同名ツールの重複登録など、登録失敗は無視する */
				});
			} catch {
				/* no-op */
			}
		}

		return () => {
			controller?.abort();
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
