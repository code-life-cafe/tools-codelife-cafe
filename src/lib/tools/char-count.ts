// 文字数カウントロジック（純粋関数）
import Encoding from 'encoding-japanese';

export interface CharCountResult {
	charsWithSpaces: number;
	charsWithoutSpaces: number;
	graphemes: number;
	bytesUtf8: number;
	bytesShiftJis: number;
	unsupportedShiftJisCount: number;
	hasUnsupportedShiftJis: boolean;
	lines: number;
	manuscriptPages: number; // 原稿用紙 400字詰め
}

function getGraphemeCount(text: string): number {
	if (typeof Intl !== 'undefined' && Intl.Segmenter) {
		const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
		return Array.from(segmenter.segment(text)).length;
	}
	return [...text].length;
}

function getShiftJisDetails(text: string): {
	bytes: number;
	unsupportedCount: number;
} {
	if (!text) return { bytes: 0, unsupportedCount: 0 };

	let bytes = 0;
	let unsupportedCount = 0;

	// サロゲートペアや結合文字を考慮して文字ごとに評価
	for (const char of text) {
		const unicodeCodes = Encoding.stringToCode(char);
		const sjisBytes = Encoding.convert(unicodeCodes, {
			to: 'SJIS',
			from: 'UNICODE',
		}) as number[];

		// 元の文字が '?' でないのに SJIS 変換後が 63 ('?') になった場合は SJIS非対応
		const isOriginalQuestion = char === '?';
		const isConvertedQuestion = sjisBytes.length === 1 && sjisBytes[0] === 63;

		if (!isOriginalQuestion && isConvertedQuestion) {
			unsupportedCount++;
			// SJIS非対応文字は2バイト（代替文字扱い）または0バイトとして集計
			bytes += 0;
		} else {
			bytes += sjisBytes.length;
		}
	}

	return { bytes, unsupportedCount };
}

// UTF-8バイト数計算
function getUtf8Bytes(text: string): number {
	return new TextEncoder().encode(text).length;
}

export function countChars(text: string): CharCountResult {
	const charsWithSpaces = [...text].length;
	const charsWithoutSpaces = [...text.replace(/\s/g, '')].length;
	const graphemes = getGraphemeCount(text);
	const bytesUtf8 = getUtf8Bytes(text);
	const { bytes: bytesShiftJis, unsupportedCount: unsupportedShiftJisCount } =
		getShiftJisDetails(text);
	const lines = text === '' ? 0 : text.split('\n').length;
	const manuscriptPages = Math.ceil(charsWithSpaces / 400) || 0;

	return {
		charsWithSpaces,
		charsWithoutSpaces,
		graphemes,
		bytesUtf8,
		bytesShiftJis,
		unsupportedShiftJisCount,
		hasUnsupportedShiftJis: unsupportedShiftJisCount > 0,
		lines,
		manuscriptPages,
	};
}

// ===== SNS・SEO 文字数制限 =====
// 正本: docs/architecture.md 記載の設計書リンク先「文字数カウント: SNS・SEO文字数制限の一括表示機能追加」詳細設計書 4〜6

export type ServiceCategory = 'sns' | 'seo';
export type ServiceGroup = 'primary' | 'secondary';
export type CountMode = 'grapheme' | 'x-url-weighted';
export type LimitStatus = 'normal' | 'warning' | 'over';

export interface ServiceDefinition {
	id: string;
	label: string;
	category: ServiceCategory;
	group: ServiceGroup;
	limit: number;
	countMode: CountMode;
	note?: string;
	/** 有料プラン等での上限緩和を補足表示する場合のみ指定する（別プログレスバーは作らない） */
	premiumLimit?: number;
}

// X（旧Twitter）の実効URL換算長。公式クライアントの短縮URL仕様に合わせた固定値。
const X_URL_WEIGHT = 23;

export const SERVICE_DEFINITIONS: readonly ServiceDefinition[] = [
	{
		id: 'x',
		label: 'X',
		category: 'sns',
		group: 'primary',
		limit: 280,
		countMode: 'x-url-weighted',
		note: `URLは1件${X_URL_WEIGHT}字として換算`,
		premiumLimit: 25000,
	},
	{
		id: 'bluesky',
		label: 'Bluesky',
		category: 'sns',
		group: 'primary',
		limit: 300,
		countMode: 'grapheme',
	},
	{
		id: 'threads',
		label: 'Threads',
		category: 'sns',
		group: 'primary',
		limit: 500,
		countMode: 'grapheme',
	},
	{
		id: 'instagram',
		label: 'Instagram',
		category: 'sns',
		group: 'secondary',
		limit: 2200,
		countMode: 'grapheme',
	},
	{
		id: 'linkedin',
		label: 'LinkedIn',
		category: 'sns',
		group: 'secondary',
		limit: 3000,
		countMode: 'grapheme',
	},
	{
		id: 'seo-title',
		label: 'title',
		category: 'seo',
		group: 'primary',
		limit: 60,
		countMode: 'grapheme',
		note: '検索結果表示の目安であり、仕様上の厳密な上限ではない',
	},
	{
		id: 'seo-description',
		label: 'meta description',
		category: 'seo',
		group: 'primary',
		limit: 120,
		countMode: 'grapheme',
		note: '検索結果表示の目安であり、仕様上の厳密な上限ではない',
	},
] as const;

