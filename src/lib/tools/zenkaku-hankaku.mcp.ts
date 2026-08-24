import { defineMcpTool } from '../webmcp/define-tool.ts';
import type { ConversionOptions, Direction } from './zenkaku-hankaku.ts';
import { convert } from './zenkaku-hankaku.ts';

const MODES = ['to_half', 'to_full'] as const;
type Mode = (typeof MODES)[number];
const TARGETS = ['all', 'kana', 'alpha', 'digit'] as const;
type Target = (typeof TARGETS)[number];

const MODE_TO_DIRECTION: Record<Mode, Direction> = {
	to_half: 'toHankaku',
	to_full: 'toZenkaku',
};

const TARGET_TO_OPTIONS: Record<Target, ConversionOptions> = {
	all: { katakana: true, alpha: true, numbers: true, symbols: true },
	kana: { katakana: true, alpha: false, numbers: false, symbols: false },
	alpha: { katakana: false, alpha: true, numbers: false, symbols: false },
	digit: { katakana: false, alpha: false, numbers: true, symbols: false },
};

interface ZenkakuHankakuInput {
	text: string;
	mode: Mode;
	target: Target;
}

interface ZenkakuHankakuOutput {
	result: string;
}

export const zenkakuHankakuMcpTool = defineMcpTool<
	ZenkakuHankakuInput,
	ZenkakuHankakuOutput
>({
	toolId: 'zenkaku-hankaku',
	name: 'convert_full_half_width',
	description:
		'Convert Japanese full-width/half-width characters (kana, alphanumerics, symbols) in both directions. Runs entirely in the browser; no data is sent externally. / カタカナ・英数字・記号の全角半角を相互変換する。処理はブラウザ内で完結し、外部送信は行わない。',
	params: {
		text: { type: 'string', description: 'Text to convert / 変換対象文字列' },
		mode: {
			type: 'string',
			enum: MODES,
			description:
				'to_half: full-width to half-width. to_full: half-width to full-width. / to_half: 全角→半角、to_full: 半角→全角',
		},
		target: {
			type: 'string',
			enum: TARGETS,
			required: false,
			default: 'all',
			description:
				'Character category to convert (default: all) / 変換対象の文字種（省略時: all）',
		},
	},
	returns: {
		result: { type: 'string', description: 'Converted text / 変換後の文字列' },
	},
	annotations: { readOnlyHint: true },
	handler(input) {
		const direction = MODE_TO_DIRECTION[input.mode];
		const options = TARGET_TO_OPTIONS[input.target];
		return { result: convert(input.text, direction, options) };
	},
});
