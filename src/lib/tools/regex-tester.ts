import { getNextCodePointIndex } from '../string-utils.ts';

export interface RegexMatch {
	value: string;
	index: number;
	groups: string[];
}

export interface RegexResult {
	matches: RegexMatch[];
	error?: string;
	replacedText?: string;
	// MAX_MATCHES を超える一致が存在し、matches が打ち切られている場合 true
	truncated?: boolean;
}

const MAX_PATTERN_LENGTH = 1000;
const MAX_REPLACEMENT_LENGTH = 2000;
const VALID_FLAGS_PATTERN = /^[dgimsuvy]*$/;

// 各フラグ文字が重複していないかを検証する（例: "gg" は new RegExp で SyntaxError になる）
function hasUniqueFlags(flags: string): boolean {
	return new Set(flags).size === flags.length;
}

// u/v の排他性や実行環境の対応状況は RegExp コンストラクタで判定する（文字数上限は使わない）
function isSupportedFlags(flags: string): boolean {
	try {
		new RegExp('', flags);
		return true;
	} catch {
		return false;
	}
}

function isValidFlags(flags: string): boolean {
	return (
		VALID_FLAGS_PATTERN.test(flags) &&
		hasUniqueFlags(flags) &&
		isSupportedFlags(flags)
	);
}

const SYNTAX_ERROR_MESSAGE =
	'正規表現の構文が正しくありません。括弧や [ ]、{ } の対応、エスケープ（\\）を確認してください。';
const FLAGS_ERROR_MESSAGE =
	'フラグが正しくありません。使えるのは d g i m s u v y で、同じ文字の重複や u と v の併用はできません。';
const UNEXPECTED_ERROR_MESSAGE =
	'正規表現を評価できませんでした。パターンを見直してください。';

// ブラウザ由来の英語例外文や入力原文は表示せず、日本語の安全な通知へ変換する
export function toRegexErrorMessage(err: unknown): string {
	if (err instanceof SyntaxError) return SYNTAX_ERROR_MESSAGE;
	return UNEXPECTED_ERROR_MESSAGE;
}

export interface RegexTesterSettings {
	pattern: string;
	flags: string;
	showReplace: boolean;
	replacement: string;
}

// 共有URL/localStorage経由の復元値を検証し、不正値はデフォルトへフォールバックする
export function sanitizeRegexTesterSettings(
	value: unknown,
	defaults: RegexTesterSettings,
): RegexTesterSettings {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return defaults;
	}
	const v = value as Record<string, unknown>;
	const pattern =
		typeof v.pattern === 'string' && v.pattern.length <= MAX_PATTERN_LENGTH
			? v.pattern
			: defaults.pattern;
	const flags =
		typeof v.flags === 'string' && isValidFlags(v.flags)
			? v.flags
			: defaults.flags;
	const showReplace =
		typeof v.showReplace === 'boolean' ? v.showReplace : defaults.showReplace;
	const replacement =
		typeof v.replacement === 'string' &&
		v.replacement.length <= MAX_REPLACEMENT_LENGTH
			? v.replacement
			: defaults.replacement;
	return { pattern, flags, showReplace, replacement };
}

/**
 * localStorage と共有URLのクエリに保存してよい設定（allowlist）。
 * パターン・置換文字列は個人情報や社内の識別子を含みうるため、ここには含めない。
 */
export interface RegexTesterPersistedSettings {
	flags: string;
	showReplace: boolean;
}

export const REGEX_PERSISTED_DEFAULTS: RegexTesterPersistedSettings = {
	flags: 'g',
	showReplace: false,
};

export function sanitizeRegexTesterPersistedSettings(
	value: unknown,
	defaults: RegexTesterPersistedSettings,
): RegexTesterPersistedSettings {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return { ...defaults };
	}
	const v = value as Record<string, unknown>;
	return {
		flags:
			typeof v.flags === 'string' && isValidFlags(v.flags)
				? v.flags
				: defaults.flags,
		showReplace:
			typeof v.showReplace === 'boolean' ? v.showReplace : defaults.showReplace,
	};
}

export interface RegexSharedInputs {
	pattern: string;
	replacement: string;
}

const SHARE_FRAGMENT_KEY = 'regex';

/**
 * パターン・置換文字列を共有URLのフラグメント（#以降）へ入れる文字列を作る。
 * フラグメントはHTTPリクエストやRefererでサーバーへ送られない。
 */
export function encodeRegexShareFragment(inputs: RegexSharedInputs): string {
	const params = new URLSearchParams();
	params.set(
		SHARE_FRAGMENT_KEY,
		JSON.stringify({ p: inputs.pattern, r: inputs.replacement }),
	);
	return params.toString();
}

