import type { WebMcpToolResult } from './errors.ts';
import { failure } from './errors.ts';

export function isObject(input: unknown): input is Record<string, unknown> {
	return typeof input === 'object' && input !== null;
}

export function requireString(
	obj: Record<string, unknown>,
	key: string,
): WebMcpToolResult<string> {
	const v = obj[key];
	if (typeof v !== 'string') {
		return failure(`"${key}" must be a string`);
	}
	return { ok: true, value: v };
}

export function requireNumber(
	obj: Record<string, unknown>,
	key: string,
): WebMcpToolResult<number> {
	const v = obj[key];
	if (typeof v !== 'number' || !Number.isFinite(v)) {
		return failure(`"${key}" must be a finite number`);
	}
	return { ok: true, value: v };
}

export function requireEnum<T extends string>(
	obj: Record<string, unknown>,
	key: string,
	values: readonly T[],
): WebMcpToolResult<T> {
	const v = obj[key];
	if (typeof v !== 'string' || !values.includes(v as T)) {
		return failure(`"${key}" must be one of: ${values.join(', ')}`);
	}
	return { ok: true, value: v as T };
}

export function optionalEnum<T extends string>(
	obj: Record<string, unknown>,
	key: string,
	values: readonly T[],
	defaultValue: T,
): WebMcpToolResult<T> {
	const v = obj[key];
	if (v === undefined) {
		return { ok: true, value: defaultValue };
	}
	if (typeof v !== 'string' || !values.includes(v as T)) {
		return failure(`"${key}" must be one of: ${values.join(', ')}`);
	}
	return { ok: true, value: v as T };
}

export function checkSizeLimit(
	value: string,
	maxChars: number,
	label = 'Input',
): WebMcpToolResult<string> {
	if (value.length > maxChars) {
		return failure(`${label} exceeds the maximum size limit`);
	}
	return { ok: true, value };
}
