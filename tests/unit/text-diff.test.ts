import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSplitPairs, computeDiff } from '../../src/lib/tools/text-diff.ts';

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

test('buildSplitPairs: 片側のみの追加行に反対側スペーサー(null)が入り左右の行数が揃う', () => {
	const textA = '行1\n行2\n行3';
	const textB = '行1\n追加行A\n追加行B\n行2\n行3';

	const result = computeDiff(textA, textB, 'lines');
	const pairs = buildSplitPairs(result.parts);

	// 追加2行 + 共通3行 = 5ペア
	assert.strictEqual(pairs.length, 5);

	// 追加行のペアは left が null（スペーサー）で right のみ内容を持つ
	const addedPairs = pairs.filter((p) => p.right?.type === 'added');
	assert.strictEqual(addedPairs.length, 2);
	for (const p of addedPairs) {
		assert.strictEqual(p.left, null);
	}

	// 追加行の後、共通行「行2」「行3」は同じインデックスで左右とも内容を持つ
	const line2Index = pairs.findIndex((p) => p.left?.content === '行2');
	assert.notStrictEqual(line2Index, -1);
	assert.strictEqual(pairs[line2Index].right?.content, '行2');

	const line3Index = pairs.findIndex((p) => p.left?.content === '行3');
	assert.notStrictEqual(line3Index, -1);
	assert.strictEqual(pairs[line3Index].right?.content, '行3');
});

test('buildSplitPairs: 片側のみの削除行に反対側スペーサー(null)が入る', () => {
	const textA = '行1\n削除行\n行2';
	const textB = '行1\n行2';

	const result = computeDiff(textA, textB, 'lines');
	const pairs = buildSplitPairs(result.parts);

	const removedPairs = pairs.filter((p) => p.left?.type === 'removed');
	assert.strictEqual(removedPairs.length, 1);
	assert.strictEqual(removedPairs[0].right, null);
});

test('buildSplitPairs: 変更なしの場合は左右とも同一内容のペアになる', () => {
	const textA = '行1\n行2';
	const textB = '行1\n行2';

	const result = computeDiff(textA, textB, 'lines');
	const pairs = buildSplitPairs(result.parts);

	assert.strictEqual(pairs.length, 2);
	for (const p of pairs) {
		assert.strictEqual(p.left?.type, 'unchanged');
		assert.strictEqual(p.right?.type, 'unchanged');
		assert.strictEqual(p.left?.content, p.right?.content);
	}
});
