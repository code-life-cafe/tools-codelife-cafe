import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	changesRequestedBy,
	evaluate,
	readClaudeReview,
	readFixLoops,
	validateReviewRecord,
} from '../../scripts/lib/pr-gate.mjs';
import { collect, createClient } from '../../scripts/pr-gate-status.mjs';

const REPO = 'code-life-cafe/tools-codelife-cafe';
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const MERGE = 'd'.repeat(40);
const ACTIONS_APP = 15368;
const NOW = Date.parse('2026-10-28T03:00:00Z');

type Overrides = Record<string, unknown>;
type Snap = { pr: Record<string, unknown>; comments: unknown[] } & Record<
	string,
	unknown
>;

const MAKER = 'thread:cmsg_maker_001';
const REVIEWER = 'subagent:review-agent-001';

// 実装者と別のClaudeサブエージェントのレビュー記録(claude-review:v1)。人間アカウント(User)名義のコメントとして残す。
const record = (over: Overrides = {}, sha = HEAD) => ({
	repository: REPO,
	pullRequestNumber: 7,
	headSha: sha,
	reviewerRef: REVIEWER,
	makerRef: MAKER,
	round: 1,
	status: 'completed',
	scope: { code: true, tests: true, security: true, classification: true },
	findings: [],
	unverified: [],
	classification: {
		class: 'A',
		risk: 'R1',
		approvalStatus: 'not-required',
		approvalRef: null,
		unapprovedScope: [],
	},
	...over,
});
const review = (over: Overrides = {}, sha = HEAD, extra: Overrides = {}) => ({
	id: 1,
	login: 'maru0014',
	authorType: 'User',
	authorAssociation: 'OWNER',
	createdAt: '2026-10-28T00:00:00Z',
	body: `<!-- claude-review:v1 ${JSON.stringify(record(over, sha))} -->`,
	...extra,
});
const cls = (over: Overrides) => ({
	...record().classification,
	...over,
});
const check = (name: string, over: Overrides = {}) => ({
	name,
	status: 'completed',
	conclusion: 'success',
	headSha: HEAD,
	startedAt: '2026-10-28T00:00:00Z',
	appId: ACTIONS_APP,
	...over,
});

const snap = (over: Overrides = {}): Snap => ({
	repo: REPO,
	errors: [],
	now: NOW,
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
		headCommittedAt: '2026-10-28T02:55:00Z',
	},
	comments: [review()],
	checks: [check('lint'), check('e2e')],
	reviews: [],
	behindBy: 0,
	rules: {
		strict: true,
		enforcement: 'active',
		bypassActors: 0,
		requiredChecks: [
			{ context: 'e2e', integrationId: ACTIONS_APP },
			{ context: 'lint', integrationId: ACTIONS_APP },
		],
	},
	unresolvedThreads: 0,
	...over,
});
const withPr = (over: Overrides) => ({ ...snap().pr, ...over });

test('全条件成立で merge-ready（head指定のMerge案を返し、Merge自体は行わない）', () => {
	const v = evaluate(snap());
	assert.equal(v.state, 'merge-ready');
	assert.equal(v.suggest, `merge --match-head-commit ${HEAD}`);
	assert.equal(v.classification, 'A');
});

test('Draftで必須CI成功なら ready、CI未成功なら wait-ci', () => {
	const pr = withPr({ draft: true });
	assert.equal(evaluate(snap({ pr })).state, 'ready');
	const running = [
		check('lint'),
		check('e2e', { status: 'in_progress', conclusion: null }),
	];
	assert.equal(evaluate(snap({ pr, checks: running })).state, 'wait-ci');
});

test('baseが進んだheadは sync-base（CI待ちより優先）', () => {
	const checks = [check('lint', { status: 'in_progress', conclusion: null })];
	assert.equal(evaluate(snap({ behindBy: 2, checks })).state, 'sync-base');
});

test('旧headのCI成功は無視し、対象headの未起動は wait-ci', () => {
	const checks = [
		check('lint', { headSha: OLD }),
		check('e2e', { headSha: OLD }),
	];
	const v = evaluate(snap({ checks }));
	assert.equal(v.state, 'wait-ci');
	assert.equal(v.retriable, true);
});

test('必須CI失敗は blocked（成功扱いにしない）', () => {
	const checks = [check('lint'), check('e2e', { conclusion: 'failure' })];
	const v = evaluate(snap({ checks }));
	assert.equal(v.state, 'blocked');
	assert.match(v.reasons[0], /e2e:failure/);
});

test('指摘5: 同名checkでも required の integration_id と異なるappの成功は無視する', () => {
	const forged = [check('lint'), check('e2e', { appId: 999 })];
	assert.equal(evaluate(snap({ checks: forged })).state, 'wait-ci');
});

test('指摘5: rulesetの必須checkが増えたら、それも成功するまで待つ', () => {
	const rules = {
		...(snap().rules as object),
		requiredChecks: [
			{ context: 'e2e', integrationId: ACTIONS_APP },
			{ context: 'lint', integrationId: ACTIONS_APP },
			{ context: 'extra', integrationId: ACTIONS_APP },
		],
	};
	const v = evaluate(snap({ rules }));
	assert.equal(v.state, 'wait-ci');
	assert.match(v.reasons.join(), /extra/);
});

