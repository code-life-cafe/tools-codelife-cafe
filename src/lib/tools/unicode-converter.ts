import { escapeUnicode, unescapeUnicode } from '../string-utils.ts';

/**
 * テキストをユニコードエスケープシーケンス（\uXXXX / \u{XXXXX}）に変換する
 */
export function textToUnicode(
	text: string,
	useCodePointSyntax = false,
): string {
	return escapeUnicode(text, useCodePointSyntax);
}

/**
 * ユニコードエスケープシーケンス（\uXXXX および \u{XXXXX}）を元のテキストにデコードする
 */
export function unicodeToText(unicodeStr: string): string {
	if (!unicodeStr) return '';
	try {
		return unescapeUnicode(unicodeStr);
	} catch (_e) {
		throw new Error(
			'デコードに失敗しました。ユニコード形式が正しいか確認してください。',
		);
	}
}
