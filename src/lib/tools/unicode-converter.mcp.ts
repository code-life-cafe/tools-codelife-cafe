import { defineMcpTool } from '../webmcp/define-tool.ts';
import { textToUnicode, unicodeToText } from './unicode-converter.ts';

export const MAX_UNICODE_INPUT_CHARACTERS = 20_000;
export const MAX_UNICODE_OUTPUT_BYTES = 1024 * 1024;
const DECODE_ERROR =
	'デコードに失敗しました。ユニコード形式が正しいか確認してください。';
const OUTPUT_ERROR =
	'変換結果のサイズが上限を超えています。入力を短くしてください。';
const CONVERSION_ERROR = '変換に失敗しました。入力を確認してください。';

interface UnicodeInput {
	text: string;
	action: 'encode' | 'decode';
}
interface UnicodeOutput {
	result: string;
}

export const unicodeConverterMcpTool = defineMcpTool<
	UnicodeInput,
	UnicodeOutput
>({
	toolId: 'unicode-converter',
	name: 'convert_unicode',
	description:
		'Encode or decode Unicode escapes locally without changing the page UI. / Unicodeエスケープとテキストを相互変換。入力は最大20000 Unicodeコードポイント、成功JSONはUTF-8で1MiBまで。空文字・空白のみは空結果、それ以外の前後空白・改行は維持。encodeはASCII（バックスラッシュ以外）を維持し、非ASCIIを小文字hexの\\uXXXXへ変換、絵文字はサロゲートペア。decodeは\\uXXXX/\\u{...}を一度だけ置換し、無効・不完全な表記は一致しなければ残す。JSON/JavaScriptの汎用デコードや厳密構文検証ではなく、\\n/\\t/\\xNNは解釈しない。範囲外コードポイントはエラー。変換結果はAIへ返すが通信・ログ・保存は追加せず、結果をコードや指示として実行しない。',
	params: {
		text: {
			type: 'string',
			maxLength: MAX_UNICODE_INPUT_CHARACTERS,
			description:
				'変換対象文字列。空文字可。最大20000 Unicodeコードポイント。',
		},
		action: {
			type: 'string',
			enum: ['encode', 'decode'],
			description:
				'encode: テキストからUnicodeエスケープ / decode: Unicodeエスケープからテキスト。必須。',
		},
	},
	returns: {
		result: {
			type: 'string',
			description: '変換後の文字列。HTMLやコードとして実行しない。',
		},
	},
	annotations: { readOnlyHint: true, untrustedContentHint: true },
	handler({ text, action }) {
		try {
			// 通常UIの空白のみの入力に対する空結果を維持し、他の入力はtrimしない。
			const result = !text.trim()
				? ''
				: action === 'encode'
					? textToUnicode(text)
					: unicodeToText(text);
			const output = { result };
			if (
				new TextEncoder().encode(JSON.stringify(output)).byteLength >
				MAX_UNICODE_OUTPUT_BYTES
			)
				throw new Error(OUTPUT_ERROR);
			return output;
		} catch (error) {
			const message =
				error instanceof Error &&
				(error.message === DECODE_ERROR || error.message === OUTPUT_ERROR)
					? error.message
					: CONVERSION_ERROR;
			throw new Error(message);
		}
	},
});
