type WebMcpToolDefinition = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execute: (input: unknown) => Promise<unknown> | unknown;
};

interface ModelContext {
	provideContext(args: { tools: WebMcpToolDefinition[] }): unknown;
	clearContext?: () => void;
}

interface DocumentModelContext {
	registerTool(
		tool: WebMcpToolDefinition,
		options?: { signal?: AbortSignal },
	): unknown;
	unregisterTool?: (name: string) => void;
}

interface Navigator {
	modelContext?: ModelContext;
}

interface Document {
	modelContext?: DocumentModelContext;
}
