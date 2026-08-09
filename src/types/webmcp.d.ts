interface WebMcpToolAnnotations {
	readOnlyHint?: boolean;
	untrustedContentHint?: boolean;
}

type WebMcpToolDefinition = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execute: (input: unknown) => Promise<unknown> | unknown;
	annotations?: WebMcpToolAnnotations;
};

/** 旧ドラフト仕様 (navigator.modelContext.provideContext) 向けの互換フォールバック */
interface ModelContext {
	provideContext(args: { tools: WebMcpToolDefinition[] }): unknown;
	clearContext?: () => void;
}

/**
 * WebMCP仕様 (document.modelContext) の registerTool は Promise<undefined> を返し、
 * 登録解除は options.signal の abort でのみ行われる（返り値にunregister手段は無い）。
 * https://webmachinelearning.github.io/webmcp/
 */
interface DocumentModelContext {
	registerTool(
		tool: WebMcpToolDefinition,
		options?: { signal?: AbortSignal },
	): Promise<undefined>;
}

interface Navigator {
	modelContext?: ModelContext;
}

interface Document {
	modelContext?: DocumentModelContext;
}
