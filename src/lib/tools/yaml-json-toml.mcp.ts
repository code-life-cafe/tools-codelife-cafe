import { defineMcpTool } from '../webmcp/define-tool.ts';
import { convertFormats, type Format, type Indent } from './yaml-json-toml.ts';

interface Input {
	text: string;
	from: Format;
	to: Format;
	indent: '0' | '2' | '4';
	sortKeys: boolean;
}
export const yamlJsonTomlMcpTool = defineMcpTool<
	Input,
	{ output: string; note: string }
>({
	toolId: 'yaml-json-toml',
	name: 'convert_yaml_json_toml',
	description:
		'Convert YAML, JSON and TOML locally with syntax errors and TOML limitations reported. / YAML・JSON・TOMLをブラウザ内で相互変換する。構文エラーとTOMLの制約を報告する。入力上限100000文字。',
	params: {
		text: {
			type: 'string',
			maxLength: 100_000,
			description: '変換するテキスト。上限100000文字。',
		},
		from: {
			type: 'string',
			enum: ['yaml', 'json', 'toml'],
			description: '入力形式',
		},
		to: {
			type: 'string',
			enum: ['yaml', 'json', 'toml'],
			description: '出力形式',
		},
		indent: {
			type: 'string',
			enum: ['0', '2', '4'],
			required: false,
			default: '2',
			description: 'インデント幅（0はコンパクト）',
		},
		sortKeys: {
			type: 'boolean',
			required: false,
			default: false,
			description: 'キーを辞書順でソート',
		},
	},
	returns: { output: { type: 'string' }, note: { type: 'string' } },
	annotations: { readOnlyHint: true, untrustedContentHint: true },
	handler(input) {
		if (input.text.length > 100_000)
			throw new Error('入力の上限は100000文字です。');
		const result = convertFormats(input.from, input.to, input.text, {
			indent: Number(input.indent) as Indent,
			sortKeys: input.sortKeys,
		});
		if (!result.ok)
			throw new Error(
				`${result.error}${result.row ? `（行${result.row}${result.col ? `・列${result.col}` : ''}）` : ''}`,
			);
		return { output: result.output, note: result.note ?? '' };
	},
});
