import type { WebMcpToolResult } from './errors.ts';

/** WebMCP仕様のToolAnnotations相当（readOnlyHint / untrustedContentHint） */
export interface WebMcpToolAnnotations {
	readOnlyHint?: boolean;
	untrustedContentHint?: boolean;
}

export interface WebMcpToolConfig<TInput, TOutput> {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	annotations?: WebMcpToolAnnotations;
	validate: (input: unknown) => WebMcpToolResult<TInput>;
	execute: (input: TInput) => Promise<TOutput> | TOutput;
}

export interface WebMcpToolDefinition<TOutput = unknown> {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	annotations?: WebMcpToolAnnotations;
	run: (input: unknown) => Promise<WebMcpToolResult<TOutput>>;
}

export function createWebMcpTool<TInput, TOutput>(
	config: WebMcpToolConfig<TInput, TOutput>,
): WebMcpToolDefinition<TOutput> {
	return {
		name: config.name,
		description: config.description,
		inputSchema: config.inputSchema,
		outputSchema: config.outputSchema,
		annotations: config.annotations,
		run: async (input: unknown): Promise<WebMcpToolResult<TOutput>> => {
			try {
				const validated = config.validate(input);
				if (!validated.ok) return { ok: false, error: validated.error };
				return { ok: true, value: await config.execute(validated.value) };
			} catch (e) {
				return {
					ok: false,
					error:
						e instanceof Error
							? e.message
							: 'An unexpected error occurred / 予期しないエラーが発生しました',
				};
			}
		},
	};
}
