import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	formatSql,
	SQL_KEYWORDS,
	type SqlFormatOptions,
	type SqlFormatterSettings,
	sanitizeSqlFormatterSettings,
} from '../../src/lib/tools/sql-formatter.ts';

const DEFAULT_SETTINGS: SqlFormatterSettings = {
	autoFormat: true,
	dialect: 'sql',
	indent: '2spaces',
	uppercase: true,
	compress: false,
	isExpanded: false,
	layout: 'horizontal',
};

function formatOpts(
	overrides: Partial<SqlFormatOptions> = {},
): SqlFormatOptions {
	return {
		dialect: 'sql',
		indent: '2spaces',
		uppercase: true,
		compress: false,
		...overrides,
	};
}

// ============================================================
// SQL_KEYWORDS: 出力SQLのシンタックスハイライトで使うキーワード一覧
// ============================================================

test('SQL_KEYWORDS: 空でない配列である', () => {
	assert.ok(Array.isArray(SQL_KEYWORDS));
	assert.ok(SQL_KEYWORDS.length > 0);
});

test('SQL_KEYWORDS: 主要な句を含む', () => {
	for (const kw of [
		'SELECT',
		'FROM',
		'WHERE',
		'JOIN',
		'GROUP BY',
		'ORDER BY',
	]) {
		assert.ok(SQL_KEYWORDS.includes(kw), `${kw} が含まれていません`);
	}
});

test('SQL_KEYWORDS: すべて重複なく一意である', () => {
	const unique = new Set(SQL_KEYWORDS);
	assert.equal(unique.size, SQL_KEYWORDS.length);
});

// ============================================================
// formatSql
// ============================================================

test('formatSql: 空文字/空白のみは空出力を返す', () => {
	assert.deepEqual(formatSql('', formatOpts()), { output: '' });
	assert.deepEqual(formatSql('   ', formatOpts()), { output: '' });
});

test('formatSql: 基本的なSELECT文を整形する', () => {
	const result = formatSql(
		'select id, name from users where id = 1',
		formatOpts(),
	);
	assert.equal(result.error, undefined);
	assert.ok(result.output.includes('SELECT'));
	assert.ok(result.output.includes('FROM'));
	assert.ok(result.output.includes('WHERE'));
	assert.ok(result.output.includes('\n'));
});

test('formatSql: uppercase: false はキーワードの大文字小文字を保持する', () => {
	const result = formatSql(
		'select id from users',
		formatOpts({ uppercase: false }),
	);
	assert.ok(result.output.includes('select'));
	assert.ok(!result.output.includes('SELECT'));
});

test('formatSql: indent が tabs のときタブ文字でインデントする', () => {
	const result = formatSql(
		'select id, name from users',
		formatOpts({ indent: 'tabs' }),
	);
	assert.ok(result.output.includes('\t'));
});

test('formatSql: compress: true は改行を除去した1行に圧縮する', () => {
	const result = formatSql(
		'select id,\nname\nfrom users',
		formatOpts({ compress: true, uppercase: false }),
	);
	assert.ok(!result.output.includes('\n'));
	assert.ok(result.output.includes('select'));
});

test('formatSql: compress + uppercase はキーワードを大文字化した1行を返す', () => {
	const result = formatSql(
		'select id from users',
		formatOpts({ compress: true, uppercase: true }),
	);
	assert.ok(!result.output.includes('\n'));
	assert.ok(result.output.includes('SELECT'));
	assert.ok(result.output.includes('FROM'));
});

test('formatSql: compress はコメントを除去する', () => {
	const result = formatSql(
		'select id -- comment\nfrom users /* block */',
		formatOpts({ compress: true, uppercase: false }),
	);
	assert.ok(!result.output.includes('comment'));
	assert.ok(!result.output.includes('block'));
});

test('formatSql: 構文エラー時は元のSQLとエラーメッセージを返す', () => {
	const result = formatSql('select * from (', formatOpts());
	assert.equal(result.output, 'select * from (');
	assert.ok(result.error?.includes('SQLの構文エラー'));
});

test('formatSql: dialect違いでも整形できる', () => {
	for (const dialect of [
		'sql',
		'mysql',
		'postgresql',
		'tsql',
		'plsql',
	] as const) {
		const result = formatSql('select 1', formatOpts({ dialect }));
		assert.equal(result.error, undefined, dialect);
	}
});

// ============================================================
// sanitizeSqlFormatterSettings
// ============================================================

test('sanitizeSqlFormatterSettings: null/非object はデフォルトを返す', () => {
	assert.deepEqual(
		sanitizeSqlFormatterSettings(null, DEFAULT_SETTINGS),
		DEFAULT_SETTINGS,
	);
	assert.deepEqual(
		sanitizeSqlFormatterSettings('not an object', DEFAULT_SETTINGS),
		DEFAULT_SETTINGS,
	);
	assert.deepEqual(
		sanitizeSqlFormatterSettings([1, 2], DEFAULT_SETTINGS),
		DEFAULT_SETTINGS,
	);
});

test('sanitizeSqlFormatterSettings: 妥当な値はそのまま採用される', () => {
	const value = {
		autoFormat: false,
		dialect: 'mysql',
		indent: '4spaces',
		uppercase: false,
		compress: true,
		isExpanded: true,
		layout: 'vertical',
	};
	assert.deepEqual(
		sanitizeSqlFormatterSettings(value, DEFAULT_SETTINGS),
		value,
	);
});

test('sanitizeSqlFormatterSettings: 不正な値はデフォルトへフォールバックする', () => {
	const result = sanitizeSqlFormatterSettings(
		{
			dialect: 'not-a-real-dialect',
			indent: 'invalid',
			layout: 'diagonal',
			autoFormat: 'yes',
		},
		DEFAULT_SETTINGS,
	);
	assert.equal(result.dialect, DEFAULT_SETTINGS.dialect);
	assert.equal(result.indent, DEFAULT_SETTINGS.indent);
	assert.equal(result.layout, DEFAULT_SETTINGS.layout);
	assert.equal(result.autoFormat, DEFAULT_SETTINGS.autoFormat);
});

test('sanitizeSqlFormatterSettings: 一部のキーのみ指定した場合は残りにデフォルトを使う', () => {
	const result = sanitizeSqlFormatterSettings(
		{ compress: true },
		DEFAULT_SETTINGS,
	);
	assert.equal(result.compress, true);
	assert.equal(result.dialect, DEFAULT_SETTINGS.dialect);
	assert.equal(result.uppercase, DEFAULT_SETTINGS.uppercase);
});
