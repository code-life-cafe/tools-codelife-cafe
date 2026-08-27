// qr-encrypt.ts — 暗号化QRツールの純粋ロジック
//
// AES-256-GCM（Web Crypto API）でテキストを暗号化し、`qre1.` プレフィックス付きの
// Base64URL文字列（Envelope）に変換する。QR生成自体は既存依存の `qrcode`
// （src/lib/tools/qr-generator.ts）を、QR読み取りは既存依存の `zxing-wasm`
// （src/lib/tools/qr-reader.ts）を UI 層から利用する。ここでは暗号化・復号・
// 容量計算のみを扱い、DOM/Reactには依存しない。

export const ENVELOPE_PREFIX = 'qre1.';
export const KDF_NAME = 'PBKDF2-HMAC-SHA256';
export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;

/** 平文入力の上限（100KB）。巨大入力＋KDFによるブラウザフリーズを防ぐ。 */
export const MAX_PLAINTEXT_BYTES = 100 * 1024;

/** QRペイロードの上限（Version 40 / ECC L / Byteモードの最大容量）。 */
export const MAX_QR_PAYLOAD_BYTES = 2953;

/**
 * 実用スキャン限界の警告閾値（≒Version 25・117モジュール級）。
 * 実機検証（2026-08-27）で964Bは読み取り成功、それ以上は失敗を確認済みのため、
 * 保守的な見積もりとして1,300Bを超過した時点で警告する。
 */
export const PRACTICAL_SCAN_WARNING_BYTES = 1300;

/** ペイロードが実用スキャン限界の警告閾値を超えているか判定する。 */
export function isPracticalScanWarning(payloadBytes: number): boolean {
	return payloadBytes > PRACTICAL_SCAN_WARNING_BYTES;
}

export type CompressionMode = 'deflate-raw' | 'none';

export interface EnvelopeV1 {
	version: 1;
	kdf: typeof KDF_NAME;
	iterations: number;
	compression: CompressionMode;
	salt: string;
	iv: string;
	ciphertext: string;
}

// --- Base64URL ---

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
	const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

// --- 圧縮（ネイティブ CompressionStream / DecompressionStream。新規外部依存なし） ---

export function isCompressionSupported(): boolean {
	return (
		typeof CompressionStream !== 'undefined' &&
		typeof DecompressionStream !== 'undefined'
	);
}

async function runStream(
	stream: {
		writable: WritableStream<BufferSource>;
		readable: ReadableStream<Uint8Array>;
	},
	input: Uint8Array,
): Promise<Uint8Array> {
	const writer = stream.writable.getWriter();
	writer.write(input as BufferSource);
	writer.close();
	const response = new Response(stream.readable);
	const buffer = await response.arrayBuffer();
	return new Uint8Array(buffer);
}

async function compressBytes(
	bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; compression: CompressionMode }> {
	if (!isCompressionSupported()) {
		return { bytes, compression: 'none' };
	}
	try {
		const compressed = await runStream(
			new CompressionStream('deflate-raw'),
			bytes,
		);
		return { bytes: compressed, compression: 'deflate-raw' };
	} catch {
		return { bytes, compression: 'none' };
	}
}

async function decompressBytes(
	bytes: Uint8Array,
	compression: CompressionMode,
): Promise<Uint8Array> {
	if (compression === 'none') return bytes;
	if (!isCompressionSupported()) {
		throw new Error('decompression-unsupported');
	}
	return runStream(new DecompressionStream('deflate-raw'), bytes);
}

// --- KDF / AES-GCM ---

async function deriveKey(
	passphrase: string,
	salt: Uint8Array,
	iterations: number,
): Promise<CryptoKey> {
	const baseKey = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(passphrase) as BufferSource,
		'PBKDF2',
		false,
		['deriveKey'],
	);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

function buildEnvelopeString(envelope: EnvelopeV1): string {
	return (
		ENVELOPE_PREFIX +
		base64UrlEncode(new TextEncoder().encode(JSON.stringify(envelope)))
	);
}

// --- 容量計算 ---

export interface CapacityInfo {
	payloadBytes: number;
	limitBytes: number;
	usedRatio: number;
	withinLimit: boolean;
	remainingBytes: number;
	practicalScanWarning: boolean;
}

