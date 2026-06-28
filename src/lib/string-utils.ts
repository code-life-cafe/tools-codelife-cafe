/**
 * コードポイント安全な文字列ユーティリティ
 * サロゲートペアやUnicode Code Point / Grapheme Cluster を安全に扱う共通関数群
 */

/**
 * 指定位置からサロゲートペアを考慮して次のコードポイントのインデックスを返す
 */
export function getNextCodePointIndex(str: string, index: number): number {
	if (index >= str.length) return index + 1;
	const code = str.charCodeAt(index);
	// High surrogate (0xD800 - 0xDBFF)
	if (code >= 0xd800 && code <= 0xdbff && index + 1 < str.length) {
		const nextCode = str.charCodeAt(index + 1);
		// Low surrogate (0xDC00 - 0xDFFF)
		if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
			return index + 2;
		}
	}
	return index + 1;
}

/**
 * 文字列をコードポイントの配列に分解する
 */
export function getCodePoints(str: string): number[] {
	const codePoints: number[] = [];
	for (const char of str) {
		const cp = char.codePointAt(0);
		if (cp !== undefined) {
			codePoints.push(cp);
		}
	}
	return codePoints;
}

/**
 * コードポイント配列から文字列を復元する
 */
export function fromCodePoints(codePoints: number[]): string {
	return String.fromCodePoint(...codePoints);
}

/**
 * 文字列をユニコードエスケープシーケンスに変換する
 */
export function escapeUnicode(str: string, useCodePointSyntax = false): string {
	if (!str) return '';

	let result = '';
	for (const char of str) {
		const codePoint = char.codePointAt(0);
		if (codePoint === undefined) continue;

		if (useCodePointSyntax) {
			const hex = codePoint.toString(16).toUpperCase();
			result += `\\u{${hex}}`;
		} else {
			if (codePoint > 0xffff) {
				const high = Math.floor((codePoint - 0x10000) / 0x400) + 0xd800;
				const low = ((codePoint - 0x10000) % 0x400) + 0xdc00;
				const hexHigh = high.toString(16).padStart(4, '0');
				const hexLow = low.toString(16).padStart(4, '0');
				result += `\\u${hexHigh}\\u${hexLow}`;
			} else {
				const hex = codePoint.toString(16).padStart(4, '0');
				result += `\\u${hex}`;
			}
		}
	}
	return result;
}

/**
 * ユニコードエスケープシーケンスを解読・デコードする
 */
export function unescapeUnicode(unicodeStr: string): string {
	if (!unicodeStr) return '';

	return unicodeStr.replace(
		/\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/g,
		(_, hexCodePoint, hexCodeUnit) => {
			if (hexCodePoint) {
				const cp = parseInt(hexCodePoint, 16);
				return String.fromCodePoint(cp);
			}
			if (hexCodeUnit) {
				const cu = parseInt(hexCodeUnit, 16);
				return String.fromCharCode(cu);
			}
			return _;
		},
	);
}
