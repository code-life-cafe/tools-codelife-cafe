import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	compactSql,
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

test('formatSql: 圧縮は引用符内の空白・改行・エスケープを保持し、行コメント後のSQLを吸収しない（#566）', () => {
	for (const uppercase of [false, true]) {
		const opts = formatOpts({ compress: true, uppercase });
		const first = formatSql(
			"SELECT 'a  b' AS value; -- comment\nSELECT 2;",
			opts,
		).output;
		assert.ok(first.includes("'a  b'"), first);
		assert.ok(!first.includes('comment'), first);
		assert.match(first, /; SELECT 2;$/, first);

		const literalComment = formatSql(
			"SELECT 'a--b' AS v, '/* x */' AS w /* 本物 */ FROM t;",
			opts,
		).output;
		assert.ok(literalComment.includes("'a--b'"), literalComment);
		assert.ok(literalComment.includes("'/* x */'"), literalComment);
		assert.ok(!literalComment.includes('本物'), literalComment);

		const escaped = formatSql(
			"SELECT 'it''s\n  ok', \"col  name\" FROM t",
			opts,
		).output;
		assert.ok(escaped.includes("'it''s\n  ok'"), escaped);
		assert.ok(escaped.includes('"col  name"'), escaped);
	}
});

test('compactSql: 方言ごとの引用（ドル引用・バックスラッシュ・角括弧）を保持する', () => {
	assert.equal(
		compactSql('SELECT $$a  -- b$$,\n  $f$ x $f$', 'postgresql'),
		'SELECT $$a  -- b$$, $f$ x $f$',
	);
	assert.equal(
		compactSql("SELECT 'a\\'  b' x -- c\nFROM t", 'mysql'),
		"SELECT 'a\\'  b' x FROM t",
	);
	assert.equal(
		compactSql('SELECT [col  -- x]  FROM t', 'tsql'),
		'SELECT [col  -- x] FROM t',
	);
	assert.equal(compactSql('  SELECT\t1\n\n', 'sql'), 'SELECT 1');
	assert.equal(compactSql("SELECT 'open", 'sql'), "SELECT 'open");
});

test('compactSql: MySQLの「#」行コメントを除去し、空白のない「--」は演算子として残す', () => {
	assert.equal(
		compactSql('SELECT 1 # コメント\nFROM t', 'mysql'),
		'SELECT 1 FROM t',
	);
	assert.equal(compactSql('SELECT 5--1 FROM t', 'mysql'), 'SELECT 5--1 FROM t');
	assert.equal(compactSql('SELECT 1 -- c\nFROM t', 'mysql'), 'SELECT 1 FROM t');
	assert.equal(compactSql('SELECT 1 --', 'mysql'), 'SELECT 1');
	// MySQL以外では「#」はコメントではない
	assert.equal(compactSql('SELECT a #b', 'postgresql'), 'SELECT a #b');
});

test('compactSql: PostgreSQLのE文字列とPL/SQLのq引用の中身を保持する', () => {
	assert.equal(
		compactSql("SELECT E'a\\'  b' -- c\nFROM t", 'postgresql'),
		"SELECT E'a\\'  b' FROM t",
	);
	assert.equal(
		compactSql("SELECT q'[it's  -- x]' FROM dual", 'plsql'),
		"SELECT q'[it's  -- x]' FROM dual",
	);
	assert.equal(
		compactSql("SELECT Q'!a  b!' FROM dual", 'plsql'),
		"SELECT Q'!a  b!' FROM dual",
	);
});

test('compactSql: CRのみの改行でも行コメントの後のSQLを残す', () => {
	assert.equal(compactSql('SELECT 1 -- c\rFROM t', 'sql'), 'SELECT 1 FROM t');
});

test('formatSql: 大文字化+圧縮で整形に失敗しても文字列リテラルを保持する', () => {
	const result = formatSql(
		"select 'a  -- b' from (",
		formatOpts({ compress: true, uppercase: true }),
	);
	assert.ok(result.output.includes("'a  -- b'"), result.output);
	assert.ok(!result.output.includes('\n'), result.output);
});
