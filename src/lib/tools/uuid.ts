// UUID v4 / v7・ULID・nanoid の生成、判定、時刻抽出を行う純粋ロジック。
// 乱数源は crypto.getRandomValues() のみを使用し、Math.random() は使用しない。

export type IdKind = 'uuid-v4' | 'uuid-v7' | 'ulid' | 'nanoid';

export const ID_KIND_LABELS: Record<IdKind, string> = {
	'uuid-v4': 'UUID v4',
	'uuid-v7': 'UUID v7',
	ulid: 'ULID',
	nanoid: 'nanoid',
};

export const GENERATABLE_ID_KINDS: readonly IdKind[] = [
	'uuid-v4',
	'uuid-v7',
	'ulid',
	'nanoid',
];

export const MIN_COUNT = 1;
export const MAX_COUNT = 1000;
const CHUNK_SIZE = 200;

export function validateCount(count: number): string | null {
	if (!Number.isInteger(count) || Number.isNaN(count)) {
		return `生成件数は${MIN_COUNT}〜${MAX_COUNT}件の範囲で指定してください。`;
	}
	if (count < MIN_COUNT || count > MAX_COUNT) {
		return `生成件数は${MIN_COUNT}〜${MAX_COUNT}件の範囲で指定してください。`;
	}
	return null;
}

function getRandomBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return bytes;
}

function toHex(bytes: Uint8Array): string {
	let hex = '';
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i].toString(16).padStart(2, '0');
	}
	return hex;
}

