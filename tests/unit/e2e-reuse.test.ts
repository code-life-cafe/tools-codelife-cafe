import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	isCandidateRun,
	isFullSha,
	selectReusableRun,
} from '../../scripts/lib/e2e-reuse.mjs';

const TREE = 'a'.repeat(40);
const OTHER_TREE = 'b'.repeat(40);
const BEFORE = 'c'.repeat(40);
const HEAD1 = '1'.repeat(40);
const HEAD2 = '2'.repeat(40);

const run = (overrides: Record<string, unknown> = {}) => ({
	id: 1,
	event: 'pull_request',
	status: 'completed',
	conclusion: 'success',
	path: '.github/workflows/e2e.yml',
	head_sha: HEAD1,
	head_commit: { tree_id: TREE },
	html_url: 'https://example.invalid/run/1',
	...overrides,
});

const ancestorOf =
	(heads: string[]) => async (ancestor: string, descendant: string) =>
		ancestor === BEFORE && heads.includes(descendant);

test('isFullSha: 40桁の小文字16進数だけを受け付け、全0は拒否する', () => {
	assert.equal(isFullSha(TREE), true);
	assert.equal(isFullSha('0'.repeat(40)), false);
	assert.equal(isFullSha('A'.repeat(40)), false);
	assert.equal(isFullSha('a'.repeat(39)), false);
	assert.equal(isFullSha(undefined), false);
});

test('ツリーが同じで、push前のmainがheadの祖先なら流用する', async () => {
	const result = await selectReusableRun({
		runs: [run()],
		treeSha: TREE,
		beforeSha: BEFORE,
		isAncestor: ancestorOf([HEAD1]),
	});
	assert.equal(result.reuse, true);
	assert.equal(result.run?.id, 1);
});

test('ツリーが違えば流用しない', async () => {
	const result = await selectReusableRun({
		runs: [run({ head_commit: { tree_id: OTHER_TREE } })],
		treeSha: TREE,
		beforeSha: BEFORE,
		isAncestor: ancestorOf([HEAD1]),
	});
	assert.equal(result.reuse, false);
});

test('ツリーが同じでも、push前のmainがheadの祖先でなければ流用しない', async () => {
	const result = await selectReusableRun({
		runs: [run()],
		treeSha: TREE,
		beforeSha: BEFORE,
		isAncestor: ancestorOf([]),
	});
	assert.equal(result.reuse, false);
});

test('祖先条件を満たす候補が後ろにあれば、それを選ぶ', async () => {
	const result = await selectReusableRun({
		runs: [run({ id: 1, head_sha: HEAD1 }), run({ id: 2, head_sha: HEAD2 })],
		treeSha: TREE,
		beforeSha: BEFORE,
		isAncestor: ancestorOf([HEAD2]),
	});
	assert.equal(result.reuse, true);
	assert.equal(result.run?.id, 2);
});

test('成功していない・PR以外・別workflow・未完了・head不正のrunは候補にしない', async () => {
	const bad = [
		run({ conclusion: 'failure' }),
		run({ conclusion: 'cancelled' }),
		run({ conclusion: null, status: 'in_progress' }),
		run({ event: 'push' }),
		run({ event: 'workflow_call' }),
		run({ path: '.github/workflows/deploy.yml' }),
		run({ head_sha: 'not-a-sha' }),
		run({ head_commit: null }),
		null,
	];
	for (const r of bad) assert.equal(isCandidateRun(r, TREE), false);
	let called = false;
	const result = await selectReusableRun({
		runs: bad,
		treeSha: TREE,
		beforeSha: BEFORE,
		isAncestor: async () => {
			called = true;
			return true;
		},
	});
	assert.equal(result.reuse, false);
	assert.equal(called, false);
});

test('push前のmainのSHAがない（初回push・全0）なら照合せず流用しない', async () => {
	for (const beforeSha of [undefined, '', '0'.repeat(40)]) {
		const result = await selectReusableRun({
			runs: [run()],
			treeSha: TREE,
			beforeSha,
			isAncestor: async () => true,
		});
		assert.equal(result.reuse, false);
	}
});

test('API応答やツリーSHAが不正なら例外にする（呼び出し側でE2E実行に倒す）', async () => {
	await assert.rejects(
		selectReusableRun({
			runs: undefined,
			treeSha: TREE,
			beforeSha: BEFORE,
			isAncestor: async () => true,
		}),
	);
	await assert.rejects(
		selectReusableRun({
			runs: [run()],
			treeSha: 'xyz',
			beforeSha: BEFORE,
			isAncestor: async () => true,
		}),
	);
});

test('祖先判定が例外を投げたら、そのまま例外にする', async () => {
	await assert.rejects(
		selectReusableRun({
			runs: [run()],
			treeSha: TREE,
			beforeSha: BEFORE,
			isAncestor: async () => {
				throw new Error('fetch失敗');
			},
		}),
		/fetch失敗/,
	);
});
