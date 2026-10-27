import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	evaluate,
	findClassification,
	readFixLoops,
} from '../../scripts/lib/pr-gate.mjs';
import { collect, createClient } from '../../scripts/pr-gate-status.mjs';

const REPO = 'code-life-cafe/tools-codelife-cafe';
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const MERGE = 'd'.repeat(40);
const BOT = 'chatgpt-codex-connector[bot]';

type Overrides = Record<string, unknown>;

const botSummary = (sha: string, over: Overrides = {}) => {
	const review = {
		commit_sha: sha,
		has_any_findings: false,
		has_unresolved_findings: false,
		status: 'completed',
	};
	const state = {
		code_review: { ...review, ...(over.code as object) },
		security_review: { ...review, ...(over.security as object) },
	};
	const meta = {
		blockingSeverityThreshold: 'P0',
		headSha: sha,
		mergeGateEnabled: false,
		pullRequestNumber: 7,
		repository: REPO,
		status: 'completed',
		...(over.meta as object),
	};
	return {
		id: 1,
		login: BOT,
		createdAt: '2026-10-28T00:00:00Z',
		updatedAt: '2026-10-28T00:00:00Z',
		body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify(state)} -->\n<!-- codex-security-review:v1 ${JSON.stringify(meta)} -->\n## Codex Review Summary`,
	};
};
const classification = (
	sha: string,
	klass = 'A',
	login = 'maru0014',
	extra = '',
) => ({
	id: 2,
	login,
	createdAt: '2026-10-28T00:01:00Z',
	body: `Codexによる独立分類 対象head ${sha}\n**独立分類: ${klass} / R1.** ${extra}`,
});
const check = (name: string, over: Overrides = {}) => ({
	name,
	status: 'completed',
	conclusion: 'success',
	headSha: HEAD,
	startedAt: '2026-10-28T00:00:00Z',
	...over,
});

type Snap = { pr: Record<string, unknown>; comments: unknown[] } & Record<
	string,
	unknown
>;
const snap = (over: Overrides = {}): Snap => ({
	repo: REPO,
	errors: [],
	pr: {
		number: 7,
		state: 'open',
		draft: false,
		merged: false,
		headSha: HEAD,
		baseRef: 'main',
		baseSha: BASE,
		mergeableState: 'clean',
		mergeCommitSha: null,
		body: '修正ループ: 0/3',
	},
	comments: [botSummary(HEAD), classification(HEAD)],
	checks: [check('lint'), check('e2e')],
	behindBy: 0,
	rules: { strict: true, requiredChecks: ['e2e', 'lint'] },
	unresolvedThreads: 0,
	...over,
});

test('全条件成立で merge-ready（head指定のMerge案を返し、Merge自体は行わない）', () => {
	const v = evaluate(snap());
	assert.equal(v.state, 'merge-ready');
	assert.equal(v.suggest, `merge --match-head-commit ${HEAD}`);
});

test('Draftで必須CI成功なら ready、CI未成功なら wait-ci', () => {
	const draft = {
		number: 7,
		state: 'open',
		draft: true,
		merged: false,
		headSha: HEAD,
		baseSha: BASE,
		mergeableState: 'clean',
		body: '',
	};
	assert.equal(evaluate(snap({ pr: draft })).state, 'ready');
	assert.equal(
		evaluate(
			snap({
				pr: draft,
				checks: [
					check('lint'),
					check('e2e', { status: 'in_progress', conclusion: null }),
				],
			}),
		).state,
		'wait-ci',
	);
});

test('baseが進んだheadは sync-base（CI待ちより優先）', () => {
	const v = evaluate(
		snap({
			behindBy: 2,
			checks: [check('lint', { status: 'in_progress', conclusion: null })],
		}),
	);
	assert.equal(v.state, 'sync-base');
});

test('旧headのCI成功は無視し、対象headの未起動は wait-ci', () => {
	const v = evaluate(
		snap({
			checks: [check('lint', { headSha: OLD }), check('e2e', { headSha: OLD })],
		}),
	);
	assert.equal(v.state, 'wait-ci');
	assert.equal(v.retriable, true);
});

test('必須CI失敗は blocked（成功扱いにしない）', () => {
	const v = evaluate(
		snap({ checks: [check('lint'), check('e2e', { conclusion: 'failure' })] }),
	);
	assert.equal(v.state, 'blocked');
	assert.match(v.reasons[0], /e2e:failure/);
});

test('Codex未取得・Running・旧SHAは wait-review、Code対象SHA欠落は再依頼候補つき', () => {
	assert.equal(
		evaluate(snap({ comments: [classification(HEAD)] })).state,
		'wait-review',
	);
	assert.equal(
		evaluate(
			snap({
				comments: [
					botSummary(HEAD, { code: { status: 'running' } }),
					classification(HEAD),
				],
			}),
		).state,
		'wait-review',
	);
	assert.equal(
		evaluate(snap({ comments: [botSummary(OLD), classification(HEAD)] })).state,
		'wait-review',
	);
	const missing = evaluate(
		snap({
			comments: [
				botSummary(HEAD, { code: { commit_sha: undefined } }),
				classification(HEAD),
			],
		}),
	);
	assert.equal(missing.state, 'wait-review');
	assert.match(missing.reasons[0], /commit_sha/);
	assert.match(missing.suggest, /request-review-once/);
});

