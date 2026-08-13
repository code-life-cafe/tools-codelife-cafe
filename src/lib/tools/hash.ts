import {
	BYTES_PER_MB,
	FILE_SIZE_LIMITS_MB,
	HASH_HUGE_FILE_THRESHOLD_BYTES,
	HASH_LARGE_FILE_THRESHOLD_BYTES,
} from '../constants.ts';

export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512' | 'crc32';

export type HashResults = Partial<Record<HashAlgorithm, string>>;

export type HashInputValidation =
	| { ok: true; warnLevel: 'none' | 'large' | 'huge' }
	| { ok: false; reason: 'too-large-file' };

export const MAX_FILE_SIZE = FILE_SIZE_LIMITS_MB.HASH * BYTES_PER_MB;
export const LARGE_FILE_THRESHOLD = HASH_LARGE_FILE_THRESHOLD_BYTES;
export const HUGE_FILE_THRESHOLD = HASH_HUGE_FILE_THRESHOLD_BYTES;
const CHUNK_SIZE = 8 * 1024 * 1024;

export const HASH_ALGORITHMS: readonly HashAlgorithm[] = [
	'md5',
	'sha1',
	'sha256',
	'sha512',
	'crc32',
];

export const HASH_ALGORITHM_LABELS: Record<HashAlgorithm, string> = {
	md5: 'MD5',
	sha1: 'SHA-1',
	sha256: 'SHA-256',
	sha512: 'SHA-512',
	crc32: 'CRC32',
};

const SUBTLE_NAMES = {
	sha1: 'SHA-1',
	sha256: 'SHA-256',
	sha512: 'SHA-512',
} as const;

type ShaAlgorithm = keyof typeof SUBTLE_NAMES;

export function isShaAlgorithm(
	algorithm: HashAlgorithm,
): algorithm is ShaAlgorithm {
	return (
		algorithm === 'sha1' || algorithm === 'sha256' || algorithm === 'sha512'
	);
}

interface IncrementalHasher {
	update(chunk: Uint8Array): void;
	digest(): string;
}

// ---------------------------------------------------------------------------
// MD5（RFC 1321 準拠・ゼロ依存純TS実装。update/digest のインクリメンタル方式）
// ---------------------------------------------------------------------------

const MD5_K = new Int32Array(64);
for (let i = 0; i < 64; i++) {
	MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0;
}

