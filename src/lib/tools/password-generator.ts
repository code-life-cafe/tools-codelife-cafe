/**
 * パスワード生成・強度チェックの純粋ロジック。
 * 乱数源は引数で差し替えられる（既定は crypto.getRandomValues）。
 * 生成したパスワード・入力されたパスワードは、この関数群の外へ保存・送信しない。
 */

export const CHARSET_KEYS = ['upper', 'lower', 'digits', 'symbols'] as const;
export type CharsetKey = (typeof CHARSET_KEYS)[number];

export const CHARSETS: Record<CharsetKey, string> = {
	upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	lower: 'abcdefghijklmnopqrstuvwxyz',
	digits: '0123456789',
	symbols: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
};

export const CHARSET_LABELS: Record<CharsetKey, string> = {
	upper: '英大文字（A-Z）',
	lower: '英小文字（a-z）',
	digits: '数字（0-9）',
	symbols: '記号（!#$%など）',
};

/** 見間違えやすい文字（数字の0と英字のO、1とlとI など） */
export const AMBIGUOUS_CHARS = '0Oo1lI|';

export const MIN_LENGTH = 4;
export const MAX_LENGTH = 128;
export const MIN_COUNT = 1;
export const MAX_COUNT = 20;

/** 必須文字種を満たすまでの再抽選の上限（長さ4・4文字種でも失敗確率は無視できる） */
const MAX_ATTEMPTS = 1000;

export interface PasswordOptions {
	length: number;
	count: number;
	upper: boolean;
	lower: boolean;
	digits: boolean;
	symbols: boolean;
	excludeAmbiguous: boolean;
	/** 選んだ文字種をそれぞれ1文字以上含める */
	requireEach: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
	length: 16,
	count: 5,
	upper: true,
	lower: true,
	digits: true,
	symbols: true,
	excludeAmbiguous: false,
	requireEach: true,
};

/** 32ビットの乱数で配列を埋める関数 */
export type RandomSource = (array: Uint32Array<ArrayBuffer>) => void;

const defaultRandomSource: RandomSource = (array) => {
	crypto.getRandomValues(array);
};

/** 選択された文字種ごとの文字集合（紛らわしい文字の除外を反映）。空の集合は含めない */
export function buildCharsetPools(options: PasswordOptions): string[] {
	const pools: string[] = [];
	for (const key of CHARSET_KEYS) {
		if (!options[key]) continue;
		let chars = CHARSETS[key];
		if (options.excludeAmbiguous) {
			chars = [...chars].filter((c) => !AMBIGUOUS_CHARS.includes(c)).join('');
		}
		if (chars.length > 0) pools.push(chars);
	}
	return pools;
}

function isIntegerInRange(value: number, min: number, max: number): boolean {
	return Number.isInteger(value) && value >= min && value <= max;
}

/** 設定の検証。問題がなければ null、あれば日本語のエラーメッセージ */
export function validatePasswordOptions(
	options: PasswordOptions,
): string | null {
	if (!isIntegerInRange(options.length, MIN_LENGTH, MAX_LENGTH)) {
		return `長さは${MIN_LENGTH}〜${MAX_LENGTH}の整数で指定してください。`;
	}
	if (!isIntegerInRange(options.count, MIN_COUNT, MAX_COUNT)) {
		return `生成件数は${MIN_COUNT}〜${MAX_COUNT}の整数で指定してください。`;
	}
	const pools = buildCharsetPools(options);
	if (pools.length === 0) {
		return '使う文字の種類を1つ以上選んでください。';
	}
	if (options.requireEach && options.length < pools.length) {
		return `選んだ文字種をすべて含めるには、長さを${pools.length}以上にしてください。`;
	}
	return null;
}

/**
 * 0以上 n 未満の整数を偏りなく選ぶ（棄却サンプリング）。
 * 2^32 を n で割り切れない端数の範囲に入った乱数は捨てて引き直す。
 */
export function randomIndex(n: number, random: RandomSource): number {
	if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) {
		throw new RangeError('n は 1 以上 2^32 以下の整数で指定してください。');
	}
	const limit = Math.floor(2 ** 32 / n) * n;
	const buffer = new Uint32Array(1);
	for (;;) {
		random(buffer);
		const value = buffer[0];
		if (value < limit) return value % n;
	}
}

