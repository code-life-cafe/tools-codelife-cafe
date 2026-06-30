import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execRegexSync } from '../../src/lib/tools/regex-tester.ts';

test('execRegexSync: グローバル空文字マッチ（^ や .* 等）でフリーズせず安全に停止・列挙される', () => {
	const result = execRegexSync('^', 'g', 'abc');
	assert.ok(result.matches.length > 0);
	assert.strictEqual(result.matches[0].value, '');
	assert.strictEqual(result.matches[0].index, 0);

	const emptyMatchResult = execRegexSync('a*', 'g', 'ba');
	// フリーズ・無限ループせずに完了すること
	assert.ok(Array.isArray(emptyMatchResult.matches));
});

test('execRegexSync: サロゲートペア（絵文字）を含むテキストでマッチ位置とコードポイント境界が正確に評価される', () => {
	const text = 'A🎉B';
	// u フラグありで Unicode code point マッチ
	const result = execRegexSync('.', 'gu', text);
	assert.strictEqual(result.matches.length, 3);
	assert.strictEqual(result.matches[0].value, 'A');
	assert.strictEqual(result.matches[0].index, 0);
	assert.strictEqual(result.matches[1].value, '🎉');
	assert.strictEqual(result.matches[1].index, 1);
	assert.strictEqual(result.matches[2].value, 'B');
	assert.strictEqual(result.matches[2].index, 3); // 🎉 は 2 UTF-16 code units なので 'B' の index は 3
});