test('指摘5: 人間のCHANGES_REQUESTEDが残る間は blocked、DISMISSEDやbotは対象外', () => {
	const cr = {
		login: 'rev',
		authorType: 'User',
		state: 'CHANGES_REQUESTED',
		submittedAt: '2026-10-28T01:00:00Z',
	};
	assert.equal(evaluate(snap({ reviews: [cr] })).state, 'blocked');
	assert.deepEqual(changesRequestedBy([cr]), ['rev']);
	const dismissed = {
		...cr,
		state: 'DISMISSED',
		submittedAt: '2026-10-28T02:00:00Z',
	};
	assert.deepEqual(changesRequestedBy([cr, dismissed]), []);
	assert.deepEqual(changesRequestedBy([{ ...cr, authorType: 'Bot' }]), []);
	assert.equal(
		evaluate(snap({ reviews: [cr, dismissed] })).state,
		'merge-ready',
	);
});

test('指摘5: bypass actorがある/確認できない/activeでないrulesetは merge-ready にしない', () => {
	const rules = snap().rules as Record<string, unknown>;
	assert.equal(
		evaluate(snap({ rules: { ...rules, bypassActors: 1 } })).state,
		'blocked',
	);
	const unknown = evaluate(snap({ rules: { ...rules, bypassActors: null } }));
	assert.equal(unknown.state, 'blocked');
	assert.equal(unknown.retriable, true);
	assert.equal(
		evaluate(snap({ rules: { ...rules, enforcement: 'other' } })).state,
		'blocked',
	);
});

test('修正ループは履歴の最大値を採用し、3周超過は blocked、履歴なしはmerge-readyにしない', () => {
	assert.equal(readFixLoops(['修正ループ: 1/3', '修正ループ: 2/3', null]), 2);
	assert.equal(
		evaluate(snap({ pr: withPr({ body: '修正ループ: 4/3' }) })).state,
		'blocked',
	);
	const none = evaluate(snap({ pr: withPr({ body: '' }) }));
	assert.equal(none.state, 'blocked');
	assert.equal(none.retriable, true);
});

test('未解決thread・thread取得不能・strict未確認は merge-ready にしない', () => {
	assert.equal(evaluate(snap({ unresolvedThreads: 1 })).state, 'blocked');
	assert.equal(evaluate(snap({ unresolvedThreads: null })).state, 'blocked');
	const rules = snap().rules as Record<string, unknown>;
	assert.equal(
		evaluate(snap({ rules: { ...rules, strict: false } })).state,
		'blocked',
	);
	assert.equal(evaluate(snap({ rules: null })).state, 'blocked');
});

test('取得失敗（PR/コメント/check/review/behind）は合格にせず blocked(retriable)', () => {
	assert.equal(evaluate({ repo: REPO, errors: ['pull: 500'] }).retriable, true);
	for (const key of ['comments', 'checks', 'reviews', 'behindBy']) {
		const v = evaluate(snap({ [key]: null }));
		assert.equal(v.state, 'blocked', key);
		assert.equal(v.retriable, true, key);
	}
});

test('指摘1: 取得中にhead/baseが変わったsnapshotは再取得（merge-readyにしない）', () => {
	const v = evaluate(snap({ inconsistent: 'headSha' }));
	assert.equal(v.state, 'blocked');
	assert.equal(v.retriable, true);
});

test('競合は blocked', () => {
	assert.equal(
		evaluate(snap({ pr: withPr({ mergeableState: 'dirty' }) })).state,
		'blocked',
	);
});

test('重複イベント・再起動: 同じ入力は同じ判定で、コメント順や重複に依存しない', () => {
	const s = snap();
	const a = evaluate(s);
	assert.deepEqual(
		evaluate(snap({ comments: [...s.comments, ...s.comments].reverse() })),
		a,
	);
	assert.deepEqual(evaluate(structuredClone(s)), a);
});

test('headが進んだら旧head向けの完了・分類は引き継がれない', () => {
	const NEW = 'e'.repeat(40);
	const s = snap({
		pr: withPr({ headSha: NEW }),
		checks: [check('lint', { headSha: NEW }), check('e2e', { headSha: NEW })],
	});
	assert.equal(evaluate(s).state, 'wait-review');
});

// ---- Merge後 ----
const merged = () =>
	withPr({ state: 'closed', merged: true, mergeCommitSha: MERGE });
const job = (name: string, conclusion = 'success', status = 'completed') => ({
	name,
	status,
	conclusion,
});
const deployRun = (over: Overrides = {}, jobs?: unknown[]) => ({
	runs: [
		{
			id: 111,
			attempt: 1,
			headSha: MERGE,
			event: 'push',
			branch: 'main',
			status: 'completed',
			conclusion: 'success',
			jobs: jobs ?? [job('deploy'), job('production-smoke')],
			...over,
		},
	],
});
const issue = (over: Overrides = {}) => ({
	state: 'open',
	body: '- [x] AC1\n- [x] AC2',
	...over,
});
const post = (over: Overrides = {}) =>
	snap({
		pr: merged(),
		deploy: deployRun(),
		issueNumber: 526,
		issue: issue(),
		...over,
	});