// biome-ignore format: 4ラウンド×16のシフト量テーブル
const MD5_S = [
	7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
	5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
	4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
	6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

export function createMd5(): IncrementalHasher {
	let a = 0x67452301;
	let b = 0xefcdab89 | 0;
	let c = 0x98badcfe | 0;
	let d = 0x10325476;
	const buffer = new Uint8Array(64);
	let bufferLen = 0;
	let totalBytes = 0;
	const m = new Int32Array(16);

	function processBlock(bytes: Uint8Array, offset: number): void {
		for (let i = 0; i < 16; i++) {
			const o = offset + i * 4;
			m[i] =
				bytes[o] |
				(bytes[o + 1] << 8) |
				(bytes[o + 2] << 16) |
				(bytes[o + 3] << 24);
		}
		let x = a;
		let y = b;
		let z = c;
		let w = d;
		for (let i = 0; i < 64; i++) {
			let f: number;
			let g: number;
			if (i < 16) {
				f = (y & z) | (~y & w);
				g = i;
			} else if (i < 32) {
				f = (w & y) | (~w & z);
				g = (5 * i + 1) % 16;
			} else if (i < 48) {
				f = y ^ z ^ w;
				g = (3 * i + 5) % 16;
			} else {
				f = z ^ (y | ~w);
				g = (7 * i) % 16;
			}
			const tmp = w;
			w = z;
			z = y;
			const sum = (x + f + MD5_K[i] + m[g]) | 0;
			const s = MD5_S[i];
			y = (y + ((sum << s) | (sum >>> (32 - s)))) | 0;
			x = tmp;
		}
		a = (a + x) | 0;
		b = (b + y) | 0;
		c = (c + z) | 0;
		d = (d + w) | 0;
	}

	function update(chunk: Uint8Array): void {
		totalBytes += chunk.length;
		let offset = 0;
		if (bufferLen > 0) {
			const need = 64 - bufferLen;
			const take = Math.min(need, chunk.length);
			buffer.set(chunk.subarray(0, take), bufferLen);
			bufferLen += take;
			offset = take;
			if (bufferLen < 64) return;
			processBlock(buffer, 0);
			bufferLen = 0;
		}
		while (offset + 64 <= chunk.length) {
			processBlock(chunk, offset);
			offset += 64;
		}
		if (offset < chunk.length) {
			buffer.set(chunk.subarray(offset), 0);
			bufferLen = chunk.length - offset;
		}
	}

	function digest(): string {
		const bitLen = totalBytes * 8;
		update(new Uint8Array([0x80]));
		// update() が totalBytes を進めるためビット長は事前に確定しておく
		while (bufferLen !== 56) {
			update(new Uint8Array(1));
		}
		const lenBytes = new Uint8Array(8);
		const lo = bitLen >>> 0;
		const hi = Math.floor(bitLen / 0x100000000);
		lenBytes[0] = lo & 0xff;
		lenBytes[1] = (lo >>> 8) & 0xff;
		lenBytes[2] = (lo >>> 16) & 0xff;
		lenBytes[3] = (lo >>> 24) & 0xff;
		lenBytes[4] = hi & 0xff;
		lenBytes[5] = (hi >>> 8) & 0xff;
		lenBytes[6] = (hi >>> 16) & 0xff;
		lenBytes[7] = (hi >>> 24) & 0xff;
		update(lenBytes);
		const out = new Uint8Array(16);
		const words = [a, b, c, d];
		for (let i = 0; i < 4; i++) {
			out[i * 4] = words[i] & 0xff;
			out[i * 4 + 1] = (words[i] >>> 8) & 0xff;
			out[i * 4 + 2] = (words[i] >>> 16) & 0xff;
			out[i * 4 + 3] = (words[i] >>> 24) & 0xff;
		}
		return toHex(out);
	}

	return { update, digest };
}

// ---------------------------------------------------------------------------
// CRC32（テーブル方式・多項式 0xEDB88320）
// ---------------------------------------------------------------------------

let crc32Table: Uint32Array | null = null;

function getCrc32Table(): Uint32Array {
	if (crc32Table) return crc32Table;
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	crc32Table = table;
	return table;
}

export function createCrc32(): IncrementalHasher {
	const table = getCrc32Table();
	let crc = 0xffffffff;

	return {
		update(chunk: Uint8Array): void {
			for (let i = 0; i < chunk.length; i++) {
				crc = table[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
			}
		},
		digest(): string {
			// unsigned 32bit に正規化し、常にゼロ埋め8桁の小文字hexで返す
			return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
		},
	};
}

// ---------------------------------------------------------------------------
// 公開API
// ---------------------------------------------------------------------------

function toHex(bytes: Uint8Array): string {
	let hex = '';
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i].toString(16).padStart(2, '0');
	}
	return hex;
}

function createIncrementalHasher(
	algorithm: 'md5' | 'crc32',
): IncrementalHasher {
	return algorithm === 'md5' ? createMd5() : createCrc32();
}

async function digestSha(
	algorithm: ShaAlgorithm,
	bytes: Uint8Array,
): Promise<string> {
	const buf = await crypto.subtle.digest(
		SUBTLE_NAMES[algorithm],
		bytes as BufferSource,
	);
	return toHex(new Uint8Array(buf));
}

