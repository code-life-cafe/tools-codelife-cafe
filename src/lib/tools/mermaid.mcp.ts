import { exceedsMaxCharacters } from '../string-length.ts';
import { defineMcpTool } from '../webmcp/define-tool.ts';
import { renderMermaidSvg } from './mermaid.ts';
import { type RepairChange, repairMermaidCode } from './mermaid-repair.ts';

interface Input {
	text: string;
	action: 'repair' | 'render';
	autoRepair: boolean;
}
export const mermaidMcpTool = defineMcpTool<
	Input,
	{ code: string; modified: boolean; changes: RepairChange[]; svg: string }
>({
	toolId: 'mermaid',
	name: 'repair_render_mermaid',
	description:
		'Repair AI-generated Mermaid code and optionally render SVG locally. Repair is heuristic, not syntax validation. / AI生成のMermaidを修復し、必要に応じSVGを生成する。修復のみでは構文の正しさを保証しない。入力上限100000文字。',
	params: {
		text: {
			type: 'string',
			maxLength: 100_000,
			description: 'Mermaidコード（Markdownフェンスも可）。上限100000文字。',
		},
		action: {
			type: 'string',
			enum: ['repair', 'render'],
			required: false,
			default: 'repair',
			description: 'repair: 修復のみ / render: SVG生成',
		},
		autoRepair: {
			type: 'boolean',
			required: false,
			default: true,
			description: 'SVG生成前に自動修復を適用する。repairでは常に修復する。',
		},
	},
	returns: {
		code: { type: 'string' },
		modified: { type: 'boolean' },
		changes: { type: 'array' },
		svg: { type: 'string', description: 'render時のSVG。repair時は空文字。' },
	},
	annotations: { readOnlyHint: true, untrustedContentHint: true },
	async handler(input) {
		if (!input.text.trim())
			throw new Error('Mermaidコードを入力してください。');
		if (exceedsMaxCharacters(input.text, 100_000))
			throw new Error('入力の上限は100000文字です。');
		const repaired = repairMermaidCode(input.text);
		const useRepair = input.action === 'repair' || input.autoRepair;
		const code = useRepair ? repaired.repairedCode : input.text;
		const svg =
			input.action === 'render'
				? (await renderMermaidSvg(code, `webmcp-${crypto.randomUUID()}`)).svg
				: '';
		return {
			code,
			modified: useRepair && repaired.isModified,
			changes: useRepair ? repaired.changes : [],
			svg,
		};
	},
});
