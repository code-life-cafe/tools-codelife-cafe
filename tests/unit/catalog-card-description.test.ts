import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toolCatalog } from '../../src/lib/tools/catalog.ts';

// トップページの全ツールカード（ToolCard.astro）は description を <p> として必ず表示する。
// カタログに description が空のツールが混入すると、そのカードだけ説明文が欠落する
// （color カードの説明欠落報告を受けた回帰防止）ため、全件を回帰検証する。
test('toolCatalogの全ツールに空でないdescriptionがある', () => {
	for (const tool of toolCatalog) {
		assert.ok(
			tool.description.trim().length > 0,
			`${tool.id}: description が空`,
		);
	}
});
