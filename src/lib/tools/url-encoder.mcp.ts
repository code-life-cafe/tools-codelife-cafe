import { defineMcpTool } from '../webmcp/define-tool.ts';
import { decodeUrl, encodeUrl } from './url-encoder.ts';

const ACTIONS = ['encode', 'decode'] as const;
type Action = (typeof ACTIONS)[number];
const MODES = ['component', 'full'] as const;
type Mode = (typeof MODES)[number];

interface UrlEncoderInput {
	url: string;
	action: Action;
	mode: Mode;
}

interface UrlEncoderOutput {
	result: string;
}

export const urlEncoderMcpTool = defineMcpTool<
	UrlEncoderInput,
	UrlEncoderOutput
>({
	toolId: 'url-encoder',
	name: 'encode_decode_url',
	description:
		'Encode or decode URL strings and query parameters. Runs entirely in the browser; no data is sent externally. / URL文字列・クエリパラメータのエンコードおよびデコードを行う。処理はブラウザ内で完結し、外部送信は行わない。',
	params: {
		url: {
			type: 'string',
			description: 'Text to encode or decode / 対象文字列',
		},
		action: {
			type: 'string',
			enum: ACTIONS,
			description: 'encode or decode / エンコードまたはデコード',
		},
		mode: {
			type: 'string',
			enum: MODES,
			required: false,
			default: 'component',
			description:
				'component: encodeURIComponent/decodeURIComponent. full: encodeURI/decodeURI. (default: component) / component: URIコンポーネント単位、full: URL全体（省略時: component）',
		},
	},
	returns: {
		result: {
			type: 'string',
			description: 'Encoded or decoded text / 変換後の文字列',
		},
	},
	annotations: { readOnlyHint: true },
	handler(input) {
		const options = { mode: input.mode };
		const result =
			input.action === 'encode'
				? encodeUrl(input.url, options)
				: decodeUrl(input.url, options);
		return { result };
	},
});