test('Merge後: wait-deploy → verify-production → close → done', () => {
	assert.equal(evaluate(post({ deploy: { runs: [] } })).state, 'wait-deploy');
	assert.equal(
		evaluate(
			post({
				deploy: deployRun({ status: 'in_progress', conclusion: null }, [
					job('deploy'),
					job('production-smoke', null as never, 'in_progress'),
				]),
			}),
		).state,
		'wait-deploy',
	);
	assert.equal(
		evaluate(post({ deploy: deployRun({}, [job('deploy')]) })).state,
		'verify-production',
	);
	const close = evaluate(post());
	assert.equal(close.state, 'close');
	assert.equal(close.runId, 111);
	assert.equal(
		evaluate(post({ issue: issue({ state: 'closed' }) })).state,
		'done',
	);
});

test('指摘3: 公開検証(production-smoke)の失敗はDeploy成功と混同せず blocked', () => {
	const failed = deployRun({ conclusion: 'failure' }, [
		job('deploy'),
		job('production-smoke', 'failure'),
	]);
	const v = evaluate(post({ deploy: failed }));
	assert.equal(v.state, 'blocked');
	assert.match(v.reasons[0], /production-smoke/);
	const skipped = deployRun({}, [
		job('deploy'),
		job('production-smoke', 'skipped'),
	]);
	assert.equal(evaluate(post({ deploy: skipped })).state, 'blocked');
	assert.equal(
		evaluate(
			post({
				deploy: deployRun({ conclusion: 'failure' }, [
					job('deploy', 'failure'),
				]),
			}),
		).state,
		'blocked',
	);
});

test('指摘3: 誰かのコメント文字列（計画・否定文を含む）は公開確認の証拠にならない', () => {
	const plan = {
		id: 1,
		login: 'anyone',
		authorType: 'User',
		createdAt: 'x',
		body: `これから公開SHA ${MERGE} を確認し HTTP 200 を確認する予定`,
	};
	const v = evaluate(
		post({ deploy: deployRun({}, [job('deploy')]), comments: [plan] }),
	);
	assert.equal(v.state, 'verify-production');
});

test('指摘3: 別SHA・pull_request・別branch・旧attemptのDeployは証拠にしない', () => {
	for (const o of [
		{ headSha: OLD },
		{ event: 'pull_request' },
		{ branch: 'feature' },
	]) {
		assert.equal(
			evaluate(post({ deploy: deployRun(o) })).state,
			'wait-deploy',
			JSON.stringify(o),
		);
	}
	const two = {
		runs: [
			{ ...deployRun().runs[0], attempt: 1 },
			{
				...deployRun().runs[0],
				attempt: 2,
				conclusion: 'failure',
				jobs: [job('deploy'), job('production-smoke', 'failure')],
			},
		],
	};
	assert.equal(evaluate(post({ deploy: two })).state, 'blocked');
});

test('指摘3: Issue未指定・取得失敗・AC未完了は close/done にしない。comments=null でも例外にしない', () => {
	assert.equal(
		evaluate(post({ issueNumber: null, issue: undefined })).state,
		'blocked',
	);
	const fetchFail = evaluate(post({ issue: null }));
	assert.equal(fetchFail.state, 'blocked');
	assert.equal(fetchFail.retriable, true);
	const open = evaluate(
		post({ issue: issue({ body: '- [x] AC1\n- [ ] AC2' }) }),
	);
	assert.equal(open.state, 'blocked');
	assert.match(open.reasons[0], /未チェックAC/);
	assert.doesNotThrow(() => evaluate(post({ comments: null })));
	assert.equal(evaluate(post({ deploy: null })).state, 'blocked');
	assert.equal(
		evaluate(post({ deploy: deployRun({ jobs: null }) })).state,
		'blocked',
	);
});

// ---- 2周目の指摘 ----
test('2周目2: run集約が未完了でも、同じrun・attemptの必須jobが成功なら判定する。1jobでも未完了/失敗/欠落/別attemptなら進めない', () => {
	const running = { status: 'in_progress', conclusion: null };
	assert.equal(evaluate(post({ deploy: deployRun(running) })).state, 'close');
	const smokeRunning = [
		job('deploy'),
		job('production-smoke', null as never, 'in_progress'),
	];
	assert.equal(
		evaluate(post({ deploy: deployRun(running, smokeRunning) })).state,
		'wait-deploy',
	);
	assert.equal(
		evaluate(post({ deploy: deployRun(running, [job('deploy')]) })).state,
		'wait-deploy',
	);
	assert.equal(
		evaluate(
			post({
				deploy: deployRun(running, [
					job('deploy', 'failure'),
					job('production-smoke', null as never, 'queued'),
				]),
			}),
		).state,
		'blocked',
	);
	assert.equal(
		evaluate(
			post({
				deploy: deployRun(running, [
					job('deploy'),
					job('production-smoke', 'failure'),
				]),
			}),
		).state,
		'blocked',
	);
	// 完了済みrunでsmoke job欠落は verify-production（導入前のrun）
	assert.equal(
		evaluate(post({ deploy: deployRun({}, [job('deploy')]) })).state,
		'verify-production',
	);
	// 別attemptのjobは、このattemptの証拠にならない
	const other = [
		{ ...job('deploy'), runAttempt: 1 },
		{ ...job('production-smoke'), runAttempt: 1 },
	];
	const v = evaluate(
		post({ deploy: deployRun({ attempt: 2, ...running }, other) }),
	);
	assert.equal(v.state, 'wait-deploy');
});