function bytesToUuidString(bytes: Uint8Array): string {
	const hex = toHex(bytes);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// UUID v4
// ---------------------------------------------------------------------------

export function generateUuidV4(
	randomBytes: (n: number) => Uint8Array = getRandomBytes,
): string {
	if (
		randomBytes === getRandomBytes &&
		typeof crypto.randomUUID === 'function'
	) {
		return crypto.randomUUID();
	}
	const bytes = randomBytes(16);
	bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
	return bytesToUuidString(bytes);
}

// ---------------------------------------------------------------------------
// UUID v7（RFC 9562）: 48-bit unix_ts_ms + version(4bit) + rand_a(12bit) + variant(2bit) + rand_b(62bit)
// 同一ミリ秒内の単調増加は rand_a(12bit) + rand_b(62bit) = 74bit のカウンタをインクリメントして実現する。
// ---------------------------------------------------------------------------

const RAND_BITS = 74n;
const RAND_MAX = (1n << RAND_BITS) - 1n;

export type MonotonicGenerator = (
	now?: number,
	randomBytes?: (n: number) => Uint8Array,
) => string;

export function createUuidV7Generator(): MonotonicGenerator {
	let lastMs = -1;
	let lastRand = 0n;

	return (now = Date.now(), randomBytes = getRandomBytes) => {
		let ms = now;
		if (ms <= lastMs) {
			// 同一ミリ秒（または逆行）: ランダム部をインクリメントして単調性を保つ
			ms = lastMs;
			lastRand += 1n;
			if (lastRand > RAND_MAX) {
				// カウンタがオーバーフローした場合は次ミリ秒へ進めて新規乱数を採番する
				ms = lastMs + 1;
				lastRand = randomBitsFrom(randomBytes(10), RAND_BITS);
			}
		} else {
			lastRand = randomBitsFrom(randomBytes(10), RAND_BITS);
		}
		lastMs = ms;

		const randA = (lastRand >> 62n) & 0xfffn;
		const randB = lastRand & 0x3fffffffffffffn;

		const bytes = new Uint8Array(16);
		const tsBig = BigInt(ms) & 0xffffffffffffn;
		bytes[0] = Number((tsBig >> 40n) & 0xffn);
		bytes[1] = Number((tsBig >> 32n) & 0xffn);
		bytes[2] = Number((tsBig >> 24n) & 0xffn);
		bytes[3] = Number((tsBig >> 16n) & 0xffn);
		bytes[4] = Number((tsBig >> 8n) & 0xffn);
		bytes[5] = Number(tsBig & 0xffn);
		bytes[6] = Number(0x70n | ((randA >> 8n) & 0x0fn)); // version 7 + top 4 bits of rand_a
		bytes[7] = Number(randA & 0xffn);
		bytes[8] = Number(0x80n | ((randB >> 56n) & 0x3fn)); // variant 10 + top 6 bits of rand_b
		bytes[9] = Number((randB >> 48n) & 0xffn);
		bytes[10] = Number((randB >> 40n) & 0xffn);
		bytes[11] = Number((randB >> 32n) & 0xffn);
		bytes[12] = Number((randB >> 24n) & 0xffn);
		bytes[13] = Number((randB >> 16n) & 0xffn);
		bytes[14] = Number((randB >> 8n) & 0xffn);
		bytes[15] = Number(randB & 0xffn);

		return bytesToUuidString(bytes);
	};
}

function randomBitsFrom(bytes: Uint8Array, bits: bigint): bigint {
	let value = 0n;
	for (const b of bytes) {
		value = (value << 8n) | BigInt(b);
	}
	const totalBits = BigInt(bytes.length) * 8n;
	if (totalBits > bits) {
		value >>= totalBits - bits;
	}
	return value & ((1n << bits) - 1n);
}

export const generateUuidV7 = createUuidV7Generator();

// ---------------------------------------------------------------------------
// ULID: 48-bit timestamp + 80-bit randomness, Crockford Base32 26文字。
// 曖昧文字 I, L, O, U を含まない専用アルファベットを使用する。
// 同一ミリ秒内は乱数部を +1 インクリメントして単調性を保つ（オーバーフロー時は次ミリ秒へ）。
// ---------------------------------------------------------------------------

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_RAND_BITS = 80n;
const ULID_RAND_MAX = (1n << ULID_RAND_BITS) - 1n;

function encodeCrockford(value: bigint, length: number): string {
	let out = '';
	let v = value;
	for (let i = 0; i < length; i++) {
		out = CROCKFORD_ALPHABET[Number(v & 0x1fn)] + out;
		v >>= 5n;
	}
	return out;
}

function decodeCrockfordChar(char: string): number {
	return CROCKFORD_ALPHABET.indexOf(char.toUpperCase());
}

export function createUlidGenerator(): MonotonicGenerator {
	let lastMs = -1;
	let lastRand = 0n;

	return (now = Date.now(), randomBytes = getRandomBytes) => {
		let ms = now;
		if (ms <= lastMs) {
			ms = lastMs;
			lastRand += 1n;
			if (lastRand > ULID_RAND_MAX) {
				ms = lastMs + 1;
				lastRand = randomBitsFrom(randomBytes(10), ULID_RAND_BITS);
			}
		} else {
			lastRand = randomBitsFrom(randomBytes(10), ULID_RAND_BITS);
		}
		lastMs = ms;

		const tsPart = encodeCrockford(BigInt(ms) & 0xffffffffffffn, 10);
		const randPart = encodeCrockford(lastRand, 16);
		return tsPart + randPart;
	};
}

export const generateUlid = createUlidGenerator();

// ---------------------------------------------------------------------------
// nanoid: URL-safe 64文字アルファベット（2^6）を用い、1バイト=1文字でバイアスなく変換する。
// ---------------------------------------------------------------------------

const NANOID_ALPHABET =
	'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
export const NANOID_DEFAULT_SIZE = 21;

export function generateNanoid(
	size: number = NANOID_DEFAULT_SIZE,
	randomBytes: (n: number) => Uint8Array = getRandomBytes,
): string {
	const bytes = randomBytes(size);
	let out = '';
	for (let i = 0; i < size; i++) {
		out += NANOID_ALPHABET[bytes[i] & 0x3f];
	}
	return out;
}

// ---------------------------------------------------------------------------
// 表示形式変換（UUID のみ対象。内部値は常に小文字・ハイフンありで保持する）
// ---------------------------------------------------------------------------

export interface UuidDisplayOptions {
	uppercase?: boolean;
	hyphens?: boolean;
}

export function formatUuid(
	uuid: string,
	options: UuidDisplayOptions = {},
): string {
	const { uppercase = false, hyphens = true } = options;
	let out = hyphens ? uuid : uuid.replace(/-/g, '');
	if (uppercase) out = out.toUpperCase();
	return out;
}

// ---------------------------------------------------------------------------
// 判定・時刻抽出
// ---------------------------------------------------------------------------

export type DetectedKind =
	| 'uuid-v1'
	| 'uuid-v4'
	| 'uuid-v7'
	| 'uuid-other'
	| 'ulid'
	| 'unknown';

export interface DetectionResult {
	kind: DetectedKind;
	normalized: string;
}

const UUID_HEX_RE = /^[0-9a-f]{32}$/;

export function normalizeUuidInput(input: string): string | null {
	const trimmed = input.trim().toLowerCase();
	const withoutHyphens = trimmed.replace(/-/g, '');
	if (!UUID_HEX_RE.test(withoutHyphens)) return null;
	// ハイフンが元々ある場合は標準位置（8-4-4-4-12）であることを確認する
	if (trimmed.includes('-')) {
		const STANDARD_UUID_RE =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
		if (!STANDARD_UUID_RE.test(trimmed)) return null;
	}
	return withoutHyphens;
}

export function isValidUlid(input: string): boolean {
	const trimmed = input.trim().toUpperCase();
	if (trimmed.length !== 26) return false;
	for (const char of trimmed) {
		if (!CROCKFORD_ALPHABET.includes(char)) return false;
	}
	// 48bit タイムスタンプは10文字目までで表現可能な最大値が制限されるため、先頭文字は 0-7 のみ許容
	if (!'01234567'.includes(trimmed[0])) return false;
	return true;
}

export function detectIdKind(input: string): DetectionResult {
	const uuidHex = normalizeUuidInput(input);
	if (uuidHex) {
		const version = uuidHex[12];
		const variantNibble = Number.parseInt(uuidHex[16], 16);
		const isRfcVariant = variantNibble >= 8 && variantNibble <= 0xb;
		const normalized = bytesToUuidString(hexToBytes(uuidHex));
		if (isRfcVariant && version === '1') {
			return { kind: 'uuid-v1', normalized };
		}
		if (isRfcVariant && version === '4') {
			return { kind: 'uuid-v4', normalized };
		}
		if (isRfcVariant && version === '7') {
			return { kind: 'uuid-v7', normalized };
		}
		return { kind: 'uuid-other', normalized };
	}
	if (isValidUlid(input)) {
		return { kind: 'ulid', normalized: input.trim().toUpperCase() };
	}
	return { kind: 'unknown', normalized: input.trim() };
}

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

export type TimestampExtraction =
	| { ok: true; date: Date; iso: string }
	| { ok: false; reason: string };

// Gregorian暦の開始（1582-10-15）から UNIX epoch（1970-01-01）までの100ナノ秒間隔数
const GREGORIAN_OFFSET_100NS = 122192928000000000n;

export function extractUuidV1Timestamp(input: string): TimestampExtraction {
	const uuidHex = normalizeUuidInput(input);
	if (uuidHex?.[12] !== '1') {
		return { ok: false, reason: 'UUID v1 として解釈できません。' };
	}
	const timeLow = uuidHex.slice(0, 8);
	const timeMid = uuidHex.slice(8, 12);
	const timeHi = uuidHex.slice(13, 16); // version nibble(1文字) を除いた下位12bit
	const timestamp100ns =
		(BigInt(`0x${timeHi}`) << 48n) |
		(BigInt(`0x${timeMid}`) << 32n) |
		BigInt(`0x${timeLow}`);

	const unixMs100ns = timestamp100ns - GREGORIAN_OFFSET_100NS;
	if (unixMs100ns < 0n) {
		return {
			ok: false,
			reason: 'UNIXエポックより前の日時のため表示できません。',
		};
	}
	const unixMs = unixMs100ns / 10000n;
	if (unixMs > BigInt(Number.MAX_SAFE_INTEGER)) {
		return { ok: false, reason: '日時が有効な範囲を超えています。' };
	}
	const date = new Date(Number(unixMs));
	if (Number.isNaN(date.getTime())) {
		return { ok: false, reason: '日時が有効な範囲を超えています。' };
	}
	return { ok: true, date, iso: date.toISOString() };
}

export function extractUuidV7Timestamp(input: string): TimestampExtraction {
	const uuidHex = normalizeUuidInput(input);
	if (uuidHex?.[12] !== '7') {
		return { ok: false, reason: 'UUID v7 として解釈できません。' };
	}
	const ms = Number.parseInt(uuidHex.slice(0, 12), 16);
	const date = new Date(ms);
	if (Number.isNaN(date.getTime())) {
		return { ok: false, reason: '日時が有効な範囲を超えています。' };
	}
	return { ok: true, date, iso: date.toISOString() };
}

export function extractUlidTimestamp(input: string): TimestampExtraction {
	if (!isValidUlid(input)) {
		return { ok: false, reason: 'ULID として解釈できません。' };
	}
	const trimmed = input.trim().toUpperCase();
	let ms = 0n;
	for (let i = 0; i < 10; i++) {
		const value = decodeCrockfordChar(trimmed[i]);
		if (value < 0) {
			return { ok: false, reason: 'ULID として解釈できません。' };
		}
		ms = (ms << 5n) | BigInt(value);
	}
	if (ms > BigInt(Number.MAX_SAFE_INTEGER)) {
		return { ok: false, reason: '日時が有効な範囲を超えています。' };
	}
	const date = new Date(Number(ms));
	if (Number.isNaN(date.getTime())) {
		return { ok: false, reason: '日時が有効な範囲を超えています。' };
	}
	return { ok: true, date, iso: date.toISOString() };
}

// ---------------------------------------------------------------------------
// 一括生成（同期版・テスト用途）
// ---------------------------------------------------------------------------

export interface BatchOptions {
	nanoidSize?: number;
}

export function generateIds(
	kind: IdKind,
	count: number,
	options: BatchOptions = {},
): string[] {
	const validationError = validateCount(count);
	if (validationError) throw new Error(validationError);

	const result: string[] = [];
	if (kind === 'uuid-v4') {
		for (let i = 0; i < count; i++) result.push(generateUuidV4());
	} else if (kind === 'uuid-v7') {
		const gen = createUuidV7Generator();
		for (let i = 0; i < count; i++) result.push(gen());
	} else if (kind === 'ulid') {
		const gen = createUlidGenerator();
		for (let i = 0; i < count; i++) result.push(gen());
	} else {
		for (let i = 0; i < count; i++) {
			result.push(generateNanoid(options.nanoidSize ?? NANOID_DEFAULT_SIZE));
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// 一括生成（非同期・チャンク分割版）: UI からの大量生成時にメインスレッドを長時間占有しないよう、
// CHUNK_SIZE 件ごとにイベントループへ制御を戻す。
// ---------------------------------------------------------------------------

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function generateIdsChunked(
	kind: IdKind,
	count: number,
	options: BatchOptions = {},
	onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
	const validationError = validateCount(count);
	if (validationError) throw new Error(validationError);

	const result: string[] = [];
	const v7Gen = kind === 'uuid-v7' ? createUuidV7Generator() : null;
	const ulidGen = kind === 'ulid' ? createUlidGenerator() : null;

	for (let i = 0; i < count; i++) {
		if (kind === 'uuid-v4') {
			result.push(generateUuidV4());
		} else if (kind === 'uuid-v7' && v7Gen) {
			result.push(v7Gen());
		} else if (kind === 'ulid' && ulidGen) {
			result.push(ulidGen());
		} else {
			result.push(generateNanoid(options.nanoidSize ?? NANOID_DEFAULT_SIZE));
		}

		if ((i + 1) % CHUNK_SIZE === 0) {
			onProgress?.(i + 1, count);
			await yieldToEventLoop();
		}
	}
	onProgress?.(count, count);
	return result;
}

export function joinIdsForCopy(ids: readonly string[]): string {
	return ids.join('\n');
}
