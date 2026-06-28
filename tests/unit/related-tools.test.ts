// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/related-tools.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getRelatedTools, toolCatalog } from '../../src/lib/tools/catalog.ts';

const ids = (toolId: string, limit?: number) =>
	getRelatedTools(toolId, limit).map((t) => t.id);

// ---------------------------------------------------------------------------
// related 優先
// ---------------------------------------------------------------------------

test('related 指定がある場合は指定順で返す', () => {
	// base64.related = ['url-encoder', 'image-base64', 'cipher']
	assert.deepEqual(ids('base64'), ['url-encoder', 'image-base64', 'cipher']);
});

test('related が limit を超える場合は先頭から limit 件に切り詰める', () => {
	// hash.related は ['color', 'jwt-decoder', 'sql-formatter'] (3件)
	// limit = 2 で先頭 2 件に切り詰められる
	assert.deepEqual(ids('hash', 2), ['color', 'jwt-decoder']);
});

// ---------------------------------------------------------------------------
// 同カテゴリ自動補完
// ---------------------------------------------------------------------------

test('related 未指定なら同カテゴリの他ツールで補完する', () => {
	// 一時的に related を空にしたモックツールか、実在ツールの挙動を検証
	const tool = toolCatalog.find((t) => t.id === 'base64')!;
	const originalRelated = tool.related;
	try {
		tool.related = [];
		const result = ids('base64');
		assert.equal(result.length, 3);
		assert.ok(!result.includes('base64'));
	} finally {
		tool.related = originalRelated;
	}
});

test('related が limit に満たない場合は同カテゴリで補完する', () => {
	// masking.related = ['image-mosaic', 'dummy-data']（別カテゴリ2件）
	// → 不足1件を同カテゴリ（データ処理）の先頭 csv-editor で補完
	const result = ids('masking');
	assert.equal(result.length, 3);
	assert.deepEqual(result.slice(0, 2), ['image-mosaic', 'dummy-data']);
	const filler = toolCatalog.find((t) => t.id === result[2]);
	assert.equal(filler?.category, 'データ処理');
});

// ---------------------------------------------------------------------------
// 除外ルール
// ---------------------------------------------------------------------------

test('自分自身は結果に含まれない', () => {
	for (const tool of toolCatalog) {
		const result = ids(tool.id);
		assert.ok(
			!result.includes(tool.id),
			`${tool.id} の関連に自分自身が含まれている`,
		);
	}
});

test('返り値に重複はなく、すべて実在するツールidである', () => {
	const validIds = new Set(toolCatalog.map((t) => t.id));
	for (const tool of toolCatalog) {
		const result = ids(tool.id);
		assert.equal(new Set(result).size, result.length, `${tool.id} に重複`);
		for (const id of result) {
			assert.ok(validIds.has(id), `${tool.id} の関連に不正id: ${id}`);
		}
	}
});

test('件数は limit を超えない', () => {
	for (const tool of toolCatalog) {
		assert.ok(getRelatedTools(tool.id).length <= 3);
		assert.ok(getRelatedTools(tool.id, 5).length <= 5);
	}
});

// ---------------------------------------------------------------------------
// 空配列ケース
// ---------------------------------------------------------------------------

test('存在しないツールidは空配列を返す', () => {
	assert.deepEqual(getRelatedTools('does-not-exist'), []);
});