test('3周目1: マージで自動closeされたIssueでも、未チェックACが残るなら done にしない', () => {
	const v = evaluate(
		post({ issue: issue({ state: 'closed', body: '- [x] AC1\n- [ ] AC2' }) }),
	);
	assert.equal(v.state, 'blocked');
	assert.match(v.reasons[0], /未チェックACが1件/);
	assert.equal(
		evaluate(post({ issue: issue({ state: 'closed' }) })).state,
		'done',
	);
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status });

function fakeGithub(
	over: Record<
		string,
		(url: string, init: { body?: string }) => Response | undefined
	> = {},
) {
	const calls: { method: string; url: string }[] = [];
	const impl = async (url: string, init: { method: string; body?: string }) => {
		calls.push({ method: init.method, url });
		for (const [k, fn] of Object.entries(over)) {
			if (url.includes(k)) {
				const r = fn(url, init);
				if (r) return r;
			}
		}
		if (url.endsWith('/graphql'))
			return json({
				data: {
					repository: {
						pullRequest: {
							reviewThreads: {
								pageInfo: { hasNextPage: false, endCursor: null },
								nodes: [{ isResolved: true }, { isResolved: false }],
							},
						},
					},
				},
			});
		if (url.includes('/pulls/7/reviews')) return json([]);
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
		if (url.includes('/check-runs'))
			return json({ total_count: 0, check_runs: [] });
		if (url.includes('/compare/')) return json({ behind_by: 0 });
		if (url.includes('/rulesets/'))
			return json({ enforcement: 'active', bypass_actors: [] });
		if (url.includes('/rules/branches'))
			return json([
				{
					type: 'required_status_checks',
					ruleset_id: 1,
					parameters: {
						strict_required_status_checks_policy: true,
						required_status_checks: [
							{ context: 'lint', integration_id: 15368 },
							{ context: 'e2e', integration_id: 15368 },
						],
					},
				},
			]);
		if (url.includes('/commits/'))
			return json({ commit: { committer: { date: '2026-10-28T00:00:00Z' } } });
		return json({}, 404);
	};
	return {
		calls,
		client: (token?: string) =>
			createClient({ token, fetchImpl: impl as never }),
	};
}

test('collect はGETとread用GraphQLだけを使い、書き込み系を呼ばない', async () => {
	const gh = fakeGithub();
	const s = await collect(gh.client('t'), { repo: REPO, number: 7 });
	assert.equal(s.unresolvedThreads, 1);
	assert.equal(s.rules.strict, true);
	assert.equal(s.rules.bypassActors, 0);
	assert.deepEqual(
		s.rules.requiredChecks.map(
			(r: { integrationId: number }) => r.integrationId,
		),
		[15368, 15368],
	);
	assert.ok(
		gh.calls
			.filter((c) => c.method !== 'GET')
			.every((c) => c.url.endsWith('/graphql')),
	);
	await assert.rejects(
		gh.client('t').graphql('mutation { x }', {}),
		/queryのみ/,
	);
});

test('collect は issue comment の author_association を authorAssociation として渡し、NONE の記録は採用されない', async () => {
	const body = review().body;
	const comment = (
		id: number,
		association: string,
		login: string,
		extra: Record<string, unknown> = {},
	) => ({
		id,
		user: { login, type: 'User' },
		author_association: association,
		body,
		created_at: '2026-10-28T00:00:00Z',
		updated_at: '2026-10-28T00:00:00Z',
		...extra,
	});
	const collectWith = async (comments: unknown[]) => {
		const gh = fakeGithub({
			'/issues/7/comments': () => json(comments),
		});
		return collect(gh.client('t'), { repo: REPO, number: 7 });
	};
	const owner = await collectWith([comment(1, 'OWNER', 'maru0014')]);
	assert.equal(owner.comments[0].authorAssociation, 'OWNER');
	assert.equal(owner.comments[0].authorType, 'User');
	const none = await collectWith([comment(2, 'NONE', 'rando')]);
	assert.equal(none.comments[0].authorAssociation, 'NONE');
	assert.equal(
		readClaudeReview(none.comments, {
			repo: REPO,
			number: 7,
			headSha: HEAD,
		}).code,
		'review-missing',
	);
	assert.equal(
		readClaudeReview(owner.comments, {
			repo: REPO,
			number: 7,
			headSha: HEAD,
		}).ok,
		true,
	);
});

