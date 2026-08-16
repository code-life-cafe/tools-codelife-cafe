import type {
	McpParamDef,
	McpReturnDef,
	McpToolDefinition,
} from './define-tool.ts';
import type { WebMcpToolResult } from './errors.ts';
import { failure } from './errors.ts';
import { createWebMcpTool, type WebMcpToolDefinition } from './tool-factory.ts';
import { isObject } from './validation.ts';

/**
 * `defineMcpTool()` で宣言した単一ソースの定義から、WebMCPディスクリプタ
 * （JSON Schema の inputSchema / outputSchema・validate・execute）を自動生成する。
 * 新規ツール追加時、この生成経路を通す限りディスクリプタ側の個別実装は不要になる。
 */

function paramToJsonSchema(def: McpParamDef): Record<string, unknown> {
	const schema: Record<string, unknown> = {
		type: def.type,
		description: def.description,
	};
	if (def.enum) schema.enum = def.enum;
	return schema;
}

/** McpParamDef のマップから JSON Schema (inputSchema) を生成する */
export function buildInputSchema(
	params: Record<string, McpParamDef>,
): Record<string, unknown> {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];
	for (const [key, def] of Object.entries(params)) {
		properties[key] = paramToJsonSchema(def);
		if (def.required !== false) required.push(key);
	}
	return { type: 'object', properties, required };
}

/** McpReturnDef のマップから JSON Schema (outputSchema) を生成する */
export function buildOutputSchema(
	returns: Record<string, McpReturnDef>,
): Record<string, unknown> {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];
	for (const [key, def] of Object.entries(returns)) {
		properties[key] = {
			type: def.type,
			...(def.description ? { description: def.description } : {}),
		};
		required.push(key);
	}
	return { type: 'object', properties, required };
}

function validateOneParam(
	key: string,
	def: McpParamDef,
	raw: unknown,
): WebMcpToolResult<unknown> {
	if (def.type === 'string') {
		if (typeof raw !== 'string') {
			return failure(
				`"${key}" must be a string / "${key}" は文字列で指定してください`,
			);
		}
		if (def.enum && !def.enum.includes(raw)) {
			return failure(
				`"${key}" must be one of: ${def.enum.join(', ')} / "${key}" は次のいずれかを指定してください: ${def.enum.join(', ')}`,
			);
		}
		if (def.maxLength !== undefined && raw.length > def.maxLength) {
			return failure(
				`"${key}" exceeds the maximum size limit / "${key}" のサイズが上限を超えています`,
			);
		}
		return { ok: true, value: raw };
	}
	if (def.type === 'number') {
		if (typeof raw !== 'number' || !Number.isFinite(raw)) {
			return failure(
				`"${key}" must be a finite number / "${key}" は有限の数値で指定してください`,
			);
		}
		return { ok: true, value: raw };
	}
	// def.type === 'boolean'
	if (typeof raw !== 'boolean') {
		return failure(
			`"${key}" must be a boolean / "${key}" は真偽値で指定してください`,
		);
	}
	return { ok: true, value: raw };
}

/**
 * McpParamDef のマップから validate 関数を汎用的に導出する。
 * 個々のツールで isObject/requireString/requireEnum 等を手書きする必要はない。
 */
export function buildValidator(
	params: Record<string, McpParamDef>,
): (input: unknown) => WebMcpToolResult<Record<string, unknown>> {
	return (input: unknown) => {
		if (input !== undefined && input !== null && !isObject(input)) {
			return failure('Input must be an object / 入力値が不正です');
		}
		const obj = isObject(input) ? input : {};
		const value: Record<string, unknown> = {};
		for (const [key, def] of Object.entries(params)) {
			const raw = obj[key];
			if (raw === undefined) {
				if (def.required === false) {
					if (def.default !== undefined) value[key] = def.default;
					continue;
				}
				return failure(`"${key}" is required / "${key}" は必須です`);
			}
			const validated = validateOneParam(key, def, raw);
			if (!validated.ok) return validated;
			value[key] = validated.value;
		}
		return { ok: true, value };
	};
}

/** 単一ソースの `McpToolDefinition` から実行可能な WebMCPディスクリプタを生成する */
export function generateWebMcpDescriptor<TParams, TOutput>(
	definition: McpToolDefinition<TParams, TOutput>,
): WebMcpToolDefinition<TOutput> {
	const validate = buildValidator(definition.params);
	return createWebMcpTool<TParams, TOutput>({
		name: definition.name,
		description: definition.description,
		inputSchema: buildInputSchema(definition.params),
		outputSchema: buildOutputSchema(definition.returns),
		annotations: definition.annotations,
		validate: (input: unknown) => {
			const result = validate(input);
			if (!result.ok) return result;
			return { ok: true, value: result.value as TParams };
		},
		execute: (input: TParams) => definition.handler(input),
	});
}
