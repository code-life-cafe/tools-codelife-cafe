import { defineMcpTool } from '../webmcp/define-tool.ts';
import { countChars } from './char-count.ts';

const ENCODINGS = ['utf-8', 'shift_jis'] as const;
type Encoding = (typeof ENCODINGS)[number];

interface CharCountInput {
	text: string;
	encoding: Encoding;
}

interface CharCountOutput {
	charsWithSpaces: number;
	charsWithoutSpaces: number;
	graphemes: number;
	bytes: number;
	bytesUtf8: number;
	bytesShiftJis: number;
	lines: number;
}

export const charCountMcpTool = defineMcpTool<CharCountInput, CharCountOutput>({
	toolId: 'char-count',
	name: 'count_characters',
	description:
		'Count characters, bytes (UTF-8 / Shift_JIS), and lines in text. Runs entirely in the browser; no data is sent externally. / テキストの文字数・バイト数（UTF-8 / Shift_JIS）・行数を解析する。処理はブラウザ内で完結し、外部送信は行わない。',
	params: {
		text: { type: 'string', description: 'Text to analyze / 解析対象テキスト' },
		encoding: {
			type: 'string',
			enum: ENCODINGS,
			required: false,
			default: 'utf-8',
			description:
				'Encoding used for the primary "bytes" field (default: utf-8). Both bytesUtf8 and bytesShiftJis are always returned. / 主要な"bytes"フィールドで使うエンコーディング（省略時: utf-8）。bytesUtf8とbytesShiftJisは常に両方返る',
		},
	},
	returns: {
		charsWithSpaces: {
			type: 'number',
			description: 'Character count including whitespace / 空白を含む文字数',
		},
		charsWithoutSpaces: {
			type: 'number',
			description: 'Character count excluding whitespace / 空白を除く文字数',
		},
		graphemes: {
			type: 'number',
			description: 'Grapheme cluster count / 書記素クラスタ数',
		},
		bytes: {
			type: 'number',
			description:
				'Byte count in the selected encoding / 選択エンコーディングでのバイト数',
		},
		bytesUtf8: {
			type: 'number',
			description: 'UTF-8 byte count / UTF-8バイト数',
		},
		bytesShiftJis: {
			type: 'number',
			description: 'Shift_JIS byte count / Shift_JISバイト数',
		},
		lines: { type: 'number', description: 'Line count / 行数' },
	},
	annotations: { readOnlyHint: true },
	handler(input) {
		const res = countChars(input.text);
		return {
			charsWithSpaces: res.charsWithSpaces,
			charsWithoutSpaces: res.charsWithoutSpaces,
			graphemes: res.graphemes,
			bytes: input.encoding === 'shift_jis' ? res.bytesShiftJis : res.bytesUtf8,
			bytesUtf8: res.bytesUtf8,
			bytesShiftJis: res.bytesShiftJis,
			lines: res.lines,
		};
	},
});