test('指摘1: 未解決threadは次ページ以降も数える（101件目以降を無視しない）', async () => {
	const page = (n: number, next: boolean) =>
		json({
			data: {
				repository: {
					pullRequest: {
						reviewThreads: {
							pageInfo: { hasNextPage: next, endCursor: 'c' },
							nodes: Array.from({ length: n }, () => ({ isResolved: false })),
						},
					},
				},
			},
		});
	const gh = fakeGithub({
		'/graphql': (_u, init) =>
			JSON.parse(init.body ?? '{}').variables.after
				? page(50, false)
				: page(100, true),
	});
	const s = await collect(gh.client('t'), { repo: REPO, number: 7 });
	assert.equal(s.unresolvedThreads, 150);
});

test('指摘1: threadの途中ページ失敗・未知形式は null（不明）にしてfail-closed', async () => {
	const gh = fakeGithub({
		'/graphql': (_u, init) =>
			JSON.parse(init.body ?? '{}').variables.after
				? json({}, 502)
				: json({
						data: {
							repository: {
								pullRequest: {
									reviewThreads: {
										pageInfo: { hasNextPage: true, endCursor: 'c' },
										nodes: [],
									},
								},
							},
						},
					}),
	});
	const s = await collect(gh.client('t'), { repo: REPO, number: 7 });
	assert.equal(s.unresolvedThreads, null);
	assert.match(s.errors.join(), /threads/);
});

test('指摘1: コメントは1000件を超えても全ページ取得し、ページ上限で終わらなければ不完全として null', async () => {
	const many = (page: number) =>
		Array.from({ length: 100 }, (_, i) => ({
			id: page * 1000 + i,
			user: { login: 'x', type: 'User' },
			body: '',
			created_at: '2026-01-01T00:00:00Z',
		}));
	const gh = fakeGithub({
		'/issues/7/comments': (u) => {
			const p = Number(/[?&]page=(\d+)/.exec(u)?.[1]);
			return json(p <= 12 ? (p === 12 ? many(p).slice(0, 5) : many(p)) : []);
		},
	});
	const s = await collect(gh.client('t'), { repo: REPO, number: 7 });
	assert.equal(s.comments.length, 1105);
	const endless = fakeGithub({
		'/issues/7/comments': (u) =>
			json(many(Number(/[?&]page=(\d+)/.exec(u)?.[1]))),
	});
	const e = await collect(endless.client('t'), { repo: REPO, number: 7 });
	assert.equal(e.comments, null);
	assert.match(e.errors.join(), /不完全/);
});

test('指摘1: check-runsは100件を超えても全ページ取得し、不足なら null', async () => {
	const run = (i: number) => ({
		name: `c${i}`,
		status: 'completed',
		conclusion: 'success',
		head_sha: HEAD,
		started_at: '2026-01-01T00:00:00Z',
		app: { id: 15368 },
	});
	const gh = fakeGithub({
		'/check-runs': (u) => {
			const p = Number(/[?&]page=(\d+)/.exec(u)?.[1]);
			return json({
				total_count: 130,
				check_runs: Array.from(
					{ length: p === 1 ? 100 : p === 2 ? 30 : 0 },
					(_, i) => run(p * 1000 + i),
				),
			});
		},
	});
	assert.equal(
		(await collect(gh.client('t'), { repo: REPO, number: 7 })).checks.length,
		130,
	);
	const short = fakeGithub({
		'/check-runs': () => json({ total_count: 130, check_runs: [] }),
	});
	assert.equal(
		(await collect(short.client('t'), { repo: REPO, number: 7 })).checks,
		null,
	);
});

test('指摘1: 取得の途中でheadが進んだら不整合として検出する', async () => {
	let n = 0;
	const gh = fakeGithub({
		'/pulls/7': (u) => {
			if (u.includes('/reviews')) return undefined;
			n += 1;
			return json({
				number: 7,
				state: 'open',
				draft: false,
				merged: false,
				head: { sha: n === 1 ? HEAD : OLD },
				base: { ref: 'main', sha: BASE },
				mergeable_state: 'clean',
				body: '',
			});
		},
	});
	const s = await collect(gh.client('t'), { repo: REPO, number: 7 });
	assert.equal(s.inconsistent, 'headSha');
	assert.equal(evaluate(s).state, 'blocked');
});

test('未知形式のrules応答でも例外にせず rules=null（blocked）', async () => {
	const gh = fakeGithub({
		'/rules/branches': () => json({ message: 'weird' }),
	});
	const s = await collect(gh.client('t'), { repo: REPO, number: 7 });
	assert.equal(s.rules, null);
	assert.match(s.errors.join(), /rules/);
});

test('collect: 認証なしでは未解決thread不明(null)、PR取得失敗はerrorsに残って blocked', async () => {
	const s = await collect(fakeGithub().client(), { repo: REPO, number: 7 });
	assert.equal(s.unresolvedThreads, null);
	const failing = fakeGithub({ '/pulls/7': () => json({}, 500) });
	const f = await collect(failing.client(), { repo: REPO, number: 7 });
	assert.match(f.errors[0], /pull: GET .* -> 500/);
	assert.equal(evaluate(f).state, 'blocked');
});