function toCapacityInfo(payloadBytes: number): CapacityInfo {
	return {
		payloadBytes,
		limitBytes: MAX_QR_PAYLOAD_BYTES,
		usedRatio: payloadBytes / MAX_QR_PAYLOAD_BYTES,
		withinLimit: payloadBytes <= MAX_QR_PAYLOAD_BYTES,
		remainingBytes: MAX_QR_PAYLOAD_BYTES - payloadBytes,
		practicalScanWarning: isPracticalScanWarning(payloadBytes),
	};
}

export interface CapacityEstimate extends CapacityInfo {
	compressionUsed: boolean;
}

/**
 * 実際の暗号化（PBKDF2）を行わずに最終QRペイロードのバイト数を見積もる。
 * AES-GCMの暗号文長は平文（圧縮後）長 + 16バイト（認証タグ）で決定的なため、
 * salt/iv/ciphertextをゼロ埋めダミーに差し替えてもBase64URL長は実値と一致する。
 * リアルタイムの使用量メーター表示（毎入力でのKDF実行を避ける）に使う。
 */
export async function estimateCapacity(
	plaintext: string,
): Promise<CapacityEstimate> {
	if (!plaintext) {
		return { ...toCapacityInfo(0), compressionUsed: false };
	}
	const plaintextBytes = new TextEncoder().encode(plaintext);
	const { bytes: compressed, compression } =
		await compressBytes(plaintextBytes);
	const ciphertextLength = compressed.length + GCM_TAG_BYTES;
	const probe: EnvelopeV1 = {
		version: 1,
		kdf: KDF_NAME,
		iterations: PBKDF2_ITERATIONS,
		compression,
		salt: base64UrlEncode(new Uint8Array(SALT_BYTES)),
		iv: base64UrlEncode(new Uint8Array(IV_BYTES)),
		ciphertext: base64UrlEncode(new Uint8Array(ciphertextLength)),
	};
	const payloadBytes = buildEnvelopeString(probe).length;
	return {
		...toCapacityInfo(payloadBytes),
		compressionUsed: compression === 'deflate-raw',
	};
}

// --- パスフレーズ強度（簡易・外部依存なし） ---

export type PassphraseStrength = 'weak' | 'medium' | 'strong';

export function estimatePassphraseStrength(
	passphrase: string,
): PassphraseStrength {
	if (passphrase.length < 8) return 'weak';
	let classCount = 0;
	if (/[a-z]/.test(passphrase)) classCount++;
	if (/[A-Z]/.test(passphrase)) classCount++;
	if (/[0-9]/.test(passphrase)) classCount++;
	if (/[^a-zA-Z0-9]/.test(passphrase)) classCount++;
	if (passphrase.length >= 12 && classCount >= 3) return 'strong';
	return 'medium';
}

// --- 暗号化 ---

export type EncryptFailureReason =
	| 'empty-plaintext'
	| 'plaintext-too-large'
	| 'payload-too-large';

export type EncryptResult =
	| {
			ok: true;
			envelope: string;
			payloadBytes: number;
			compressionUsed: boolean;
	  }
	| {
			ok: false;
			reason: EncryptFailureReason;
			payloadBytes?: number;
	  };

export async function encryptToQrPayload(
	plaintext: string,
	passphrase: string,
): Promise<EncryptResult> {
	if (!plaintext) {
		return { ok: false, reason: 'empty-plaintext' };
	}
	const plaintextBytes = new TextEncoder().encode(plaintext);
	if (plaintextBytes.length > MAX_PLAINTEXT_BYTES) {
		return { ok: false, reason: 'plaintext-too-large' };
	}

	const { bytes: compressed, compression } =
		await compressBytes(plaintextBytes);

	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
	const ciphertextBuffer = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource },
		key,
		compressed as BufferSource,
	);

	const envelope: EnvelopeV1 = {
		version: 1,
		kdf: KDF_NAME,
		iterations: PBKDF2_ITERATIONS,
		compression,
		salt: base64UrlEncode(salt),
		iv: base64UrlEncode(iv),
		ciphertext: base64UrlEncode(new Uint8Array(ciphertextBuffer)),
	};

	const envelopeString = buildEnvelopeString(envelope);
	const payloadBytes = envelopeString.length;
	if (payloadBytes > MAX_QR_PAYLOAD_BYTES) {
		return { ok: false, reason: 'payload-too-large', payloadBytes };
	}

	return {
		ok: true,
		envelope: envelopeString,
		payloadBytes,
		compressionUsed: compression === 'deflate-raw',
	};
}

