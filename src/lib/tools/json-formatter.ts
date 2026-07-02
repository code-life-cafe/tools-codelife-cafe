// JSON整形ロジック（純粋関数）

export type IndentType = '2' | '4' | 'tab';

export interface FormatResult {
	success: boolean;
	output: string;
	error?: string;
	errorPosition?: number;
}

function getIndentString(indent: IndentType): string | number {
	switch (indent) {
		case '2':
			return 2;
		case '4':
			return 4;
		case 'tab':
			return '\t';
	}
}

// ============================================================
// 大整数精度保持: Number.MAX_SAFE_INTEGER (9007199254740991) を
// 超える整数は JSON.parse で精度が失われるため、パース前に一時的な
// 文字列プレースホルダーへ置換し、整形後に数値リテラルへ復元する。
// ============================================================

const BIGINT_PLACEHOLDER_PREFIX = '__LOSSLESS_INT__';
const BIGINT_PLACEHOLDER_SUFFIX = '__END__';
const BIGINT_PLACEHOLDER_RE = new RegExp(
	`"${BIGINT_PLACEHOLDER_PREFIX}(-?\\d+)${BIGINT_PLACEHOLDER_SUFFIX}"`,
	'g',
);

/** 文字列として与えられた整数が安全な表現範囲を超えるか判定 */
function isUnsafeInteger(numStr: string): boolean {
	const abs = numStr.startsWith('-') ? numStr.slice(1) : numStr;
	// 17桁以上 → 必ず MAX_SAFE_INTEGER 超
	if (abs.length > 16) return true;
	// 15桁以下 → MAX_SAFE_INTEGER (16桁) 以下
	if (abs.length < 16) return false;
	// 16桁 → 文字列辞書順で 9007199254740992 以上なら unsafe
	return abs >= '9007199254740992';
}

/**
 * JSONテキスト中の文字列リテラル外に出現する大整数を、
 * JSON.parse が精度を保てるよう一時的な文字列プレースホルダーへ置換する。
 * float・指数表記は変換しない。
 */
function replaceLargeInts(input: string): string {
	let result = '';
	let inString = false;
	let i = 0;

	while (i < input.length) {
		const ch = input[i];

		if (inString) {
			result += ch;
			if (ch === '\\') {
				// エスケープシーケンスをそのまま通す
				i++;
				result += input[i] ?? '';
			} else if (ch === '"') {
				inString = false;
			}
			i++;
		} else if (ch === '"') {
			result += ch;
			inString = true;
			i++;
		} else if (ch === '-' || (ch >= '0' && ch <= '9')) {
			// 数値トークンを収集
			let numStr = '';
			if (ch === '-') {
				numStr = '-';
				i++;
			}
			while (i < input.length && input[i] >= '0' && input[i] <= '9') {
				numStr += input[i++];
			}
			const nextCh = i < input.length ? input[i] : '';
			if (nextCh === '.' || nextCh === 'e' || nextCh === 'E') {
				// float / 指数表記 → そのまま
				while (i < input.length && !' \t\n\r,}]'.includes(input[i])) {
					numStr += input[i++];
				}
				result += numStr;
			} else {
				// 純粋な整数: 大きすぎる場合はプレースホルダーへ置換
				result += isUnsafeInteger(numStr)
					? `"${BIGINT_PLACEHOLDER_PREFIX}${numStr}${BIGINT_PLACEHOLDER_SUFFIX}"`
					: numStr;
			}
		} else {
			result += ch;
			i++;
		}
	}

	return result;
}

/** stringify 後の出力に残ったプレースホルダーを元の数値リテラルへ復元 */
function restoreLargeInts(output: string): string {
	return output.replace(BIGINT_PLACEHOLDER_RE, '$1');
}

export function formatJson(
	input: string,
	indent: IndentType = '2',
): FormatResult {
	if (!input.trim()) {
		return { success: true, output: '' };
	}
	try {
		const preprocessed = replaceLargeInts(input);
		const parsed = JSON.parse(preprocessed);
		const formatted = JSON.stringify(parsed, null, getIndentString(indent));
		return { success: true, output: restoreLargeInts(formatted) };
	} catch (e) {
		const error = e as SyntaxError;
		const match = error.message.match(/position (\d+)/i);
		const errorPosition = match ? parseInt(match[1], 10) : undefined;
		return {
			success: false,
			output: input,
			error: `JSON構文エラー: ${error.message}`,
			errorPosition,
		};
	}
}

export function minifyJson(input: string): FormatResult {
	if (!input.trim()) {
		return { success: true, output: '' };
	}
	try {
		const preprocessed = replaceLargeInts(input);
		const parsed = JSON.parse(preprocessed);
		const minified = JSON.stringify(parsed);
		return { success: true, output: restoreLargeInts(minified) };
	} catch (e) {
		const error = e as SyntaxError;
		return {
			success: false,
			output: input,
			error: `JSON構文エラー: ${error.message}`,
		};
	}
}

export function validateJson(input: string): FormatResult {
	if (!input.trim()) {
		return { success: true, output: '有効なJSONです' };
	}
	try {
		// バリデーションは精度よりも構文チェックが目的のため通常のparseを使用
		JSON.parse(input);
		return { success: true, output: '有効なJSONです' };
	} catch (e) {
		const error = e as SyntaxError;
		return {
			success: false,
			output: '',
			error: error.message,
		};
	}
}