test('collect(merge後): Deploy runのjobsを取得し、Issueの本文を読む', async () => {
	const gh = fakeGithub({
		'/pulls/7': (u) =>
			u.includes('/reviews')
				? undefined
				: json({
						number: 7,
						state: 'closed',
						draft: false,
						merged: true,
						merge_commit_sha: MERGE,
						head: { sha: HEAD },
						base: { ref: 'main', sha: BASE },
						body: '',
					}),
		'/workflows/deploy.yml/runs': () =>
			json({
				workflow_runs: [
					{
						id: 111,
						run_attempt: 1,
						head_sha: MERGE,
						event: 'push',
						head_branch: 'main',
						status: 'completed',
						conclusion: 'success',
					},
				],
			}),
		'/actions/runs/111/jobs': () =>
			json({
				jobs: [
					{ name: 'deploy', status: 'completed', conclusion: 'success' },
					{
						name: 'production-smoke',
						status: 'completed',
						conclusion: 'success',
					},
				],
			}),
		'/issues/526': () => json({ state: 'open', body: '- [x] AC' }),
	});
	const s = await collect(gh.client(), { repo: REPO, number: 7, issue: 526 });
	const v = evaluate(s);
	assert.equal(v.state, 'close');
	assert.equal(v.runId, 111);
});

test('レビュー記録が無ければ wait-review(unavailable)。Merge不可で、別担当レビューの実施を促す', () => {
	const v = evaluate(snap({ comments: [] }));
	assert.equal(v.state, 'wait-review');
	assert.equal(v.reviewState, 'unavailable');
	assert.equal(v.suggest, `run-independent-claude-review (head ${HEAD})`);
	assert.doesNotMatch(JSON.stringify(v), /@codex|request-once/);
});

test('旧headのレビュー記録は失効し、新headで再レビューが必要', () => {
	const v = evaluate(snap({ comments: [review({}, OLD)] }));
	assert.equal(v.state, 'wait-review');
	assert.equal(v.reviewState, 'stale');
	assert.equal(v.suggest, `run-independent-claude-review (head ${HEAD})`);
});

test('Bot名義・旧Codexマーカー・自由文・短SHAはレビュー証拠にならない', () => {
	const bot = review({}, HEAD, { login: 'some-bot[bot]', authorType: 'Bot' });
	const codexBot = review({}, HEAD, {
		login: 'chatgpt-codex-connector[bot]',
		authorType: 'Bot',
	});
	const free = {
		id: 3,
		login: 'maru0014',
		authorType: 'User',
		createdAt: '2026-10-28T00:00:00Z',
		body: `レビュー済み・指摘なし ${HEAD.slice(0, 7)}`,
	};
	const oldMarker = {
		...free,
		body: `<!-- codex-classification:v1 {"headSha":"${HEAD}"} -->`,
	};
	for (const comments of [[bot], [codexBot], [free], [oldMarker]]) {
		const v = evaluate(snap({ comments }));
		assert.equal(v.state, 'wait-review');
		assert.equal(v.reviewState, 'unavailable');
	}
});

test('実装者と同一の参照・subagent以外・参照欠落は独立レビューとして不合格', () => {
	for (const over of [
		{ reviewerRef: MAKER },
		{ reviewerRef: 'thread:cmsg_other_001' },
		{ makerRef: REVIEWER },
		{ makerRef: undefined },
		{ reviewerRef: undefined },
		{ reviewerRef: 'subagent:' },
	]) {
		const v = evaluate(snap({ comments: [review(over)] }));
		assert.equal(v.state, 'wait-review', JSON.stringify(over));
		assert.equal(v.reviewState, 'unknown');
	}
});

test('未完了・範囲不足・未確認項目・形式不正は合格にしない', () => {
	const bad: Overrides[] = [
		{ status: 'running' },
		{ status: undefined },
		{ scope: { code: true, tests: true, security: true } },
		{
			scope: { code: true, tests: true, security: true, classification: false },
		},
		{ unverified: ['E2E実機未確認'] },
		{ unverified: undefined },
		{ findings: undefined },
		{
			findings: [{ id: 'F1', severity: 'P1', blocking: true, status: 'open' }],
		},
		{
			findings: [
				{
					id: 'F1',
					severity: 'P9',
					blocking: true,
					status: 'open',
					evidence: 'x',
				},
			],
		},
		{ round: 0 },
		{ classification: undefined },
		{ headSha: HEAD.slice(0, 7) },
		{ pullRequestNumber: 8 },
		{ repository: 'other/repo' },
	];
	for (const over of bad) {
		const v = evaluate(snap({ comments: [review(over)] }));
		assert.equal(
			v.state === 'wait-review' || v.state === 'blocked',
			true,
			JSON.stringify(over),
		);
		assert.notEqual(v.state, 'merge-ready', JSON.stringify(over));
	}
});