test('未知形式・他PRのCodexサマリーは合格にしない', () => {
	const broken = {
		...botSummary(HEAD),
		body: '<!-- codex-review-state:v1 {not json} -->',
	};
	assert.equal(
		evaluate(snap({ comments: [broken, classification(HEAD)] })).state,
		'wait-review',
	);
	const other = botSummary(HEAD, { meta: { pullRequestNumber: 8 } });
	assert.equal(
		evaluate(snap({ comments: [other, classification(HEAD)] })).state,
		'wait-review',
	);
});

test('botを装う利用者コメントはCodex完了信号にならない', () => {
	const fake = { ...botSummary(HEAD), login: 'maru0014' };
	assert.equal(
		evaluate(snap({ comments: [fake, classification(HEAD)] })).state,
		'wait-review',
	);
});

test('Codexの指摘が未解決なら blocked', () => {
	const v = evaluate(
		snap({
			comments: [
				botSummary(HEAD, { code: { has_unresolved_findings: true } }),
				classification(HEAD),
			],
		}),
	);
	assert.equal(v.state, 'blocked');
});

test('同一headの独立分類がなければ wait-classification。「重大指摘なし」や旧head分類では代替しない', () => {
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD)] })).state,
		'wait-classification',
	);
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), classification(OLD)] })).state,
		'wait-classification',
	);
	const noIssue = {
		id: 3,
		login: 'maru0014',
		createdAt: '2026-10-28T00:02:00Z',
		body: `${HEAD} 重大な指摘なし`,
	};
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), noIssue] })).state,
		'wait-classification',
	);
});

test('Claude自身の分類・部外者の分類は証拠にならない（自己承認禁止）', () => {
	const self = classification(
		HEAD,
		'A',
		'maru0014',
		'\n---\n_Generated by [Claude Code](https://claude.ai/code)_',
	);
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), self] })).state,
		'wait-classification',
	);
	assert.equal(
		evaluate(
			snap({
				comments: [botSummary(HEAD), classification(HEAD, 'A', 'someone-else')],
			}),
		).state,
		'wait-classification',
	);
});

test('構造化マーカーの分類を受け付け、head不一致は無視する', () => {
	const marker = (sha: string) => ({
		id: 4,
		login: BOT,
		createdAt: '2026-10-28T00:03:00Z',
		body: `<!-- codex-classification:v1 {"headSha":"${sha}","class":"A","risk":"R1"} -->`,
	});
	assert.equal(findClassification([marker(HEAD)], HEAD).length, 1);
	assert.equal(findClassification([marker(OLD)], HEAD).length, 0);
});

test('分類が矛盾したら厳しい側。B/Cは承認確認が必要で自動判定しない', () => {
	const v = evaluate(
		snap({
			comments: [
				botSummary(HEAD),
				classification(HEAD, 'A'),
				{ ...classification(HEAD, 'B'), id: 9 },
			],
		}),
	);
	assert.equal(v.state, 'blocked');
	assert.equal(v.classification, 'B');
});

test('修正ループは履歴の最大値を採用し、3周超過は blocked、履歴なしはmerge-readyにしない', () => {
	assert.equal(readFixLoops(['修正ループ: 1/3', '修正ループ: 2/3', null]), 2);
	assert.equal(
		evaluate(snap({ pr: { ...snap().pr, body: '修正ループ: 4/3' } })).state,
		'blocked',
	);
	const none = evaluate(snap({ pr: { ...snap().pr, body: '' } }));
	assert.equal(none.state, 'blocked');
	assert.equal(none.retriable, true);
});

test('未解決thread・thread取得不能・strict未確認は merge-ready にしない', () => {
	assert.equal(evaluate(snap({ unresolvedThreads: 1 })).state, 'blocked');
	assert.equal(evaluate(snap({ unresolvedThreads: null })).state, 'blocked');
	assert.equal(
		evaluate(
			snap({ rules: { strict: false, requiredChecks: ['lint', 'e2e'] } }),
		).state,
		'blocked',
	);
	assert.equal(evaluate(snap({ rules: undefined })).state, 'blocked');
});

test('取得失敗（PR/コメント/check/behind）は合格にせず blocked(retriable)', () => {
	assert.equal(evaluate({ repo: REPO, errors: ['pull: 500'] }).retriable, true);
	for (const key of ['comments', 'checks', 'behindBy']) {
		const v = evaluate(snap({ [key]: null }));
		assert.equal(v.state, 'blocked', key);
		assert.equal(v.retriable, true, key);
	}
});

test('競合は blocked', () => {
	assert.equal(
		evaluate(snap({ pr: { ...snap().pr, mergeableState: 'dirty' } })).state,
		'blocked',
	);
});

