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

// SNS文字数制限チェック
export function getTwitterProgress(charCount: number): {
	percentage: number;
	remaining: number;
	isOver: boolean;
} {
	const limit = 140;
	return {
		percentage: Math.min((charCount / limit) * 100, 100),
		remaining: limit - charCount,
		isOver: charCount > limit,
	};
}