test('blocking findingが未解決なら blocked。解消確認済み・非blocking・却下(根拠付き)は進める', () => {
	const f = (over: Overrides) => ({
		id: 'F1',
		severity: 'P1',
		blocking: true,
		status: 'open',
		evidence: 'src/a.ts:10 で境界値が欠落',
		...over,
	});
	const open = evaluate(snap({ comments: [review({ findings: [f({})] })] }));
	assert.equal(open.state, 'blocked');
	assert.equal(open.reviewState, 'findings');
	assert.equal(open.suggest, 'classify-and-fix-findings');
	for (const findings of [
		[f({ status: 'fixed-verified' })],
		[f({ status: 'dismissed', evidence: '誤検出: 該当経路はテストで確認' })],
		[f({ severity: 'P2', blocking: false })],
	]) {
		const v = evaluate(snap({ comments: [review({ findings })] }));
		assert.equal(v.state, 'merge-ready', JSON.stringify(findings));
	}
});

test('同一headでは最新の記録が有効。新しい記録でfindingsを解消でき、時刻が曖昧なら unknown', () => {
	const f = [
		{ id: 'F1', severity: 'P1', blocking: true, status: 'open', evidence: 'e' },
	];
	const first = review({ findings: f }, HEAD, {
		id: 1,
		createdAt: '2026-10-28T00:00:00Z',
	});
	const second = review({ round: 2 }, HEAD, {
		id: 2,
		createdAt: '2026-10-28T00:05:00Z',
	});
	assert.equal(evaluate(snap({ comments: [first] })).state, 'blocked');
	assert.equal(
		evaluate(snap({ comments: [first, second] })).state,
		'merge-ready',
	);
	assert.equal(
		evaluate(snap({ comments: [second, first] })).state,
		'merge-ready',
	);
	const same = review({ round: 3 }, HEAD, {
		id: 3,
		createdAt: '2026-10-28T00:05:00Z',
	});
	const amb = evaluate(snap({ comments: [first, second, same] }));
	assert.equal(amb.state, 'wait-review');
	assert.equal(amb.reviewState, 'unknown');
	const badTime = evaluate(
		snap({ comments: [review({}, HEAD, { createdAt: 'xx' })] }),
	);
	assert.equal(badTime.state, 'wait-review');
	// 同一内容の重複は冪等
	const dup = review({}, HEAD, { id: 9 });
	assert.equal(
		evaluate(snap({ comments: [review(), dup] })).state,
		'merge-ready',
	);
});

test('壊れた/重複したマーカー本文は不合格(fail-closed)', () => {
	const base = review();
	const broken = { ...base, body: '<!-- claude-review:v1 {oops} -->' };
	const dupMarker = { ...base, body: `${base.body}\n${base.body}` };
	const mention = { ...base, body: '説明: claude-review:v1 マーカーを残す' };
	for (const c of [broken, dupMarker]) {
		assert.equal(evaluate(snap({ comments: [c] })).state, 'wait-review');
	}
	assert.equal(
		evaluate(snap({ comments: [mention] })).reviewState,
		'unavailable',
	);
});

test('分類: 未承認B/Cは blocked。承認参照つき approved-B/C だけ継続し、R3は追加リスクレビュー記録が必要', () => {
	const unapproved = evaluate(
		snap({
			comments: [
				review({
					classification: cls({
						class: 'B',
						risk: 'R2',
						approvalStatus: 'unapproved',
						unapprovedScope: ['新規tool'],
					}),
				}),
			],
		}),
	);
	assert.equal(unapproved.state, 'blocked');
	assert.match(unapproved.classification, /unapproved-B/);
	const approvedB = evaluate(
		snap({
			comments: [
				review({
					classification: cls({
						class: 'B',
						risk: 'R2',
						approvalStatus: 'approved',
						approvalRef: '#12 plan',
					}),
				}),
			],
		}),
	);
	assert.equal(approvedB.state, 'merge-ready');
	assert.equal(approvedB.classification, 'approved-B');
	const approvedC = evaluate(
		snap({
			comments: [
				review({
					classification: cls({
						class: 'C',
						risk: 'R4',
						approvalStatus: 'approved',
						approvalRef: '#538 本人指示',
					}),
				}),
			],
		}),
	);
	assert.equal(approvedC.state, 'merge-ready');
	const r3 = (extra: Overrides) =>
		evaluate(
			snap({
				comments: [
					review({
						classification: cls({
							class: 'B',
							risk: 'R3',
							approvalStatus: 'approved',
							approvalRef: '#12',
							...extra,
						}),
					}),
				],
			}),
		);
	assert.equal(r3({}).state, 'blocked');
	assert.equal(r3({ additionalRiskReview: true }).state, 'merge-ready');
	for (const c of [
		cls({
			class: 'B',
			risk: 'R2',
			approvalStatus: 'approved',
			approvalRef: '  ',
		}),
		cls({ class: 'A', risk: 'R4' }),
		cls({ unapprovedScope: ['x'] }),
		cls({ approvalStatus: 'not_required' }),
		cls({ approvalRef: undefined }),
		cls({ headSha: OLD }),
	]) {
		const v = evaluate(snap({ comments: [review({ classification: c })] }));
		assert.equal(v.state, 'wait-review', JSON.stringify(c));
	}
});