test('重複イベント・再起動: 同じ入力は同じ判定で、コメント順や重複に依存しない', () => {
	const s = snap();
	const a = evaluate(s);
	const reordered = snap({
		comments: [...s.comments, ...s.comments].reverse(),
	});
	assert.deepEqual(evaluate(reordered), a);
	assert.deepEqual(evaluate(structuredClone(s)), a);
});

test('headが進んだら旧head向けの完了・分類は引き継がれない', () => {
	const NEW = 'e'.repeat(40);
	const s = snap({
		pr: { ...snap().pr, headSha: NEW },
		checks: [check('lint', { headSha: NEW }), check('e2e', { headSha: NEW })],
	});
	assert.equal(evaluate(s).state, 'wait-review');
});

test('Merge後: wait-deploy → verify-production → close → done、Deploy失敗は blocked', () => {
	const merged = {
		...snap().pr,
		state: 'closed',
		merged: true,
		mergeCommitSha: MERGE,
	};
	const run = (over: Overrides) => ({
		runs: [
			{ headSha: MERGE, status: 'completed', conclusion: 'success', ...over },
		],
	});
	const verified = {
		id: 5,
		login: 'maru0014',
		createdAt: '2026-10-28T00:10:00Z',
		body: `公開SHA ${MERGE} / HTTP 200 を確認`,
	};
	assert.equal(
		evaluate(snap({ pr: merged, deploy: { runs: [] } })).state,
		'wait-deploy',
	);
	assert.equal(
		evaluate(
			snap({
				pr: merged,
				deploy: run({ status: 'in_progress', conclusion: null }),
			}),
		).state,
		'wait-deploy',
	);
	assert.equal(
		evaluate(snap({ pr: merged, deploy: run({ conclusion: 'failure' }) }))
			.state,
		'blocked',
	);
	assert.equal(
		evaluate(snap({ pr: merged, deploy: run({}), comments: [] })).state,
		'verify-production',
	);
	assert.equal(
		evaluate(
			snap({
				pr: merged,
				deploy: run({}),
				comments: [verified],
				issue: { state: 'open' },
			}),
		).state,
		'close',
	);
	assert.equal(
		evaluate(
			snap({
				pr: merged,
				deploy: run({}),
				comments: [verified],
				issue: { state: 'closed' },
			}),
		).state,
		'done',
	);
	assert.equal(
		evaluate(
			snap({
				pr: merged,
				deploy: run({}),
				comments: [{ ...verified, body: `公開確認 ${OLD} HTTP 200` }],
			}),
		).state,
		'verify-production',
	);
});

test('collect はGETとGraphQL(read)だけを使い、書き込み系を呼ばない', async () => {
	const calls: { method: string; url: string }[] = [];
	const json = (body: unknown) =>
		new Response(JSON.stringify(body), { status: 200 });
	const fetchImpl = async (url: string, init: { method: string }) => {
		calls.push({ method: init.method, url });
		if (url.endsWith('/graphql'))
			return json({
				data: {
					repository: {
						pullRequest: {
							reviewThreads: {
								nodes: [{ isResolved: true }, { isResolved: false }],
							},
						},
					},
				},
			});
		if (url.includes('/pulls/7'))
			return json({
				number: 7,
				state: 'open',
				draft: false,
				merged: false,
				head: { sha: HEAD },
				base: { ref: 'main', sha: BASE },
				mergeable_state: 'clean',
				body: '',
			});
		if (url.includes('/comments')) return json([]);
		if (url.includes('/check-runs')) return json({ check_runs: [] });
		if (url.includes('/compare/')) return json({ behind_by: 0 });
		if (url.includes('/rules/branches'))
			return json([
				{
					type: 'required_status_checks',
					parameters: {
						strict_required_status_checks_policy: true,
						required_status_checks: [{ context: 'lint' }, { context: 'e2e' }],
					},
				},
			]);
		return new Response('{}', { status: 404 });
	};
	const s = await collect(
		createClient({ token: 't', fetchImpl: fetchImpl as never }),
		{ repo: REPO, number: 7 },
	);
	assert.equal(s.unresolvedThreads, 1);
	assert.equal(s.rules.strict, true);
	assert.ok(
		calls.every((c) => c.method === 'GET' || c.url.endsWith('/graphql')),
	);
	assert.ok(
		calls
			.filter((c) => c.method !== 'GET')
			.every((c) => c.url.endsWith('/graphql')),
	);
});

test('collect: 認証なしでは未解決thread不明(null)になり、取得失敗はerrorsに残る', async () => {
	const fetchImpl = async (url: string) =>
		url.includes('/pulls/7')
			? new Response('{}', { status: 500 })
			: new Response('{}', { status: 404 });
	const s = await collect(createClient({ fetchImpl: fetchImpl as never }), {
		repo: REPO,
		number: 7,
	});
	assert.match(s.errors[0], /pull: GET .* -> 500/);
	assert.equal(evaluate(s).state, 'blocked');
});
