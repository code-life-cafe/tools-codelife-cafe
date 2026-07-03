import { failure } from '../errors.ts';
import {
	createWebMcpTool,
	type WebMcpToolDefinition,
} from '../tool-factory.ts';
import { isObject, requireString } from '../validation.ts';

/** トップページからDOM経由で受け取る、カタログのスリムなサマリー */
export type SiteToolSummary = {
	id: string;
	title: string;
	description: string;
	url: string;
	category: string;
	keywords: readonly string[];
};

type SiteToolOutput = Omit<SiteToolSummary, 'keywords'>;

const MAX_QUERY_CHARS = 200;

function toOutput(tool: SiteToolSummary): SiteToolOutput {
	const { keywords: _keywords, ...rest } = tool;
	return rest;
}

const TOOL_LIST_SCHEMA = {
	type: 'object',
	properties: {
		tools: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					title: { type: 'string' },
					description: { type: 'string' },
					url: { type: 'string' },
					category: { type: 'string' },
				},
				required: ['id', 'title', 'description', 'url', 'category'],
			},
		},
	},
	required: ['tools'],
} as const;

/**
 * サイト全体のツールカタログを横断する WebMCP ツール群を生成する。
 * カタログ本体（catalog.ts）はクライアントバンドルに含めず、
 * ページ側でシリアライズしたサマリーを引数で受け取る。
 */
export function createSiteTools(
	catalog: readonly SiteToolSummary[],
): WebMcpToolDefinition[] {
	const listTools = createWebMcpTool<
		Record<string, never>,
		{ tools: SiteToolOutput[] }
	>({
		name: 'list_tools',
		description:
			'List all web tools available on tools.codelife.cafe. Every tool runs entirely client-side and never sends input data to a server. / サイトで利用できる全Webツールの一覧を返す。全ツールがブラウザ内で完結し、入力データを外部送信しない。',
		inputSchema: { type: 'object', properties: {} },
		outputSchema: TOOL_LIST_SCHEMA,
		validate(input) {
			// 引数なしツールのため undefined / null / 空オブジェクトのいずれも許容する
			if (input !== undefined && input !== null && !isObject(input)) {
				return failure('Input must be an object / 入力値が不正です');
			}
			return { ok: true, value: {} };
		},
		execute() {
			return { tools: catalog.map(toOutput) };
		},
	});

	const searchTools = createWebMcpTool<
		{ query: string },
		{ tools: SiteToolOutput[] }
	>({
		name: 'search_tools',
		description:
			'Search tools.codelife.cafe web tools by keyword (Japanese or English). Matches tool title, description, category, and keywords. / キーワードでツールを検索する。タイトル・説明・カテゴリ・キーワードに部分一致したツールを返す。',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search keyword / 検索キーワード（日本語・英語）',
				},
			},
			required: ['query'],
		},
		outputSchema: TOOL_LIST_SCHEMA,
		validate(input) {
			if (!isObject(input)) {
				return failure('Input must be an object / 入力値が不正です');
			}
			const query = requireString(input, 'query');
			if (!query.ok) return query;
			const trimmed = query.value.trim();
			if (trimmed === '') {
				return failure('"query" must not be empty / "query" は空にできません');
			}
			if (trimmed.length > MAX_QUERY_CHARS) {
				return failure(
					'"query" exceeds the maximum length / "query" が長すぎます',
				);
			}
			return { ok: true, value: { query: trimmed } };
		},
		execute({ query }) {
			const q = query.toLowerCase();
			const hits = catalog
				.filter(
					(tool) =>
						tool.title.toLowerCase().includes(q) ||
						tool.description.toLowerCase().includes(q) ||
						tool.category.toLowerCase().includes(q) ||
						tool.keywords.some((k) => k.toLowerCase().includes(q)),
				)
				.map(toOutput);
			return { tools: hits };
		},
	});

	return [listTools, searchTools];
}