test('readClaudeReview / validateReviewRecord は純粋関数として理由を返す', () => {
	const ctx = { repo: REPO, number: 7, headSha: HEAD };
	assert.equal(readClaudeReview([review()], ctx).ok, true);
	assert.equal(validateReviewRecord(null, ctx).ok, false);
	assert.equal(
		validateReviewRecord(record({ reviewerRef: MAKER }), ctx).ok,
		false,
	);
	assert.equal(validateReviewRecord(record(), ctx).ok, true);
	const noStatic = readClaudeReview([], ctx);
	assert.equal(noStatic.code, 'review-missing');
});

test('修正予算: CI失敗とblocking指摘は2周なら修正候補、3/4周と履歴不明なら人間へ返す', () => {
	const open = [
		{ id: 'F1', severity: 'P1', blocking: true, status: 'open', evidence: 'e' },
	];
	for (const body of [
		'修正ループ: 2/3',
		'修正ループ: 3/3',
		'修正ループ: 4/3',
		'',
	]) {
		for (const kind of ['ci', 'review']) {
			const v = evaluate(
				snap({
					pr: withPr({ body }),
					...(kind === 'ci'
						? {
								checks: [
									check('lint'),
									check('e2e', { conclusion: 'failure' }),
								],
							}
						: { comments: [review({ findings: open })] }),
				}),
			);
			assert.equal(v.state, 'blocked');
			assert.equal(
				v.suggest,
				body.includes('2/3')
					? kind === 'ci'
						? 'fix-ci(修正周回に計上)'
						: 'classify-and-fix-findings'
					: 'return-to-human',
				`${body}/${kind}`,
			);
		}
	}
});

test('修正予算: 成功した3周目は進行し、待機や旧headの証拠は追加修正を始めない', () => {
	const pr = withPr({ body: '修正ループ: 3/3' });
	assert.equal(evaluate(snap({ pr })).state, 'merge-ready');
	assert.equal(
		evaluate(
			snap({
				pr,
				checks: [check('lint', { status: 'in_progress', conclusion: null })],
			}),
		).state,
		'wait-ci',
	);
	const open = [
		{ id: 'F1', severity: 'P1', blocking: true, status: 'open', evidence: 'e' },
	];
	const stale = evaluate(
		snap({ pr, comments: [review({ findings: open }, OLD)] }),
	);
	assert.equal(stale.state, 'wait-review');
	assert.doesNotMatch(stale.suggest ?? '', /^fix|classify-and-fix/);
});

test('修正予算: 4周目は成功でも自由文の例外承認で拡張せず人間へ返す', () => {
	const pr = withPr({
		body: '修正ループ: 4/3\n本人承認: 今回だけ追加1周。以後停止。',
	});
	const v = evaluate(snap({ pr }));
	assert.equal(v.state, 'blocked');
	assert.equal(v.suggest, 'return-to-human');
});

test('Codexへの依頼・待機・再依頼の候補をどの状態でも生成しない', () => {
	for (const comments of [
		[],
		[review({}, OLD)],
		[review({ status: 'running' })],
	]) {
		const v = evaluate(snap({ comments }));
		assert.doesNotMatch(JSON.stringify(v), /codex/i);
	}
});

test('2周目3: 進行照合の通信がハングしても、上限内に失敗して blocked(retriable) になる', async () => {
	const hang = (async () => new Promise(() => {})) as never;
	const t0 = Date.now();
	const s = await collect(createClient({ fetchImpl: hang, timeoutMs: 30 }), {
		repo: REPO,
		number: 7,
	});
	assert.ok(Date.now() - t0 < 2000);
	assert.match(s.errors[0], /タイムアウト/);
	assert.equal(evaluate(s).state, 'blocked');
	// 本文の読取だけが止まる場合も同様
	const slowBody = (async () => ({
		ok: true,
		status: 200,
		json: () => new Promise(() => {}),
	})) as never;
	const s2 = await collect(
		createClient({ fetchImpl: slowBody, timeoutMs: 30 }),
		{ repo: REPO, number: 7 },
	);
	assert.match(s2.errors[0], /タイムアウト/);
	// 全体期限を超えたら以降の通信を始めない
	const gh = fakeGithub();
	const expired = gh.client('t');
	const c = createClient({
		token: 't',
		totalMs: -1,
		fetchImpl: (async () => json({})) as never,
	});
	await assert.rejects(async () => c.get('/x'), /全体期限/);
	assert.ok(expired);
});

test('第三者(NONE/CONTRIBUTOR等)のUser投稿は記録として採用せず、先行のblocking記録を上書きできない', () => {
	const open = [
		{ id: 'F1', severity: 'P1', blocking: true, status: 'open', evidence: 'e' },
	];
	const real = review({ findings: open }, HEAD, { id: 1 });
	for (const authorAssociation of ['NONE', 'CONTRIBUTOR', undefined]) {
		const fake = review({}, HEAD, {
			id: 2,
			login: 'rando',
			authorAssociation,
			createdAt: '2026-10-28T00:10:00Z',
		});
		const v = evaluate(snap({ comments: [real, fake] }));
		assert.equal(v.state, 'blocked', String(authorAssociation));
	}
	const only = review({}, HEAD, { authorAssociation: 'NONE' });
	assert.equal(evaluate(snap({ comments: [only] })).reviewState, 'unavailable');
});
