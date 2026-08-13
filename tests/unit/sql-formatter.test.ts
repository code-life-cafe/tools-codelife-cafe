import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SQL_KEYWORDS } from '../../src/lib/tools/sql-formatter.ts';

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
