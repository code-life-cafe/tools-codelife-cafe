import { defineMcpTool } from '../webmcp/define-tool.ts';
import { decodeJwt } from './jwt-decoder.ts';

interface JwtDecoderInput {
	jwt: string;
}

interface JwtDecoderOutput {
	header: unknown;
	payload: unknown;
	warnings: string[];
}

export const jwtDecoderMcpTool = defineMcpTool<
	JwtDecoderInput,
	JwtDecoderOutput
>({
	toolId: 'jwt-decoder',
	name: 'decode_jwt',
	description:
		'Decode a JWT and return its Header and Payload as JSON, with warnings for an expired (exp) or not-yet-valid (nbf) token. Does not verify the signature. Runs entirely in the browser; no data is sent externally. / JWTのHeaderおよびPayloadをJSONとしてデコードする。有効期限（exp）・有効開始時刻（nbf）の警告を含む。署名検証は行わない。処理はブラウザ内で完結し、外部送信は行わない。',
	params: {
		jwt: {
			type: 'string',
			description: 'JWT token string / JWTトークン文字列',
		},
	},
	returns: {
		header: {
			type: 'object',
			description: 'Decoded JWT header / デコードされたJWTヘッダー',
		},
		payload: {
			type: 'object',
			description: 'Decoded JWT payload / デコードされたJWTペイロード',
		},
		warnings: {
			type: 'array',
			description:
				'Validity warnings (exp/nbf) / 有効性に関する警告（exp/nbf）',
		},
	},
	annotations: { readOnlyHint: true },
	handler(input) {
		const result = decodeJwt(input.jwt);
		if (!result.valid || !result.header || !result.payload) {
			throw new Error(result.error ?? 'JWTのデコードに失敗しました。');
		}
		return {
			header: result.header.json,
			payload: result.payload.json,
			warnings: result.warnings,
		};
	},
});
