import { defineMcpTool } from '../webmcp/define-tool.ts';
import {
	type MaskChar,
	type MaskStrength,
	type MaskTarget,
	maskText,
} from './masking.ts';

interface Input {
	text: string;
	maskChar: MaskChar;
	strength: MaskStrength;
	email: boolean;
	phone: boolean;
	zipcode: boolean;
	card: boolean;
	mynumber: boolean;
	name: boolean;
}
export const maskingMcpTool = defineMcpTool<
	Input,
	{ maskedText: string; counts: Record<MaskTarget, number>; warning: string }
>({
	toolId: 'masking',
	name: 'mask_personal_information',
	description:
		'Mask detected Japanese personal information locally. Detection is heuristic and incomplete; review before sharing. This cannot undo data already given to an AI. / 日本の個人情報をブラウザ内でマスキングする。検出は簡易方式で漏れがあり、共有前の確認が必要。AIへ既に渡した情報は取り消せない。入力上限100000文字。',
	params: {
		text: {
			type: 'string',
			maxLength: 100_000,
			description: 'マスキングするテキスト。上限100000文字。',
		},
		maskChar: {
			type: 'string',
			enum: ['*', '●'],
			required: false,
			default: '*',
			description: '伏字文字',
		},
		strength: {
			type: 'string',
			enum: ['partial', 'full'],
			required: false,
			default: 'full',
			description: 'fullは全体を伏字、partialは一部を残す',
		},
		email: {
			type: 'boolean',
			required: false,
			default: true,
			description: 'メールを対象にする',
		},
		phone: {
			type: 'boolean',
			required: false,
			default: true,
			description: '電話番号を対象にする',
		},
		zipcode: {
			type: 'boolean',
			required: false,
			default: true,
			description: '郵便番号を対象にする',
		},
		card: {
			type: 'boolean',
			required: false,
			default: true,
			description: 'カード番号を対象にする',
		},
		mynumber: {
			type: 'boolean',
			required: false,
			default: true,
			description: 'マイナンバーを対象にする',
		},
		name: {
			type: 'boolean',
			required: false,
			default: true,
			description: '氏名を対象にする（簡易検出）',
		},
	},
	returns: {
		maskedText: { type: 'string' },
		counts: { type: 'object' },
		warning: { type: 'string' },
	},
	annotations: { readOnlyHint: true, untrustedContentHint: true },
	handler(input) {
		if (input.text.length > 100_000)
			throw new Error('入力の上限は100000文字です。');
		const targets = new Set<MaskTarget>();
		for (const target of [
			'email',
			'phone',
			'zipcode',
			'card',
			'mynumber',
			'name',
		] as const) {
			if (input[target]) targets.add(target);
		}
		const result = maskText(input.text, {
			targets,
			maskChar: input.maskChar,
			strength: input.strength,
		});
		return {
			maskedText: result.maskedText,
			counts: result.counts,
			warning:
				'簡易検出のため漏れや誤検出があります。共有前に結果を確認してください。',
		};
	},
});
