import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('computeDiff: 空行の追加が追加行数に数えられる', () => {
	const result = computeDiff('a\n', 'a\n\n', 'lines');
	assert.strictEqual(result.addedLines, 1);
	assert.strictEqual(result.removedLines, 0);
});

test('computeDiff: 空行の削除が削除行数に数えられる', () => {
	const result = computeDiff('a\n\n', 'a\n', 'lines');
	assert.strictEqual(result.addedLines, 0);
	assert.strictEqual(result.removedLines, 1);
});

test('computeDiff: 空文字から改行のみへの変更は追加1行', () => {
	const result = computeDiff('', '\n', 'lines');
	assert.strictEqual(result.addedLines, 1);
	assert.strictEqual(result.removedLines, 0);
});

test('computeDiff: 連続する複数の空行がそれぞれ数えられる', () => {
	const added = computeDiff('a\n', 'a\n\n\n\n', 'lines');
	assert.strictEqual(added.addedLines, 3);
	assert.strictEqual(added.removedLines, 0);

	const removed = computeDiff('a\n\n\n\n', 'a\n', 'lines');
	assert.strictEqual(removed.addedLines, 0);
	assert.strictEqual(removed.removedLines, 3);
});

test('computeDiff: 空白だけの行の追加・削除が1行として数えられる', () => {
	const added = computeDiff('a\n', 'a\n  \n', 'lines');
	assert.strictEqual(added.addedLines, 1);
	assert.strictEqual(added.removedLines, 0);

	const removed = computeDiff('a\n\t\n', 'a\n', 'lines');
	assert.strictEqual(removed.addedLines, 0);
	assert.strictEqual(removed.removedLines, 1);
});

test('computeDiff: CRLFの空行も追加・削除として1行ずつ数えられる', () => {
	const added = computeDiff('a\r\n', 'a\r\n\r\n', 'lines');
	assert.strictEqual(added.addedLines, 1);
	assert.strictEqual(added.removedLines, 0);

	const removed = computeDiff('a\r\n\r\n', 'a\r\n', 'lines');
	assert.strictEqual(removed.addedLines, 0);
	assert.strictEqual(removed.removedLines, 1);
});

test('computeDiff: 末尾改行の有無だけの差から架空の1行を作らない', () => {
	for (const [a, b] of [
		['a', 'a\n'],
		['a\n', 'a'],
		['a\nb', 'a\nb\n'],
	]) {
		const result = computeDiff(a, b, 'lines');
		assert.strictEqual(result.addedLines, 0, `${JSON.stringify([a, b])}`);
		assert.strictEqual(result.removedLines, 0, `${JSON.stringify([a, b])}`);
	}
});

test('computeDiff: 末尾改行なしテキストへの空行追加は追加1行', () => {
	const result = computeDiff('a', 'a\n\n', 'lines');
	assert.strictEqual(result.addedLines, 1);
	assert.strictEqual(result.removedLines, 0);
});

test('computeDiff: 既存の行追加・削除の行数は空行を含まない通常ケースで変わらない', () => {
	const result = computeDiff('a\nb\nc\n', 'a\nx\nc\n', 'lines');
	assert.strictEqual(result.addedLines, 1);
	assert.strictEqual(result.removedLines, 1);
});

test('computeDiff: charsモードの行数は差分断片に含まれる行区切りの区間数（空行も1行）', () => {
	// 改行1文字だけの追加は1行、空文字断片は行にならない
	const nl = computeDiff('a', 'a\n', 'chars');
	assert.strictEqual(nl.addedChars, 1);
	assert.strictEqual(nl.addedLines, 1);

	// 文字の挿入は従来どおり1行として数える
	const ins = computeDiff('abc', 'abXc', 'chars');
	assert.strictEqual(ins.addedChars, 1);
	assert.strictEqual(ins.addedLines, 1);
	assert.strictEqual(ins.removedLines, 0);

	// 差分なしは0
	const same = computeDiff('abc', 'abc', 'chars');
	assert.strictEqual(same.addedLines, 0);
	assert.strictEqual(same.removedLines, 0);
});

test('computeDiff: 内部予算を超える差分を中止する', () => {
	for (const mode of ['lines', 'chars'] as const) {
		const a = mode === 'lines' ? 'a\n'.repeat(6) : 'aaaaaa';
		const b = mode === 'lines' ? 'b\n'.repeat(6) : 'bbbbbb';
		assert.throws(
			() => computeDiff(a, b, mode, { maxEditLength: 10, timeout: 500 }),
			/比較の計算量または時間/,
		);
	}
});

test('text-diff 解説文: 未提供の「無視オプション」を提供済みとして説明しない', () => {
	const md = readFileSync('src/content/tools/text-diff.md', 'utf8');
	const summary = /^summary:\s*"(.*)"$/m.exec(md)?.[1] ?? '';
	assert.ok(summary.length > 0, 'summaryが取得できること');
	assert.doesNotMatch(summary, /無視オプション|無視/);

	const faq = [...md.matchAll(/- q: "(.*)"\n\s+a: "(.*)"/g)].map((m) => ({
		q: m[1],
		a: m[2],
	}));
	const ignoreFaq = faq.filter(({ q }) => /無視/.test(q));
	assert.strictEqual(ignoreFaq.length, 2, '無視に関するFAQが2件あること');
	for (const { a } of ignoreFaq) {
		assert.doesNotMatch(a, /^はい/);
		assert.match(a, /提供していません/);
		assert.match(a, /区別/);
	}
	assert.doesNotMatch(md, /「(空白|大文字小文字)を無視」/);
});

test('computeDiff: 大文字小文字・空白だけの違いも差分として検出する（FAQの「区別して比較」と一致）', () => {
	const caseDiff = computeDiff('Hello', 'hello', 'lines');
	assert.ok(caseDiff.parts.some((p) => p.type === 'added'));
	assert.ok(caseDiff.parts.some((p) => p.type === 'removed'));
	const spaceDiff = computeDiff('a b', 'a  b', 'lines');
	assert.ok(spaceDiff.parts.some((p) => p.type === 'added'));
	assert.ok(spaceDiff.parts.some((p) => p.type === 'removed'));
});
