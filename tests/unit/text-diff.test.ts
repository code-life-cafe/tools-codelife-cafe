import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeDiff } from '../../src/lib/tools/text-diff.ts';

test('computeDiff: 末尾への行追加で既存行が未変更として維持される', () => {
	const textA = 'line1\nline2';
	const textB = 'line1\nline2\nline3';

	const result = computeDiff(textA, textB, 'lines');

	// line1 と line2 が unchanged であること
	const unchanged = result.parts.filter((p) => p.type === 'unchanged');
	const added = result.parts.filter((p) => p.type === 'added');
	const removed = result.parts.filter((p) => p.type === 'removed');

	assert.ok(unchanged.length > 0, '未変更行が存在すること');
	assert.strictEqual(removed.length, 0, '削除行がないこと');
	assert.strictEqual(added.length, 1, '追加は1箇所（line3）のみであること');
	assert.ok(added[0].value.includes('line3'), '追加内容にline3が含まれること');
});

test('computeDiff: 先頭追加・中間挿入で最小diffが生成される', () => {
	const textA = 'line2\nline3';
	const textB = 'line1\nline2\nline2.5\nline3';

	const result = computeDiff(textA, textB, 'lines');
	assert.strictEqual(result.removedLines, 0);
	assert.strictEqual(result.addedLines, 2);
});
