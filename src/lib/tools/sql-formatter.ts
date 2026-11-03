import { format } from 'sql-formatter';

// 出力SQLのシンタックスハイライトで強調表示するキーワード一覧
export const SQL_KEYWORDS = [
	'SELECT',
	'FROM',
	'WHERE',
	'AND',
	'OR',
	'JOIN',
	'LEFT',
	'RIGHT',
	'INNER',
	'OUTER',
	'ON',
	'ORDER BY',
	'GROUP BY',
	'HAVING',
	'LIMIT',
	'OFFSET',
	'INSERT',
	'INTO',
	'VALUES',
	'UPDATE',
	'SET',
	'DELETE',
	'CREATE',
	'TABLE',
	'DROP',
	'ALTER',
	'ADD',
	'COLUMN',
	'AS',
	'DISTINCT',
	'COUNT',
	'MAX',
	'MIN',
	'AVG',
	'SUM',
	'IS',
	'NULL',
	'NOT',
	'IN',
	'BETWEEN',
	'LIKE',
];

export type SqlDialect = 'sql' | 'mysql' | 'postgresql' | 'tsql' | 'plsql';
export type IndentStyle = '2spaces' | '4spaces' | 'tabs';

export interface SqlFormatOptions {
	dialect: SqlDialect;
	indent: IndentStyle;
	uppercase: boolean;
	compress: boolean;
}

const VALID_DIALECTS: readonly SqlDialect[] = [
	'sql',
	'mysql',
	'postgresql',
	'tsql',
	'plsql',
];
const VALID_INDENT_STYLES: readonly IndentStyle[] = [
	'2spaces',
	'4spaces',
	'tabs',
];
const VALID_LAYOUTS = ['horizontal', 'vertical'] as const;
type Layout = (typeof VALID_LAYOUTS)[number];

export interface SqlFormatterSettings {
	autoFormat: boolean;
	dialect: SqlDialect;
	indent: IndentStyle;
	uppercase: boolean;
	compress: boolean;
	isExpanded: boolean;
	layout: Layout;
}

// 共有URL/localStorage経由の復元値を検証し、不正値はデフォルトへフォールバックする
export function sanitizeSqlFormatterSettings(
	value: unknown,
	defaults: SqlFormatterSettings,
): SqlFormatterSettings {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return defaults;
	}
	const v = value as Record<string, unknown>;
	const bool = (raw: unknown, fallback: boolean) =>
		typeof raw === 'boolean' ? raw : fallback;
	return {
		autoFormat: bool(v.autoFormat, defaults.autoFormat),
		dialect:
			typeof v.dialect === 'string' &&
			(VALID_DIALECTS as readonly string[]).includes(v.dialect)
				? (v.dialect as SqlDialect)
				: defaults.dialect,
		indent:
			typeof v.indent === 'string' &&
			(VALID_INDENT_STYLES as readonly string[]).includes(v.indent)
				? (v.indent as IndentStyle)
				: defaults.indent,
		uppercase: bool(v.uppercase, defaults.uppercase),
		compress: bool(v.compress, defaults.compress),
		isExpanded: bool(v.isExpanded, defaults.isExpanded),
		layout:
			typeof v.layout === 'string' &&
			(VALID_LAYOUTS as readonly string[]).includes(v.layout)
				? (v.layout as Layout)
				: defaults.layout,
	};
}

export function formatSql(
	sql: string,
	options: SqlFormatOptions,
): { output: string; error?: string } {
	if (!sql.trim()) return { output: '' };

	if (options.compress) {
		if (options.uppercase) {
			// 大文字化はフォーマッタに任せ、その出力をトークン単位で1行化する。
			try {
				const formatted = format(sql, {
					language: options.dialect,
					keywordCase: 'upper',
				});
				return { output: compactSql(formatted, options.dialect) };
			} catch {
				return { output: compactSql(sql, options.dialect) };
			}
		}
		return { output: compactSql(sql, options.dialect) };
	}

	try {
		const useTabs = options.indent === 'tabs';
		const tabWidth = options.indent === '4spaces' ? 4 : 2;

		const formatted = format(sql, {
			language: options.dialect,
			useTabs,
			tabWidth,
			keywordCase: options.uppercase ? 'upper' : 'preserve',
			linesBetweenQueries: 2,
		});
		return { output: formatted };
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		return {
			output: sql,
			error: `SQLの構文エラー:\n${msg}`,
		};
	}
}

/**
 * SQLを1行に圧縮する。文字列リテラル・引用識別子・ドル引用の中身は一切変えず、
 * それ以外の部分のコメントを除去し、連続する空白を1つの空白にまとめる。
 */
export function compactSql(sql: string, dialect: SqlDialect): string {
	const backslashEscapes = dialect === 'mysql';
	let out = '';
	let pendingSpace = false;
	const emit = (chunk: string) => {
		if (pendingSpace && out.length > 0) out += ' ';
		pendingSpace = false;
		out += chunk;
	};
	let i = 0;
	const n = sql.length;
	while (i < n) {
		const ch = sql[i];
		// 空白
		if (/\s/.test(ch)) {
			pendingSpace = true;
			i++;
			continue;
		}
		// 行コメント
		if (ch === '-' && sql[i + 1] === '-') {
			const nl = sql.indexOf('\n', i);
			i = nl === -1 ? n : nl;
			pendingSpace = true;
			continue;
		}
		// ブロックコメント（閉じがなければ末尾まで）
		if (ch === '/' && sql[i + 1] === '*') {
			const close = sql.indexOf('*/', i + 2);
			i = close === -1 ? n : close + 2;
			pendingSpace = true;
			continue;
		}
		// 文字列リテラル・引用識別子
		if (
			ch === "'" ||
			ch === '"' ||
			ch === '`' ||
			(ch === '[' && dialect === 'tsql')
		) {
			const closeChar = ch === '[' ? ']' : ch;
			let j = i + 1;
			while (j < n) {
				if (backslashEscapes && ch !== '`' && sql[j] === '\\') {
					j += 2;
					continue;
				}
				if (sql[j] === closeChar) {
					if (sql[j + 1] === closeChar) {
						j += 2;
						continue;
					}
					j++;
					break;
				}
				j++;
			}
			emit(sql.slice(i, Math.min(j, n)));
			i = j;
			continue;
		}
		// PostgreSQLのドル引用 $tag$...$tag$
		if (ch === '$' && dialect === 'postgresql') {
			const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
			if (m) {
				const tag = m[0];
				const close = sql.indexOf(tag, i + tag.length);
				const j = close === -1 ? n : close + tag.length;
				emit(sql.slice(i, j));
				i = j;
				continue;
			}
		}
		// その他のトークン（次の空白・コメント・引用の手前まで）
		let j = i + 1;
		while (
			j < n &&
			!/[\s'"`$[]/.test(sql[j]) &&
			!(sql[j] === '-' && sql[j + 1] === '-') &&
			!(sql[j] === '/' && sql[j + 1] === '*')
		) {
			j++;
		}
		emit(sql.slice(i, j));
		i = j;
	}
	return out;
}
