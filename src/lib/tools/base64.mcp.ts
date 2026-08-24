import { defineMcpTool } from '../webmcp/define-tool.ts';
import { decodeBase64, encodeBase64 } from './base64.ts';

const ACTIONS = ['encode', 'decode'] as const;
type Action = (typeof ACTIONS)[number];

interface Base64Input {
	text: string;
	action: Action;
}

interface Base64Output {
	result: string;
}

export const base64McpTool = defineMcpTool<Base64Input, Base64Output>({
	toolId: 'base64',
	name: 'encode_decode_base64',
	description:
		'Encode text to Base64 or decode Base64 to text. Runs entirely in the browser; no data is sent externally. / テキストのBase64エンコードおよびデコードを行う。処理はブラウザ内で完結し、外部送信は行わない。',
	params: {
		text: {
			type: 'string',
			description: 'Text to encode or decode / 対象テキスト',
		},
		action: {
			type: 'string',
			enum: ACTIONS,
			description: 'encode or decode / エンコードまたはデコード',
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
		const result =
			input.action === 'encode'
				? encodeBase64(input.text)
				: decodeBase64(input.text);
		return { result };
	},
});