// --- 復号 ---

export type DecodeFailureReason =
	| 'invalid-format'
	| 'unsupported-version'
	| 'unsupported-kdf';

export type DecryptFailureReason =
	| DecodeFailureReason
	| 'invalid-passphrase-or-corrupted';

export type DecodedEnvelope =
	| { ok: true; envelope: EnvelopeV1 }
	| { ok: false; reason: DecodeFailureReason };

function isEnvelopeShape(value: unknown): value is Record<string, unknown> & {
	version: unknown;
	kdf: unknown;
	iterations: unknown;
	compression: unknown;
	salt: unknown;
	iv: unknown;
	ciphertext: unknown;
} {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.iterations === 'number' &&
		typeof v.salt === 'string' &&
		typeof v.iv === 'string' &&
		typeof v.ciphertext === 'string' &&
		typeof v.kdf === 'string' &&
		(v.compression === 'deflate-raw' || v.compression === 'none')
	);
}

/**
 * QRペイロード文字列をデコードしてEnvelopeを取り出す（暗号処理は行わない）。
 * `qre1.` プレフィックス・Base64URL/JSON構造・version/kdfを検証する。
 */
export function decodeQrPayload(raw: string): DecodedEnvelope {
	if (!raw.startsWith(ENVELOPE_PREFIX)) {
		return { ok: false, reason: 'invalid-format' };
	}
	let parsed: unknown;
	try {
		const jsonBytes = base64UrlDecode(raw.slice(ENVELOPE_PREFIX.length));
		parsed = JSON.parse(new TextDecoder().decode(jsonBytes));
	} catch {
		return { ok: false, reason: 'invalid-format' };
	}
	if (!isEnvelopeShape(parsed)) {
		return { ok: false, reason: 'invalid-format' };
	}
	if (parsed.version !== 1) {
		return { ok: false, reason: 'unsupported-version' };
	}
	if (parsed.kdf !== KDF_NAME) {
		return { ok: false, reason: 'unsupported-kdf' };
	}
	return {
		ok: true,
		envelope: {
			version: 1,
			kdf: KDF_NAME,
			iterations: parsed.iterations as number,
			compression: parsed.compression as CompressionMode,
			salt: parsed.salt as string,
			iv: parsed.iv as string,
			ciphertext: parsed.ciphertext as string,
		},
	};
}

export type DecryptResult =
	| { ok: true; plaintext: string }
	| { ok: false; reason: DecryptFailureReason };

/**
 * QRペイロード文字列をパスフレーズで復号する。
 * パスフレーズ誤り・ciphertext改ざん（GCM認証タグ不一致）はいずれも
 * `invalid-passphrase-or-corrupted` に集約し、原因を特定させない。
 */
export async function decryptQrPayload(
	raw: string,
	passphrase: string,
): Promise<DecryptResult> {
	const decoded = decodeQrPayload(raw);
	if (!decoded.ok) {
		return { ok: false, reason: decoded.reason };
	}
	const { envelope } = decoded;

	let salt: Uint8Array;
	let iv: Uint8Array;
	let ciphertext: Uint8Array;
	try {
		salt = base64UrlDecode(envelope.salt);
		iv = base64UrlDecode(envelope.iv);
		ciphertext = base64UrlDecode(envelope.ciphertext);
	} catch {
		return { ok: false, reason: 'invalid-format' };
	}

	try {
		const key = await deriveKey(passphrase, salt, envelope.iterations);
		const plainBuffer = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: iv as BufferSource },
			key,
			ciphertext as BufferSource,
		);
		const decompressed = await decompressBytes(
			new Uint8Array(plainBuffer),
			envelope.compression,
		);
		return { ok: true, plaintext: new TextDecoder().decode(decompressed) };
	} catch {
		return { ok: false, reason: 'invalid-passphrase-or-corrupted' };
	}
}
