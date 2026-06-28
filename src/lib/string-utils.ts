/**
 * コードポイント単位で安全に文字列を操作するためのユーティリティ
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
	if (!str) return [];
	const points: number[] = [];
	for (const char of str) {
		const code = char.codePointAt(0);
		if (code !== undefined) {
			points.push(code);
		}
	}
	return points;
}

/**
 * コードポイントの配列から文字列を復元する
 */
export function fromCodePoints(codePoints: number[]): string {
	if (!codePoints || codePoints.length === 0) return '';
	return String.fromCodePoint(...codePoints);
}

/**
 * 文字列をユニコードエスケープシーケンスに変換する
 * @param str 対象文字列
 * @param useCodePointSyntax \u{XXXXX} 形式（Code Point エスケープ）を使用するかどうか
 */
export function escapeUnicode(str: string, useCodePointSyntax = false): string {
	if (!str) return '';
	const codePoints = getCodePoints(str);
	let result = '';
	for (const codePoint of codePoints) {
		// ASCII printable characters (except backslash) are kept as-is if desired, but usually all non-ASCII or non-printable are escaped.
		if (codePoint < 128 && codePoint !== 92) {
			result += String.fromCodePoint(codePoint);
		} else if (useCodePointSyntax) {
			const hex = codePoint.toString(16).padStart(4, '0');
			result += `\\u{${hex}}`;
		} else {
			if (codePoint > 0xffff) {
				// サロゲートペア（例: U+1F389 -> \uD83D\uDFE8）
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
 * ユニコードエスケープシーケンス（\uXXXX および \u{XXXXX}）を解読・デコードする
 */
export function unescapeUnicode(unicodeStr: string): string {
	if (!unicodeStr) return '';

	// 正規表現で \u{XXXXX} または \uXXXX をまとめて置換
	return unicodeStr.replace(
		/\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/g,
		(_, hexCodePoint, hexCodeUnit) => {
			const hex = hexCodePoint || hexCodeUnit;
			const code = parseInt(hex, 16);
			return String.fromCodePoint(code);
		},
	);
}
