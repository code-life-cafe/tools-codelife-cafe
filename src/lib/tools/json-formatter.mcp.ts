import { defineMcpTool } from '../webmcp/define-tool.ts';
import type { IndentType } from './json-formatter.ts';
import { formatJson, minifyJson } from './json-formatter.ts';

interface JsonFormatterInput {
	json: string;
	indent: number;
	minify: boolean;
}

interface JsonFormatterOutput {
	output: string;
}

export const jsonFormatterMcpTool = defineMcpTool<
	JsonFormatterInput,
	JsonFormatterOutput
>({
	toolId: 'json-formatter',
	name: 'format_json',
	description:
		'Format, indent, or minify JSON text. Preserves precision for integers beyond Number.MAX_SAFE_INTEGER. Runs entirely in the browser; no data is sent externally. / JSON文字列を整形・インデント付与・最小化する。安全な整数範囲を超える大整数も精度を保持する。処理はブラウザ内で完結し、外部送信は行わない。',
	params: {
		json: {
			type: 'string',
			description: 'JSON text to format / 対象JSON文字列',
		},
		indent: {
			type: 'number',
			required: false,
			default: 2,
			description:
				'Indent width: 2 or 4 (default: 2), ignored when minify is true / インデント幅（2 または 4、省略時: 2）。minify=trueの場合は無視される',
		},
		minify: {
			type: 'boolean',
			required: false,
			default: false,
			description:
				'Minify instead of indenting when true / trueの場合は整形の代わりに最小化する',
		},
	},
	returns: {
		output: {
			type: 'string',
			description:
				'Formatted or minified JSON / 整形または最小化後のJSON文字列',
		},
	},
	annotations: { readOnlyHint: true },
	handler(input) {
		const indentType: IndentType = input.indent === 4 ? '4' : '2';
		const result = input.minify
			? minifyJson(input.json)
			: formatJson(input.json, indentType);
		if (!result.success) {
			throw new Error(result.error ?? 'JSON構文エラー');
		}
		return { output: result.output };
	},
});
