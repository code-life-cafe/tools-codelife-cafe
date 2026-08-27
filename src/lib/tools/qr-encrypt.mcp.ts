import { defineMcpTool } from '../webmcp/define-tool.ts';
import { decryptQrPayload, encryptToQrPayload } from './qr-encrypt.ts';

const ACTIONS = ['encrypt', 'decrypt'] as const;
type Action = (typeof ACTIONS)[number];

interface QrEncryptMcpInput {
	action: Action;
	/** action: 'encrypt' の場合は平文、'decrypt' の場合は `qre1.` から始まるペイロード文字列 */
	text: string;
	passphrase: string;
}

interface QrEncryptMcpOutput {
	/** action: 'encrypt' の場合は `qre1.` ペイロード文字列（QR画像化前）、'decrypt' の場合は復号された平文 */
	result: string;
}

export const qrEncryptMcpTool = defineMcpTool<
	QrEncryptMcpInput,
	QrEncryptMcpOutput
>({
	toolId: 'qr-encrypt',
	name: 'encrypt_decrypt_qr_payload',
	description:
		'Encrypt text into a passphrase-protected QR payload string (AES-256-GCM), or decrypt such a payload back to text. Runs entirely in the browser; no data is sent externally. QR image rendering/scanning is not covered by this tool. / パスフレーズ保護された暗号化QRペイロード文字列（AES-256-GCM）へのテキスト暗号化、またはその復号を行う。処理はブラウザ内で完結し、外部送信は行わない。QR画像の生成・読み取り自体は対象外。',
	params: {
		action: {
			type: 'string',
			enum: ACTIONS,
			description: 'encrypt or decrypt / 暗号化または復号',
		},
		text: {
			type: 'string',
			description:
				'Plaintext to encrypt, or a qre1. payload string to decrypt / 暗号化する平文、または復号するqre1.ペイロード文字列',
		},
		passphrase: {
			type: 'string',
			description:
				'Shared passphrase used for key derivation / 鍵導出に使う共有パスフレーズ',
		},
	},
	returns: {
		result: {
			type: 'string',
			description:
				'Encrypted qre1. payload string, or decrypted plaintext / 暗号化されたqre1.ペイロード文字列、または復号された平文',
		},
	},
	annotations: { readOnlyHint: false },
	async handler(input) {
		if (input.action === 'encrypt') {
			const result = await encryptToQrPayload(input.text, input.passphrase);
			if (!result.ok) {
				throw new Error(`QR暗号化に失敗しました (${result.reason})`);
			}
			return { result: result.envelope };
		}
		const result = await decryptQrPayload(input.text, input.passphrase);
		if (!result.ok) {
			throw new Error(`QR復号に失敗しました (${result.reason})`);
		}
		return { result: result.plaintext };
	},
});
