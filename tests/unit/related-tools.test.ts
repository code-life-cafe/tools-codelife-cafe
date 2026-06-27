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
	// base64.related = ['url-encoder', 'cipher', 'unicode-converter']
	assert.deepEqual(ids('base64'), [
		'url-encoder',
		'cipher',
		'unicode-converter',
	]);
});

test('related が limit を超える場合は先頭から limit 件に切り詰める', () => {
	// image-compress.related は7件
	assert.deepEqual(ids('image-compress'), [
		'image-convert',
		'bg-remove',
		'image-mosaic',
	]);
	// limit を広げれば多く返る
	assert.deepEqual(ids('image-compress', 5), [
		'image-convert',
		'bg-remove',
		'image-mosaic',
		'image-text',
		'favicon',
	]);
});

// ---------------------------------------------------------------------------
// 同カテゴリ自動補完
// ---------------------------------------------------------------------------

test('related 未指定なら同カテゴリの他ツールで補完する', () => {
	// char-count（テキスト解析）の同カテゴリは text-diff のみ
	assert.deepEqual(ids('char-count'), ['text-diff']);
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
