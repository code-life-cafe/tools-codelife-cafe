export type WebMcpToolResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: string };

export function success<T>(value: T): WebMcpToolResult<T> {
	return { ok: true, value };
}

export function failure(error: string): WebMcpToolResult<never> {
	return { ok: false, error };
}
