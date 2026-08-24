import { defineMcpTool } from '../webmcp/define-tool.ts';
import type { IdKind } from './uuid.ts';
import { generateIds } from './uuid.ts';

const TYPES = ['v4', 'v7', 'ulid', 'nanoid'] as const;
type IdType = (typeof TYPES)[number];

const TYPE_TO_KIND: Record<IdType, IdKind> = {
	v4: 'uuid-v4',
	v7: 'uuid-v7',
	ulid: 'ulid',
	nanoid: 'nanoid',
};

const MIN_MCP_COUNT = 1;
const MAX_MCP_COUNT = 100;

interface UuidInput {
	type: IdType;
	count: number;
}

interface UuidOutput {
	ids: string[];
}

export const uuidMcpTool = defineMcpTool<UuidInput, UuidOutput>({
	toolId: 'uuid',
	name: 'generate_uuid',
	description:
		'Generate UUID v4 / UUID v7 / ULID / nanoid identifiers using crypto.getRandomValues(). Runs entirely in the browser; no data is sent externally. / crypto.getRandomValues()を用いてUUID v4・UUID v7・ULID・nanoidを生成する。処理はブラウザ内で完結し、外部送信は行わない。',
	params: {
		type: {
			type: 'string',
			enum: TYPES,
			description: 'Identifier type to generate / 生成するID種別',
		},
		count: {
			type: 'number',
			required: false,
			default: 1,
			description: `Number of identifiers to generate (${MIN_MCP_COUNT}-${MAX_MCP_COUNT}, default: 1) / 生成件数（${MIN_MCP_COUNT}〜${MAX_MCP_COUNT}件、省略時: 1）`,
		},
	},
	returns: {
		ids: {
			type: 'array',
			description: 'Generated identifiers / 生成されたID一覧',
		},
	},
	annotations: { readOnlyHint: true },
	handler(input) {
		if (
			!Number.isInteger(input.count) ||
			input.count < MIN_MCP_COUNT ||
			input.count > MAX_MCP_COUNT
		) {
			throw new Error(
				`"count" must be an integer between ${MIN_MCP_COUNT} and ${MAX_MCP_COUNT} / "count" は${MIN_MCP_COUNT}〜${MAX_MCP_COUNT}の整数で指定してください`,
			);
		}
		const kind = TYPE_TO_KIND[input.type];
		return { ids: generateIds(kind, input.count) };
	},
});
