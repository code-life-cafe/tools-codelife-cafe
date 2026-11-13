// hmac.ts — HMAC（鍵付きハッシュ）の計算。Web Crypto API でブラウザ内だけで処理する。
import { toHex } from '../hex.ts';

export type HmacAlgorithm = 'sha1' | 'sha256' | 'sha384' | 'sha512';

export type HmacKeyEncoding = 'utf8' | 'hex' | 'base64';

export const HMAC_ALGORITHMS: readonly HmacAlgorithm[] = [
	'sha256',
	'sha512',
	'sha384',
	'sha1',
];

export const HMAC_ALGORITHM_LABELS: Record<HmacAlgorithm, string> = {
	sha1: 'HMAC-SHA1',
	sha256: 'HMAC-SHA256',
	sha384: 'HMAC-SHA384',
	sha512: 'HMAC-SHA512',
};

export const HMAC_KEY_ENCODINGS: readonly HmacKeyEncoding[] = [
	'utf8',
	'hex',
	'base64',
];

export const HMAC_KEY_ENCODING_LABELS: Record<HmacKeyEncoding, string> = {
	utf8: 'テキスト（UTF-8）',
	hex: '16進数',
	base64: 'Base64',
};

const SUBTLE_NAMES: Record<HmacAlgorithm, string> = {
	sha1: 'SHA-1',
	sha256: 'SHA-256',
	sha384: 'SHA-384',
	sha512: 'SHA-512',
};

export type ParsedHmacKey =
	| { ok: true; bytes: Uint8Array<ArrayBuffer> }
	| { ok: false; error: string };

/** 鍵の文字列を、指定した形式のバイト列として解釈する。 */
export function parseHmacKey(
	key: string,
	encoding: HmacKeyEncoding,
): ParsedHmacKey {
	if (encoding === 'utf8') {
		return { ok: true, bytes: new TextEncoder().encode(key) };
	}
	// 16進数・Base64 は貼り付け時の空白・改行を無視する
	const compact = key.replace(/\s+/g, '');
	if (encoding === 'hex') {
		const hex = compact.replace(/^0x/i, '');
		if (!/^[0-9a-fA-F]*$/.test(hex)) {
			return {
				ok: false,
				error: '16進数の鍵に使えない文字が含まれています（0-9・a-f のみ）。',
			};
		}
		if (hex.length % 2 !== 0) {
			return {
				ok: false,
				error: '16進数の鍵は偶数桁で入力してください（1バイト＝2桁）。',
			};
		}
		const bytes = new Uint8Array(hex.length / 2);
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		}
		return { ok: true, bytes };
	}
	// Base64（URLセーフの -_ も受け付け、パディングは省略可）
	const standard = compact.replace(/-/g, '+').replace(/_/g, '/');
	if (
		!/^[A-Za-z0-9+/]*={0,2}$/.test(standard) ||
		standard.replace(/=+$/, '').length % 4 === 1
	) {
		return { ok: false, error: 'Base64の鍵として読み取れません。' };
	}
	const unpadded = standard.replace(/=+$/, '');
	const padded = unpadded + '='.repeat((4 - (unpadded.length % 4)) % 4);
	try {
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return { ok: true, bytes };
	} catch {
		return { ok: false, error: 'Base64の鍵として読み取れません。' };
	}
}

/** バイト列を標準のBase64（パディングあり）にする */
export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export interface HmacResult {
	hex: string;
	base64: string;
}

/** メッセージ（UTF-8）と鍵のバイト列から HMAC を計算する。 */
export async function computeHmac(
	message: string,
	keyBytes: Uint8Array<ArrayBuffer>,
	algorithm: HmacAlgorithm,
): Promise<HmacResult> {
	// Web Crypto は長さ0の HMAC 鍵を受け付けない。HMAC は鍵をブロック長まで
	// 0x00 で埋めるため、空の鍵は 0x00 1バイトの鍵と同じ結果になる（RFC 2104）。
	const rawKey = keyBytes.length === 0 ? new Uint8Array([0]) : keyBytes;
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		rawKey,
		{ name: 'HMAC', hash: SUBTLE_NAMES[algorithm] },
		false,
		['sign'],
	);
	const signature = new Uint8Array(
		await crypto.subtle.sign(
			'HMAC',
			cryptoKey,
			new TextEncoder().encode(message),
		),
	);
	return { hex: toHex(signature), base64: bytesToBase64(signature) };
}