/** フラグメント（先頭の#の有無は問わない）から共有されたパターン・置換文字列を検証して取り出す。 */
export function decodeRegexShareFragment(
	hash: string,
): RegexSharedInputs | null {
	const raw = new URLSearchParams(hash.replace(/^#/, '')).get(
		SHARE_FRAGMENT_KEY,
	);
	if (raw === null) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object') return null;
		const { p, r } = parsed as Record<string, unknown>;
		if (typeof p !== 'string' || p.length > MAX_PATTERN_LENGTH) return null;
		const replacement =
			typeof r === 'string' && r.length <= MAX_REPLACEMENT_LENGTH ? r : '';
		return { pattern: p, replacement };
	} catch {
		return null;
	}
}

/**
 * 旧形式の共有URL（?settings= にパターンを含む）との互換のため、
 * クエリからパターン・置換文字列だけを読み出す。値が無ければ null。
 */
export function decodeLegacyRegexSettingsParam(
	settingsParam: string | null,
): Partial<RegexSharedInputs> | null {
	if (!settingsParam) return null;
	try {
		const binary = atob(settingsParam);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
		if (parsed === null || typeof parsed !== 'object') return null;
		const v = parsed as Record<string, unknown>;
		const hasPattern = typeof v.pattern === 'string';
		const hasReplacement = typeof v.replacement === 'string';
		if (!hasPattern && !hasReplacement) return null;
		const sanitized = sanitizeRegexTesterSettings(v, {
			pattern: '',
			flags: 'g',
			showReplace: false,
			replacement: '',
		});
		return {
			...(hasPattern ? { pattern: sanitized.pattern } : {}),
			...(hasReplacement ? { replacement: sanitized.replacement } : {}),
		};
	} catch {
		return null;
	}
}

export const COMMON_PATTERNS = [
	{
		label: 'メールアドレス',
		pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
		flags: 'g',
	},
	{ label: '電話番号', pattern: '0\\d{1,3}-\\d{2,4}-\\d{4}', flags: 'g' },
	{ label: '郵便番号', pattern: '\\d{3}-\\d{4}', flags: 'g' },
	{
		label: 'URL',
		pattern: "https?:\\/\\/[\\w\\-._~:/?#[\\]@!$&'()*+,;=]+",
		flags: 'g',
	},
	{
		label: '日本語のみ',
		pattern: '[\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF]+',
		flags: 'g',
	},
];

const TIMEOUT_MS = 500;
export const MAX_MATCHES = 5000;
// マッチ詳細リストの表示上限（件数表示・置換の対象範囲とは独立）
export const MAX_DISPLAY_MATCHES = 500;

/**
 * 正規表現を評価する同期純粋関数（Web Worker内およびテストで共有）
 */
export function execRegexSync(
	pattern: string,
	flags: string,
	text: string,
	replacement?: string,
): RegexResult {
	if (!pattern) return { matches: [] };
	if (!isValidFlags(flags)) {
		return { matches: [], error: FLAGS_ERROR_MESSAGE };
	}

	try {
		const regex = new RegExp(pattern, flags);
		const matches: RegexMatch[] = [];
		let truncated = false;

		if (regex.global) {
			let match: RegExpExecArray | null = regex.exec(text);
			while (match !== null) {
				// 上限件数に達した後にさらに一致がある場合のみ「打ち切り」とする
				if (matches.length >= MAX_MATCHES) {
					truncated = true;
					break;
				}
				matches.push({
					value: match[0],
					index: match.index,
					groups: match.slice(1),
				});

				if (match.index === regex.lastIndex) {
					regex.lastIndex = getNextCodePointIndex(text, regex.lastIndex);
				}

				match = regex.exec(text);
			}
		} else {
			const match = regex.exec(text);
			if (match) {
				matches.push({
					value: match[0],
					index: match.index,
					groups: match.slice(1),
				});
			}
		}

		let replacedText: string | undefined;
		if (replacement !== undefined) {
			replacedText = text.replace(regex, replacement);
		}

		return truncated
			? { matches, replacedText, truncated }
			: { matches, replacedText };
	} catch (err: unknown) {
		return { matches: [], error: toRegexErrorMessage(err) };
	}
}

export async function testRegex(
	pattern: string,
	flags: string,
	text: string,
	replacement?: string,
): Promise<RegexResult> {
	if (!pattern) return { matches: [] };

	return new Promise((resolve) => {
		const worker = new Worker(new URL('./regex-worker.ts', import.meta.url), {
			type: 'module',
		});

		const timeoutId = setTimeout(() => {
			worker.terminate();
			resolve({ matches: [], error: 'タイムアウト：正規表現が複雑すぎます' });
		}, TIMEOUT_MS);

		worker.onmessage = (event: MessageEvent<RegexResult>) => {
			clearTimeout(timeoutId);
			worker.terminate();
			resolve(event.data);
		};

		worker.onerror = () => {
			clearTimeout(timeoutId);
			worker.terminate();
			resolve({ matches: [], error: UNEXPECTED_ERROR_MESSAGE });
		};

		worker.postMessage({ pattern, flags, text, replacement });
	});
}
