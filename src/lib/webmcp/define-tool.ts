import type { WebMcpToolAnnotations } from './tool-factory.ts';

/** 宣言的パラメータ定義でサポートするプリミティブ型 */
export type McpParamType = 'string' | 'number' | 'boolean';

export interface McpParamDef {
	type: McpParamType;
	/** JSON Schema description（英語 / 日本語併記を推奨） */
	description: string;
	/** 省略時は true（必須項目） */
	required?: boolean;
	/** type: 'string' の場合のみ有効な列挙候補 */
	enum?: readonly string[];
	/** required: false のとき、値省略時に補完するデフォルト値 */
	default?: string | number | boolean;
	/** type: 'string' の場合のみ有効な最大文字数 */
	maxLength?: number;
}

export interface McpReturnDef {
	/** JSON Schema type（object/array を含む任意の型文字列） */
	type: string;
	description?: string;
}

export interface McpToolDefinition<
	TParams = Record<string, unknown>,
	TOutput = unknown,
> {
	/** src/lib/tools/catalog.ts の id と一致させ、人間向けUIとの接続点とする */
	toolId: string;
	/** MCPツール名（例: generate_hash） */
	name: string;
	description: string;
	/** 別名（将来のディスクリプタ集約・検索用途向けに保持。現時点では未使用） */
	aliases?: readonly string[];
	params: Record<string, McpParamDef>;
	returns: Record<string, McpReturnDef>;
	annotations?: WebMcpToolAnnotations;
	handler: (input: TParams) => Promise<TOutput> | TOutput;
}

/**
 * ツール定義を単一ソースとして宣言するためのヘルパー。
 * ここで宣言した内容から WebMCP ディスクリプタ（JSON Schema・validate・execute）が
 * `descriptor-generator.ts` によって自動生成される。手書きの inputSchema / outputSchema /
 * validate 関数は書かない。
 */
export function defineMcpTool<TParams, TOutput>(
	definition: McpToolDefinition<TParams, TOutput>,
): McpToolDefinition<TParams, TOutput> {
	return definition;
}
