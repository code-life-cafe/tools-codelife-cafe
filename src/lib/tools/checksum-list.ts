import {
	compareHash,
	detectAlgorithmByLength,
	type HashAlgorithm,
	type HashResults,
	normalizeHash,
	parseExpectedHash,
} from './hash.ts';

/** 一括照合で一度に選べるファイル数の上限 */
export const MAX_CHECKSUM_FILES = 100;

/** チェックサムリストの1行（解析済み） */
export interface ChecksumEntry {
	/** 入力の何行目か（1始まり） */
	lineNumber: number;
	/** リストに書かれたファイル名（パスを含む場合あり） */
	listedName: string;
	/** 照合に使うファイル名（パスの末尾） */
	baseName: string;
	algorithm: HashAlgorithm;
	/** 小文字・区切りなしに正規化したハッシュ値 */
	hash: string;
}

export type ChecksumLineErrorReason =
	| 'no-file-name'
	| 'unknown-length'
	| 'algorithm-mismatch'
	| 'invalid-line';

export interface ChecksumLineError {
	lineNumber: number;
	line: string;
	reason: ChecksumLineErrorReason;
}

export interface ParsedChecksumList {
	entries: ChecksumEntry[];
	errors: ChecksumLineError[];
}

export const CHECKSUM_LINE_ERROR_MESSAGES: Record<
	ChecksumLineErrorReason,
	string
> = {
	'no-file-name':
		'ファイル名がありません（「ハッシュ値＋空白2個＋ファイル名」の形式で書いてください）',
	'unknown-length': 'ハッシュ値の長さからアルゴリズムを判定できません',
	'algorithm-mismatch':
		'アルゴリズム名とハッシュ値の長さが一致しません（例: SHA256 なのに64桁でない）',
	'invalid-line': 'チェックサム行の形式が正しくありません',
};

// BSD形式（sha256sum --tag、shasum --tag、md5 コマンド、openssl dgst）:
// 「SHA256 (ファイル名) = ハッシュ値」。openssl は「SHA2-256(ファイル名)= ...」のように空白を省く
const BSD_CHECKSUM_LINE = /^([A-Za-z0-9-]+) ?\((.+)\) ?= ?([0-9a-fA-F]+)\s*$/;

const GNU_LIKE_PREFIX = /^\\?([0-9a-fA-F]+)(?: {2}| \*)\S/;

const BSD_ALGORITHM_NAMES: Record<string, HashAlgorithm> = {
	MD5: 'md5',
	SHA1: 'sha1',
	'SHA-1': 'sha1',
	SHA256: 'sha256',
	'SHA-256': 'sha256',
	'SHA2-256': 'sha256',
	SHA512: 'sha512',
	'SHA-512': 'sha512',
	'SHA2-512': 'sha512',
	CRC32: 'crc32',
};

