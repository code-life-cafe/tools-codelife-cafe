import type { HashAlgorithm } from '../../tools/hash.ts';
import { hashText } from '../../tools/hash.ts';
import { failure } from '../errors.ts';
import { createWebMcpTool } from '../tool-factory.ts';
import { isObject, requireEnum, requireString } from '../validation.ts';

const SUPPORTED_ALGORITHMS = ['md5', 'sha-256', 'sha-512'] as const;
type WebMcpHashAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];

const ALGO_MAP: Record<WebMcpHashAlgorithm, HashAlgorithm> = {
	md5: 'md5',
	'sha-256': 'sha256',
	'sha-512': 'sha512',
};

interface HashInput {
	text: string;
	algorithm: WebMcpHashAlgorithm;
}

interface HashOutput {
	hash: string;
}

export const hashTool = createWebMcpTool<HashInput, HashOutput>({
	name: 'generate_hash',
	description:
		'Calculate MD5 / SHA-256 / SHA-512 hash of text. Runs entirely in the browser; no data is sent externally. / 文字列のハッシュ値を計算する。処理はブラウザ内で完結し、外部送信は行わない。',
	inputSchema: {
		type: 'object',
		properties: {
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
		required: ['text', 'algorithm'],
	},
	outputSchema: {
		type: 'object',
		properties: {
			hash: { type: 'string', description: 'Hex-encoded hash value' },
		},
		required: ['hash'],
	},
	validate(input) {
		if (!isObject(input)) return failure('Input must be an object');
		const text = requireString(input, 'text');
		if (!text.ok) return text;
		const algorithm = requireEnum(input, 'algorithm', SUPPORTED_ALGORITHMS);
		if (!algorithm.ok) return algorithm;
		return {
			ok: true,
			value: { text: text.value, algorithm: algorithm.value },
		};
	},
	async execute(input) {
		const targetAlgo = ALGO_MAP[input.algorithm];
		const res = await hashText(input.text, [targetAlgo]);
		const computedHash = res[targetAlgo];
		if (!computedHash) {
			throw new Error('Hash computation failed');
		}
		return { hash: computedHash };
	},
});
