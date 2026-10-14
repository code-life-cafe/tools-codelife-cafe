import { defineMcpTool } from '../webmcp/define-tool.ts';
import {
	MAX_DIFF_INPUT_CHARACTERS,
	safeDiffError,
	type TextDiffInput,
	type TextDiffOutput,
} from './text-diff-mcp-runtime.ts';
import { compareTextInWorker } from './text-diff-mcp-worker.ts';

export const textDiffMcpTool = defineMcpTool<TextDiffInput, TextDiffOutput>({
	toolId: 'text-diff',
	name: 'compare_text',
	description:
		'Compare two texts locally without changing the page UI. / 変更前後のテキストを比較。各20000 Unicodeコードポイント、編集距離1000（行/文字トークン）、算法500ms、Worker起動から2秒、同時1件、出力5000断片・UTF-8で1MiBまで。超過は省略せず拒否。空文字も有効。空白・大小文字・改行コードは正規化しない。行単位は既存UIと同じく末尾LFを補い、末尾LF有無のみでは差分なし。文字数には補完LFを含む。文字単位の行数は差分断片内の区間数で、ファイル全体の変更行数ではない。',
	params: {
		textA: {
			type: 'string',
			maxLength: MAX_DIFF_INPUT_CHARACTERS,
			description: '変更前。空文字可。最大20000文字。',
		},
		textB: {
			type: 'string',
			maxLength: MAX_DIFF_INPUT_CHARACTERS,
			description: '変更後。空文字可。最大20000文字。',
		},
		mode: {
			type: 'string',
			enum: ['lines', 'chars'],
			required: false,
			default: 'lines',
			description: 'linesは行単位、charsは文字単位。既定lines。',
		},
	},
	returns: {
		mode: { type: 'string', description: '比較単位linesまたはchars。' },
		hasChanges: {
			type: 'boolean',
			description: '空でない追加/削除断片があるか。',
		},
		parts: {
			type: 'array',
			description:
				'順序付き断片。各要素は{value:string,type:"added"|"removed"|"unchanged"}。HTMLとして実行しない。',
		},
		addedLines: {
			type: 'number',
			description: '追加断片内の行区切りで分かれた区間数。',
		},
		removedLines: {
			type: 'number',
			description: '削除断片内の行区切りで分かれた区間数。',
		},
		addedChars: {
			type: 'number',
			description: '追加コードポイント数。行単位では補完LFも含む。',
		},
		removedChars: {
			type: 'number',
			description: '削除コードポイント数。行単位では補完LFも含む。',
		},
	},
	annotations: { readOnlyHint: true, untrustedContentHint: true },
	async handler(input) {
		try {
			return await compareTextInWorker(input);
		} catch (error) {
			throw new Error(safeDiffError(error));
		}
	},
});