/** パス区切り（/ と \）の後ろにある名前だけを返す。末尾が区切りなら元の文字列を返す */
export function checksumBaseName(listedName: string): string {
	const stripped = listedName.replace(/^\.\//, '');
	const index = Math.max(stripped.lastIndexOf('/'), stripped.lastIndexOf('\\'));
	const base = index >= 0 ? stripped.slice(index + 1) : stripped;
	return base === '' ? stripped : base;
}

type LineResult =
	| { ok: true; entry: Omit<ChecksumEntry, 'lineNumber'> }
	| { ok: false; reason: ChecksumLineErrorReason };

function parseBsdLine(line: string): LineResult | null {
	const match = BSD_CHECKSUM_LINE.exec(line);
	if (!match) return null;
	const [, name, listedName, digest] = match;
	const named = BSD_ALGORITHM_NAMES[name.toUpperCase()];
	const byLength = detectAlgorithmByLength(digest);
	if (!byLength) return { ok: false, reason: 'unknown-length' };
	// 未知のアルゴリズム名（SHA384など）や、名前と長さの食い違いは照合しない
	if (named !== byLength) return { ok: false, reason: 'algorithm-mismatch' };
	return {
		ok: true,
		entry: {
			listedName,
			baseName: checksumBaseName(listedName),
			algorithm: byLength,
			hash: normalizeHash(digest),
		},
	};
}

function parseLine(line: string): LineResult {
	const bsd = parseBsdLine(line.trim());
	if (bsd) return bsd;

	// GNU形式の区切りはあるが、ハッシュ値の長さがどのアルゴリズムにも当たらない行
	const gnuLike = GNU_LIKE_PREFIX.exec(line.trimStart());
	if (gnuLike && detectAlgorithmByLength(gnuLike[1]) == null) {
		return { ok: false, reason: 'unknown-length' };
	}

	const parsed = parseExpectedHash(line);
	if (!parsed.ok) {
		// 裸のハッシュ値として長さが合わない行（16進数だけの行）だけを長さの問題とし、
		// それ以外（文章など）は形式の誤りとして扱う
		const hexOnly = /^[0-9a-fA-F\s-]+$/.test(line.trim());
		return {
			ok: false,
			reason:
				parsed.reason === 'unknown-length' && hexOnly
					? 'unknown-length'
					: 'invalid-line',
		};
	}
	if (parsed.fileName == null) return { ok: false, reason: 'no-file-name' };
	return {
		ok: true,
		entry: {
			listedName: parsed.fileName,
			baseName: checksumBaseName(parsed.fileName),
			algorithm: parsed.algorithm,
			hash: parsed.hash,
		},
	};
}

/**
 * 複数行のチェックサムリスト（SHA256SUMS など）を解析する。
 * 空行と # で始まる行は無視し、解釈できない行は行番号付きでエラーに入れる（暗黙に捨てない）。
 */
export function parseChecksumList(input: string): ParsedChecksumList {
	const entries: ChecksumEntry[] = [];
	const errors: ChecksumLineError[] = [];
	const lines = input.split(/\r\n|\r|\n/);
	lines.forEach((line, index) => {
		const trimmed = line.trim();
		if (trimmed === '' || trimmed.startsWith('#')) return;
		const lineNumber = index + 1;
		const result = parseLine(line);
		if (result.ok) {
			entries.push({ lineNumber, ...result.entry });
		} else {
			errors.push({ lineNumber, line: trimmed, reason: result.reason });
		}
	});
	return { entries, errors };
}

/** 選択したファイル名ごとに、リストが必要とするアルゴリズムを返す */
export function requiredAlgorithmsForFile(
	entries: readonly ChecksumEntry[],
	fileName: string,
): HashAlgorithm[] {
	const set = new Set<HashAlgorithm>();
	for (const entry of entries) {
		if (entry.baseName === fileName) set.add(entry.algorithm);
	}
	return [...set];
}

export type ChecksumEntryStatus =
	| 'match'
	| 'mismatch'
	| 'missing'
	| 'duplicate-file'
	| 'pending'
	| 'failed';

export interface ChecksumEntryReport extends ChecksumEntry {
	status: ChecksumEntryStatus;
	/** 計算したハッシュ値（計算済みの場合のみ） */
	computed: string | null;
}

/** 選択したファイルの計算状態。キーはファイル名 */
export type ChecksumFileState =
	| { kind: 'pending' }
	| { kind: 'done'; results: HashResults }
	| { kind: 'failed' };

export interface ChecksumReport {
	rows: ChecksumEntryReport[];
	/** 選択したがリストに載っていないファイル名 */
	unlistedFiles: string[];
	counts: Record<ChecksumEntryStatus, number>;
}

/**
 * リストの各行を、選択したファイルの計算結果と照合する。
 * ファイル名はパスの末尾（baseName）で対応付ける。同名ファイルを複数選んだ場合は判定しない。
 */
export function buildChecksumReport(
	entries: readonly ChecksumEntry[],
	selectedFileNames: readonly string[],
	fileStates: ReadonlyMap<string, ChecksumFileState>,
): ChecksumReport {
	const nameCounts = new Map<string, number>();
	for (const name of selectedFileNames) {
		nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
	}

	const counts: Record<ChecksumEntryStatus, number> = {
		match: 0,
		mismatch: 0,
		missing: 0,
		'duplicate-file': 0,
		pending: 0,
		failed: 0,
	};

	const rows = entries.map((entry): ChecksumEntryReport => {
		const count = nameCounts.get(entry.baseName) ?? 0;
		let status: ChecksumEntryStatus;
		let computed: string | null = null;
		if (count === 0) {
			status = 'missing';
		} else if (count > 1) {
			status = 'duplicate-file';
		} else {
			const state = fileStates.get(entry.baseName);
			if (state?.kind === 'failed') {
				status = 'failed';
			} else if (state?.kind === 'done' && state.results[entry.algorithm]) {
				computed = state.results[entry.algorithm] ?? null;
				status =
					computed != null && compareHash(computed, entry.hash)
						? 'match'
						: 'mismatch';
			} else {
				status = 'pending';
			}
		}
		counts[status]++;
		return { ...entry, status, computed };
	});

	const listed = new Set(entries.map((e) => e.baseName));
	const unlistedFiles = [...new Set(selectedFileNames)].filter(
		(name) => !listed.has(name),
	);

	return { rows, unlistedFiles, counts };
}