export async function hashText(
	text: string,
	algorithms: readonly HashAlgorithm[],
): Promise<HashResults> {
	const bytes = new TextEncoder().encode(text);
	const results: HashResults = {};
	for (const algorithm of algorithms) {
		if (isShaAlgorithm(algorithm)) {
			results[algorithm] = await digestSha(algorithm, bytes);
		} else {
			const hasher = createIncrementalHasher(algorithm);
			hasher.update(bytes);
			results[algorithm] = hasher.digest();
		}
	}
	return results;
}

export async function hashFile(
	file: File,
	algorithms: readonly HashAlgorithm[],
	onProgress?: (percent: number) => void,
	chunkSize: number = CHUNK_SIZE,
): Promise<HashResults> {
	const shaAlgorithms = algorithms.filter(isShaAlgorithm);
	const incrementalAlgorithms = algorithms.filter(
		(a): a is 'md5' | 'crc32' => a === 'md5' || a === 'crc32',
	);

	// SHA系は Web Crypto の制約上フルバッファが必要。未選択ならチャンク分のみ確保する
	let fullBuffer: Uint8Array | null = null;
	if (shaAlgorithms.length > 0 && file.size > 0) {
		try {
			fullBuffer = new Uint8Array(file.size);
		} catch (_error) {
			throw new Error(
				'メモリ不足のためハッシュを計算できませんでした。ファイルサイズを小さくするか、SHA系以外のアルゴリズムをお試しください。',
			);
		}
	}

	const hashers = incrementalAlgorithms.map((a) => ({
		algorithm: a,
		hasher: createIncrementalHasher(a),
	}));

	// 進捗の作業量モデル: 読み取り = file.size、SHA 1アルゴリズムごとに + file.size
	const totalUnits = file.size * (1 + shaAlgorithms.length);
	let doneUnits = 0;
	const reportProgress = () => {
		if (!onProgress) return;
		onProgress(
			totalUnits === 0 ? 100 : Math.min(100, (doneUnits / totalUnits) * 100),
		);
	};

	for (let offset = 0; offset < file.size; offset += chunkSize) {
		const slice = file.slice(offset, Math.min(offset + chunkSize, file.size));
		const chunk = new Uint8Array(await slice.arrayBuffer());
		for (const { hasher } of hashers) {
			hasher.update(chunk);
		}
		fullBuffer?.set(chunk, offset);
		doneUnits += chunk.length;
		reportProgress();
	}

	const results: HashResults = {};
	for (const { algorithm, hasher } of hashers) {
		results[algorithm] = hasher.digest();
	}
	for (const algorithm of shaAlgorithms) {
		results[algorithm] = await digestSha(
			algorithm,
			fullBuffer ?? new Uint8Array(0),
		);
		doneUnits += file.size;
		reportProgress();
	}

	fullBuffer = null;
	onProgress?.(100);
	return results;
}

export function validateHashFile(
	file: Pick<File, 'size'>,
): HashInputValidation {
	if (file.size > MAX_FILE_SIZE) {
		return { ok: false, reason: 'too-large-file' };
	}
	if (file.size > HUGE_FILE_THRESHOLD) {
		return { ok: true, warnLevel: 'huge' };
	}
	if (file.size > LARGE_FILE_THRESHOLD) {
		return { ok: true, warnLevel: 'large' };
	}
	return { ok: true, warnLevel: 'none' };
}

export function normalizeHash(value: string): string {
	return value.trim().replace(/[\s-]/g, '').toLowerCase();
}

export function compareHash(computed: string, expected: string): boolean {
	return normalizeHash(computed) === normalizeHash(expected);
}

export function detectAlgorithmByLength(hex: string): HashAlgorithm | null {
	const normalized = normalizeHash(hex);
	if (!/^[0-9a-f]+$/.test(normalized)) return null;
	switch (normalized.length) {
		case 8:
			return 'crc32';
		case 32:
			return 'md5';
		case 40:
			return 'sha1';
		case 64:
			return 'sha256';
		case 128:
			return 'sha512';
		default:
			return null;
	}
}
