import { format } from 'sql-formatter';

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
		// Basic compression strategy
		const compressed = sql
			.replace(/--.*$/gm, '') // Remove single line comments
			.replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi line comments
			.replace(/\s+/g, ' ') // Collapse whitespace
			.trim();

		if (options.uppercase) {
			// In compress mode with uppercase, we might still want keywords uppercase?
			// Full formatter is better. We can format it then compress it.
			try {
				const formatted = format(sql, {
					language: options.dialect,
					keywordCase: 'upper',
				});
				const comp = formatted.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
				return { output: comp };
			} catch {
				return { output: compressed };
			}
		}
		return { output: compressed };
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
