import { defineMcpTool } from '../webmcp/define-tool.ts';
import type { HashAlgorithm } from './hash.ts';
import { hashText } from './hash.ts';

// WebMCP基盤の参照実装。「単一ソースの定義 → ディスクリプタ自動生成」の経路を
// 示すため、この1ファイルには params / returns / handler のみを宣言する。
// JSON Schema (inputSchema/outputSchema) と validate 関数は
// `src/lib/webmcp/descriptor-generator.ts` がここから自動生成する。

const SUPPORTED_ALGORITHMS = ['md5', 'sha-256', 'sha-512'] as const;
type WebMcpHashAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];

const ALGO_MAP: Record<WebMcpHashAlgorithm, HashAlgorithm> = {
	md5: 'md5',
	'sha-256': 'sha256',
	'sha-512': 'sha512',
};

interface HashMcpInput {
	text: string;
	algorithm: WebMcpHashAlgorithm;
}

interface HashMcpOutput {
	hash: string;
}

export const hashMcpTool = defineMcpTool<HashMcpInput, HashMcpOutput>({
	toolId: 'hash',
	name: 'generate_hash',
	description:
		'Calculate MD5 / SHA-256 / SHA-512 hash of text. Runs entirely in the browser; no data is sent externally. / 文字列のハッシュ値を計算する。処理はブラウザ内で完結し、外部送信は行わない。',
	params: {
		text: {
			type: 'string',
			description: 'Text to hash / ハッシュ化する文字列',
		},
		algorithm: {
			type: 'string',
			enum: SUPPORTED_ALGORITHMS,
			description: 'Hash algorithm to use',
		},
	},
	returns: {
		hash: { type: 'string', description: 'Hex-encoded hash value' },
	},
	annotations: { readOnlyHint: true },
	async handler(input) {
		const targetAlgo = ALGO_MAP[input.algorithm];
		const res = await hashText(input.text, [targetAlgo]);
		const computedHash = res[targetAlgo];
		if (!computedHash) {
			throw new Error('Hash computation failed');
		}
		return { hash: computedHash };
	},
});