/** パスワードを1件生成する。設定が不正なら例外 */
export function generatePassword(
	options: PasswordOptions,
	random: RandomSource = defaultRandomSource,
): string {
	const error = validatePasswordOptions(options);
	if (error) throw new Error(error);
	const pools = buildCharsetPools(options);
	const alphabet = [...pools.join('')];
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		let password = '';
		for (let i = 0; i < options.length; i++) {
			password += alphabet[randomIndex(alphabet.length, random)];
		}
		// 条件を満たさない結果は捨てて引き直す（位置の偏りを作らない）
		if (
			!options.requireEach ||
			pools.every((pool) => [...password].some((c) => pool.includes(c)))
		) {
			return password;
		}
	}
	throw new Error('パスワードを生成できませんでした。設定を見直してください。');
}

export type GenerateResult =
	| { ok: true; passwords: string[] }
	| { ok: false; error: string };

/** 設定に従ってパスワードを件数分生成する */
export function generatePasswords(
	options: PasswordOptions,
	random: RandomSource = defaultRandomSource,
): GenerateResult {
	const error = validatePasswordOptions(options);
	if (error) return { ok: false, error };
	const passwords: string[] = [];
	for (let i = 0; i < options.count; i++) {
		passwords.push(generatePassword(options, random));
	}
	return { ok: true, passwords };
}

/** 生成設定のエントロピー（ビット）の目安。文字集合の大きさと長さから計算する */
export function estimateGeneratedEntropy(options: PasswordOptions): number {
	const size = buildCharsetPools(options).join('').length;
	if (size === 0 || options.length <= 0) return 0;
	return options.length * Math.log2(size);
}

// --- 強度チェック ---

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export const STRENGTH_LABELS: Record<StrengthLevel, string> = {
	0: 'とても弱い',
	1: '弱い',
	2: '普通',
	3: '強い',
	4: 'とても強い',
};

/** エントロピー（ビット）から段階を決める境界。28 / 36 / 60 / 128 ビット */
export function strengthLevelFromBits(bits: number): StrengthLevel {
	if (bits < 28) return 0;
	if (bits < 36) return 1;
	if (bits < 60) return 2;
	if (bits < 128) return 3;
	return 4;
}

export type StrengthWarning =
	| 'common'
	| 'all-same'
	| 'repeat'
	| 'sequence'
	| 'keyboard'
	| 'short'
	| 'single-type';

export const STRENGTH_WARNING_MESSAGES: Record<StrengthWarning, string> = {
	common:
		'よく使われるパスワードと一致します。攻撃者が最初に試すため、すぐに破られます。',
	'all-same': '同じ文字だけでできています。',
	repeat: '同じ文字が3回以上続く部分があります。',
	sequence: '「abcd」「1234」のような連続した並びがあります。',
	keyboard: '「qwer」「asdf」のようなキーボードの並びがあります。',
	short: '8文字未満です。長さを増やすのが最も効果的です。',
	'single-type': '1種類の文字だけでできています。',
};

/** 漏えい一覧で上位に出るパスワード（小文字で比較する）。網羅ではなく代表例 */
const COMMON_PASSWORDS = new Set([
	'123456',
	'1234567',
	'12345678',
	'123456789',
	'1234567890',
	'111111',
	'000000',
	'123123',
	'654321',
	'password',
	'password1',
	'password123',
	'passw0rd',
	'p@ssw0rd',
	'qwerty',
	'qwerty123',
	'qwertyuiop',
	'1q2w3e4r',
	'1qaz2wsx',
	'zaq12wsx',
	'abc123',
	'admin',
	'administrator',
	'root',
	'letmein',
	'welcome',
	'iloveyou',
	'monkey',
	'dragon',
	'football',
	'baseball',
	'sunshine',
	'princess',
	'master',
	'login',
	'test',
	'guest',
]);

// 数字の横並びは連続した並び（sequence）として検出する
const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const PATTERN_RUN = 4;

/** 文字列中に、コードポイントが1ずつ増える（または減る）並びが PATTERN_RUN 文字以上あるか */
function hasSequence(chars: string[]): boolean {
	let up = 1;
	let down = 1;
	for (let i = 1; i < chars.length; i++) {
		const diff =
			(chars[i].toLowerCase().codePointAt(0) ?? 0) -
			(chars[i - 1].toLowerCase().codePointAt(0) ?? 0);
		up = diff === 1 ? up + 1 : 1;
		down = diff === -1 ? down + 1 : 1;
		if (up >= PATTERN_RUN || down >= PATTERN_RUN) return true;
	}
	return false;
}

