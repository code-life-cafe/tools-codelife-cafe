import { exceedsMaxCharacters } from '../string-length.ts';
import { defineMcpTool } from '../webmcp/define-tool.ts';
import { renderMermaidSvg } from './mermaid.ts';
import {
	assertMermaidRenderBudget,
	MERMAID_RENDER_MAX_CHARACTERS,
	MERMAID_RENDER_MAX_EDGES,
	MERMAID_RENDER_MAX_SVG_BYTES,
} from './mermaid-render-budget.ts';
import { type RepairChange, repairMermaidCode } from './mermaid-repair.ts';

interface Output {
	code: string;
	modified: boolean;
	changes: RepairChange[];
	svg: string;
}
const returns = {
	code: { type: 'string' },
	modified: { type: 'boolean' },
	changes: { type: 'array' },
	svg: { type: 'string', description: '描画時のSVG。修復のみは空文字。' },
};

export const mermaidMcpTool = defineMcpTool<{ text: string }, Output>({
	toolId: 'mermaid',
	name: 'repair_mermaid_code',
	description:
		'Repair AI-generated Mermaid code locally without rendering. Repair is heuristic, not syntax validation. / AI生成のMermaidを修復する。修復のみでは構文の正しさを保証しない。入力上限100000文字。SVG生成はrender_mermaid_svgを利用する。',
	params: {
		text: {
			type: 'string',
			maxLength: 100_000,
			description: 'Mermaidコード（Markdownフェンスも可）。上限100000文字。',
		},
	},
	returns,
	annotations: { readOnlyHint: true, untrustedContentHint: true },
	handler(input) {
		if (!input.text.trim())
			throw new Error('Mermaidコードを入力してください。');
		if (exceedsMaxCharacters(input.text, 100_000))
			throw new Error('入力の上限は100000文字です。');
		const repaired = repairMermaidCode(input.text);
		return {
			code: repaired.repairedCode,
			modified: repaired.isModified,
			changes: repaired.changes,
			svg: '',
		};
	},
});

export const mermaidRenderMcpTool = defineMcpTool<
	{ text: string; autoRepair: boolean },
	Output
>({
	toolId: 'mermaid',
	name: 'render_mermaid_svg',
	description:
		'Render a small Mermaid diagram as SVG locally in strict mode. / 小型のMermaid図をSVG化する。入力と修復後コードは5000文字、改行・セミコロン区切り50文、50エッジ、SVG出力1MiBまで。設定ディレクティブ・frontmatter・&並列リンク・拡張シェイプ・画像・HTMLは不可。大きな図はrepair_mermaid_codeを利用する。',
	params: {
		text: {
			type: 'string',
			maxLength: MERMAID_RENDER_MAX_CHARACTERS,
			description: 'SVG描画するMermaidコード。上限5000文字・50文。',
		},
		autoRepair: {
			type: 'boolean',
			required: false,
			default: true,
			description: '描画前に修復する（省略時true）',
		},
	},
	returns,
	annotations: { readOnlyHint: true, untrustedContentHint: true },
	async handler(input) {
		if (!input.text.trim())
			throw new Error('Mermaidコードを入力してください。');
		assertMermaidRenderBudget(input.text);
		const repaired = input.autoRepair ? repairMermaidCode(input.text) : null;
		const code = repaired ? repaired.repairedCode : input.text;
		assertMermaidRenderBudget(code);
		const { svg } = await renderMermaidSvg(
			code,
			`webmcp-${crypto.randomUUID()}`,
			'default',
			undefined,
			{
				maxEdges: MERMAID_RENDER_MAX_EDGES,
				maxTextSize: MERMAID_RENDER_MAX_CHARACTERS * 2,
			},
		);
		if (new TextEncoder().encode(svg).byteLength > MERMAID_RENDER_MAX_SVG_BYTES)
			throw new Error('SVG出力の上限は1MiBです。');
		return {
			code,
			modified: repaired?.isModified ?? false,
			changes: repaired?.changes ?? [],
			svg,
		};
	},
});
