export type Direction = 'encode' | 'decode';

export interface EncodeOptions {
	iife: boolean;
	minify: boolean;
	externalScriptUrl?: string;
}

export interface DecodeOptions {
	beautify: boolean;
}

export type EncodeResult =
	| { ok: true; output: string }
	| { ok: false; error: string };

export type DecodeResult =
	| { ok: true; output: string }
	| { ok: false; error: string };

const BOOKMARKLET_PREFIX = 'javascript:';
const INDENT_UNIT = '  ';

/** 入力が `javascript:` で始まればデコード、それ以外はエンコードと判定する */
export function detectDirection(input: string): Direction {
	return /^\s*javascript:/i.test(input) ? 'decode' : 'encode';
}

export function isValidExternalScriptUrl(url: string): boolean {
	return /^https?:\/\/.+/i.test(url.trim());
}

/** コードを即時実行関数（IIFE）でラップする */
export function wrapIIFE(code: string): string {
	return `(() => {\n${code}\n})();`;
}

/** 外部スクリプトを非同期ロードするコード片を生成する（ユーザーコードの前に挿入） */
export function buildExternalScriptSnippet(url: string): string {
	return `var s=document.createElement('script');s.src='${url}';document.body.appendChild(s);`;
}

/**
 * 安全な範囲でのminify: `//`・`/* *‍/`コメントの削除と、文字列外の連続空白の単一空白化のみ行う。
 * 文字列（'・"・`）内のコメント記号や空白は変更しない。
 */
export function minifyJs(code: string): string {
	let out = '';
	let quote: "'" | '"' | '`' | null = null;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = 0; i < code.length; i++) {
		const ch = code[i];
		const next = code[i + 1];

		if (inLineComment) {
			if (ch === '\n') inLineComment = false;
			continue;
		}
		if (inBlockComment) {
			if (ch === '*' && next === '/') {
				inBlockComment = false;
				i++;
			}
			continue;
		}
		if (quote) {
			out += ch;
			if (ch === '\\' && next !== undefined) {
				out += next;
				i++;
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}

		if (ch === "'" || ch === '"' || ch === '`') {
			quote = ch;
			out += ch;
			continue;
		}
		if (ch === '/' && next === '/') {
			inLineComment = true;
			i++;
			continue;
		}
		if (ch === '/' && next === '*') {
			inBlockComment = true;
			i++;
			continue;
		}
		if (/\s/.test(ch)) {
			if (!/\s$/.test(out)) out += ' ';
			continue;
		}
		out += ch;
	}

	return out.trim();
}

/**
 * 簡易整形: 文字列外の `;`・`{`・`}` の後（`}` は前後）に改行を挿入し、
 * `{` の深さに応じてインデントする。複雑な構文（forの`;`区切り等）では不十分な場合がある。
 */
export function beautifyJs(code: string): string {
	let out = '';
	let depth = 0;
	let quote: "'" | '"' | '`' | null = null;

	const breakLine = (nextDepth: number) => {
		out = out.replace(/[ \t]+$/, '');
		out += `\n${INDENT_UNIT.repeat(Math.max(nextDepth, 0))}`;
	};

	for (let i = 0; i < code.length; i++) {
		const ch = code[i];
		const next = code[i + 1];

		if (quote) {
			out += ch;
			if (ch === '\\' && next !== undefined) {
				out += next;
				i++;
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"' || ch === '`') {
			quote = ch;
			out += ch;
			continue;
		}
		if (ch === '{') {
			out += ch;
			depth++;
			breakLine(depth);
			continue;
		}
		if (ch === '}') {
			depth = Math.max(depth - 1, 0);
			breakLine(depth);
			out += ch;
			breakLine(depth);
			continue;
		}
		if (ch === ';') {
			out += ch;
			breakLine(depth);
			continue;
		}
		if (/\s/.test(ch)) {
			if (out.length === 0 || /[\n ]$/.test(out)) continue;
			out += ' ';
			continue;
		}
		out += ch;
	}

	return out
		.split('\n')
		.map((line) => line.replace(/[ \t]+$/, ''))
		.filter((line) => line.trim().length > 0)
		.join('\n');
}

/**
 * JS → Bookmarklet変換。IIFEラップ → minify → 外部スクリプト挿入 → URIエンコードの順で処理する。
 */
export function encodeBookmarklet(
	code: string,
	options: EncodeOptions,
): EncodeResult {
	if (!code.trim()) {
		return { ok: false, error: 'JavaScriptコードを入力してください。' };
	}

	let externalSnippet = '';
	const externalUrl = options.externalScriptUrl?.trim();
	if (externalUrl) {
		if (!isValidExternalScriptUrl(externalUrl)) {
			return {
				ok: false,
				error:
					'外部スクリプトのURLは http:// または https:// で始まる必要があります。',
			};
		}
		externalSnippet = buildExternalScriptSnippet(externalUrl);
	}

	let body = code;
	if (options.iife) body = wrapIIFE(body);
	if (options.minify) body = minifyJs(body);

	const combined = externalSnippet + body;

	let encoded: string;
	try {
		encoded = encodeURIComponent(combined);
	} catch {
		return { ok: false, error: 'エンコードに失敗しました。' };
	}

	return { ok: true, output: `${BOOKMARKLET_PREFIX}${encoded}` };
}

/**
 * Bookmarklet → JS変換。`javascript:` 除去 → URIデコード → 必要に応じて簡易整形の順で処理する。
 */
export function decodeBookmarklet(
	input: string,
	options: DecodeOptions,
): DecodeResult {
	const trimmed = input.trim();
	if (!trimmed) {
		return {
			ok: false,
			error: 'bookmarkletのURLまたはコードを入力してください。',
		};
	}

	const stripped = trimmed.replace(/^javascript:/i, '');

	let decoded: string;
	try {
		decoded = decodeURIComponent(stripped);
	} catch {
		return {
			ok: false,
			error: '不正なURIエンコードです。bookmarkletの形式を確認してください。',
		};
	}

	const output = options.beautify ? beautifyJs(decoded) : decoded;
	return { ok: true, output };
}