/** キーボードの横並び（逆順を含む）が PATTERN_RUN 文字以上あるか */
function hasKeyboardPattern(password: string): boolean {
	const lower = password.toLowerCase();
	for (const row of KEYBOARD_ROWS) {
		const reversed = [...row].reverse().join('');
		for (let i = 0; i + PATTERN_RUN <= row.length; i++) {
			if (
				lower.includes(row.slice(i, i + PATTERN_RUN)) ||
				lower.includes(reversed.slice(i, i + PATTERN_RUN))
			) {
				return true;
			}
		}
	}
	return false;
}

/** 入力に含まれる文字の種類から、攻撃者が想定する文字集合の大きさを推定する */
export function estimateCharsetSize(password: string): number {
	let size = 0;
	if (/[a-z]/.test(password)) size += 26;
	if (/[A-Z]/.test(password)) size += 26;
	if (/[0-9]/.test(password)) size += 10;
	// 空白を含むASCII記号（33文字）
	if (/[ -/:-@[-`{-~]/.test(password)) size += 33;
	// ASCII外（全角文字・かな・絵文字など）。大きめの集合として扱う目安
	if (/[^\x20-\x7e]/u.test(password)) size += 100;
	return size;
}

function countCharTypes(password: string): number {
	return [/[a-z]/, /[A-Z]/, /[0-9]/, /[ -/:-@[-`{-~]/, /[^\x20-\x7e]/u].filter(
		(re) => re.test(password),
	).length;
}

export interface StrengthResult {
	/** 文字数（コードポイント単位） */
	length: number;
	/** 推定した文字集合の大きさ */
	charsetSize: number;
	/** 文字集合と長さから計算したエントロピー（ビット） */
	bits: number;
	/** 警告を反映した段階 */
	level: StrengthLevel;
	warnings: StrengthWarning[];
}

/**
 * パスワードの強度の目安を返す。空文字なら null。
 * エントロピーは「文字種×長さ」による推定で、辞書攻撃への耐性は保証しない。
 * よく使われるパスワード・同じ文字だけの場合は「とても弱い」、
 * 繰り返し・連続・キーボードの並びがある場合は1段階下げる。
 */
export function checkPasswordStrength(password: string): StrengthResult | null {
	if (password === '') return null;
	const chars = [...password];
	const length = chars.length;
	const charsetSize = estimateCharsetSize(password);
	const bits = length * Math.log2(charsetSize);
	const warnings: StrengthWarning[] = [];

	const isCommon = COMMON_PASSWORDS.has(password.toLowerCase());
	const allSame = length > 1 && chars.every((c) => c === chars[0]);
	if (isCommon) warnings.push('common');
	if (allSame) warnings.push('all-same');
	else if (/(.)\1\1/u.test(password)) warnings.push('repeat');
	if (hasSequence(chars)) warnings.push('sequence');
	if (hasKeyboardPattern(password)) warnings.push('keyboard');
	if (length < 8) warnings.push('short');
	if (countCharTypes(password) === 1 && !allSame) warnings.push('single-type');

	let level = strengthLevelFromBits(bits);
	if (isCommon || allSame) {
		level = 0;
	} else if (
		warnings.includes('repeat') ||
		warnings.includes('sequence') ||
		warnings.includes('keyboard')
	) {
		level = Math.max(0, level - 1) as StrengthLevel;
	}
	return { length, charsetSize, bits, level, warnings };
}

/** 保存・共有URLから復元した設定値を検証する（範囲外・型違いは既定値に戻す） */
export function sanitizePasswordSettings(
	value: unknown,
	defaults: PasswordOptions,
): PasswordOptions {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return { ...defaults };
	}
	const v = value as Record<string, unknown>;
	const int = (raw: unknown, min: number, max: number, fallback: number) =>
		typeof raw === 'number' && isIntegerInRange(raw, min, max) ? raw : fallback;
	const bool = (raw: unknown, fallback: boolean) =>
		typeof raw === 'boolean' ? raw : fallback;
	return {
		length: int(v.length, MIN_LENGTH, MAX_LENGTH, defaults.length),
		count: int(v.count, MIN_COUNT, MAX_COUNT, defaults.count),
		upper: bool(v.upper, defaults.upper),
		lower: bool(v.lower, defaults.lower),
		digits: bool(v.digits, defaults.digits),
		symbols: bool(v.symbols, defaults.symbols),
		excludeAmbiguous: bool(v.excludeAmbiguous, defaults.excludeAmbiguous),
		requireEach: bool(v.requireEach, defaults.requireEach),
	};
}

/** まとめてコピー用に改行で連結する */
export function joinPasswordsForCopy(passwords: readonly string[]): string {
	return passwords.join('\n');
}