// URLとして扱う文字集合（RFC3986のURL構成文字を中心に、CJK文字・絵文字・空白は含めない）。
// これにより「URL直後に空白なしで日本語が続く」場合でも、URL部分だけを正しく切り出せる。
const URL_PATTERN = /https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gu;
// URL末尾に付きがちな文末記号・引用符。対応する開き括弧がある ')' は除いて保持する。
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?'"]+$/;

function stripTrailingPunctuation(url: string): string {
	let trimmed = url;
	for (;;) {
		const match = trimmed.match(TRAILING_PUNCTUATION_PATTERN);
		if (!match) return trimmed;
		trimmed = trimmed.slice(0, trimmed.length - match[0].length);
	}
}

function stripTrailingUnbalancedParen(url: string): string {
	let trimmed = url;
	while (trimmed.endsWith(')')) {
		const opens = (trimmed.match(/\(/g) ?? []).length;
		const closes = (trimmed.match(/\)/g) ?? []).length;
		if (closes <= opens) break;
		trimmed = trimmed.slice(0, -1);
	}
	return trimmed;
}

function normalizeMatchedUrl(rawMatch: string): string {
	// 括弧の対応を先に確認してから残りの記号を剥がす（例: "(https://a.com)." ）。
	let normalized = stripTrailingPunctuation(rawMatch);
	normalized = stripTrailingUnbalancedParen(normalized);
	normalized = stripTrailingPunctuation(normalized);
	return normalized;
}

/**
 * Xの実効文字数（URL以外のgrapheme数 + URL件数 × 23）を算出する。
 * URL以外の文字カウント仕様・絵文字・結合文字の扱いは既存の grapheme カウントに従う。
 */
export function getXEffectiveCount(text: string): number {
	if (!text) return 0;

	const matches = [...text.matchAll(URL_PATTERN)];
	if (matches.length === 0) {
		return getGraphemeCount(text);
	}

	let cursor = 0;
	let nonUrlText = '';
	let urlCount = 0;

	for (const match of matches) {
		const start = match.index ?? 0;
		const url = normalizeMatchedUrl(match[0]);
		if (start < cursor) continue; // 前のURLに内包された重複マッチは無視
		nonUrlText += text.slice(cursor, start);
		cursor = start + url.length;
		urlCount++;
	}
	nonUrlText += text.slice(cursor);

	return getGraphemeCount(nonUrlText) + urlCount * X_URL_WEIGHT;
}

function countForService(
	text: string,
	graphemes: number,
	def: ServiceDefinition,
): number {
	return def.countMode === 'x-url-weighted'
		? getXEffectiveCount(text)
		: graphemes;
}

export interface ServiceProgress {
	count: number;
	limit: number;
	remaining: number;
	ratio: number;
	/** 表示幅用に0〜100へクランプした百分率 */
	progress: number;
	status: LimitStatus;
	message: string;
}

function formatRemainingMessage(remaining: number): string {
	if (remaining >= 0) {
		return `残り ${remaining.toLocaleString('ja-JP')}文字`;
	}
	return `${Math.abs(remaining).toLocaleString('ja-JP')}文字オーバー`;
}

export function getServiceProgress(
	count: number,
	limit: number,
): ServiceProgress {
	const remaining = limit - count;
	const ratio = limit > 0 ? count / limit : 0;
	const progress = Math.min(100, Math.max(0, ratio * 100));
	const status: LimitStatus =
		ratio > 1 ? 'over' : ratio >= 0.8 ? 'warning' : 'normal';

	return {
		count,
		limit,
		remaining,
		ratio,
		progress,
		status,
		message: formatRemainingMessage(remaining),
	};
}

export interface ServiceCountResult
	extends ServiceDefinition,
		ServiceProgress {}

/**
 * 全サービス定義（SNS・SEO）について、現在の入力に対する文字数進捗を算出する。
 * サービス固有の条件はこの関数と `SERVICE_DEFINITIONS` に閉じ、UI側は結果を走査するだけでよい。
 */
export function getServiceCounts(text: string): ServiceCountResult[] {
	const graphemes = getGraphemeCount(text);

	return SERVICE_DEFINITIONS.map((def) => {
		const count = countForService(text, graphemes, def);
		const progress = getServiceProgress(count, def.limit);
		return { ...def, ...progress };
	});
}
