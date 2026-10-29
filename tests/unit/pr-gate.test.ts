import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	canRequestReconcile,
	changesRequestedBy,
	evaluate,
	priorRequests,
	readClassifications,
	readCodexSummary,
	readFixLoops,
} from '../../scripts/lib/pr-gate.mjs';
import { collect, createClient } from '../../scripts/pr-gate-status.mjs';

const REPO = 'code-life-cafe/tools-codelife-cafe';
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const MERGE = 'd'.repeat(40);
const BOT = 'chatgpt-codex-connector[bot]';
const ACTIONS_APP = 15368;
const NOW = Date.parse('2026-10-28T03:00:00Z');

type Overrides = Record<string, unknown>;
type Snap = { pr: Record<string, unknown>; comments: unknown[] } & Record<
	string,
	unknown
>;

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
		authorType: 'Bot',
		createdAt: '2026-10-28T00:00:00Z',
		updatedAt: '2026-10-28T00:00:00Z',
		body: `<!-- codex-review-state:v1 ${JSON.stringify(state)} -->\n<!-- codex-security-review:v1 ${JSON.stringify(meta)} -->`,
	};
};

// 実際のbot応答に合わせ、波括弧はHTML数値参照で返す。
const marker = (over: Overrides = {}, sha = HEAD) => {
	const m = {
		repository: REPO,
		pullRequestNumber: 7,
		headSha: sha,
		class: 'A',
		risk: 'R1',
		approvalStatus: 'not-required',
		approvalRef: null,
		unapprovedScope: [],
		...over,
	};
	return `<!-- codex-classification:v1 ${JSON.stringify(m).replaceAll('{', '&#123;').replaceAll('}', '&#125;')} -->`;
};
const classification = (
	over: Overrides = {},
	sha = HEAD,
	login = BOT,
	authorType = 'Bot',
) => ({
	id: 2,
	login,
	authorType,
	createdAt: '2026-10-28T00:01:00Z',
	body: marker(over, sha),
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
	comments: [botSummary(HEAD), classification()],
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

test('Codex未取得・Running・旧SHAは wait-review。Code対象SHA欠落は再依頼候補つき', () => {
	assert.equal(
		evaluate(snap({ comments: [classification()] })).state,
		'wait-review',
	);
	const running = botSummary(HEAD, { code: { status: 'running' } });
	assert.equal(
		evaluate(snap({ comments: [running, classification()] })).state,
		'wait-review',
	);
	assert.equal(
		evaluate(snap({ comments: [botSummary(OLD), classification()] })).state,
		'wait-review',
	);
	const missing = evaluate(
		snap({
			comments: [
				botSummary(HEAD, { code: { commit_sha: undefined } }),
				classification(),
			],
		}),
	);
	assert.equal(missing.state, 'wait-review');
	assert.match(missing.reasons[0], /commit_sha/);
	assert.match(missing.suggest, /request-once: codex-review/);
});

test('再依頼の重複防止: 同head・同種別の依頼履歴があれば候補を出さない（種別が違えば出す）', () => {
	const noSha = botSummary(HEAD, { code: { commit_sha: undefined } });
	const asked = {
		id: 50,
		login: 'maru0014',
		authorType: 'User',
		createdAt: '2026-10-28T02:56:00Z',
		body: `@codex review\nhead ${HEAD}`,
	};
	const dup = evaluate(snap({ comments: [noSha, classification(), asked] }));
	assert.equal(dup.suggest, null);
	assert.match(dup.reasons.join(), /依頼済み/);
	// 旧headへの依頼は今回のheadの依頼にならない
	const oldAsk = { ...asked, body: `@codex review\nhead ${OLD}` };
	assert.match(
		evaluate(snap({ comments: [noSha, classification(), oldAsk] })).suggest,
		/codex-review/,
	);
	assert.deepEqual([...priorRequests([asked], HEAD)], ['review']);
	// securityのみ欠落した場合、Code用の依頼履歴では抑止しない
	const secMissing = botSummary(HEAD, { security: { commit_sha: undefined } });
	assert.match(
		evaluate(snap({ comments: [secMissing, classification(), asked] })).suggest,
		/codex-security-review/,
	);
});

test('Codex未取得・旧SHAの再依頼は、headのコミットから20分経つまで出さない', () => {
	const stale = botSummary(OLD);
	assert.equal(
		evaluate(snap({ comments: [stale, classification()] })).suggest,
		null,
	);
	const aged = withPr({ headCommittedAt: '2026-10-28T02:00:00Z' });
	assert.match(
		evaluate(snap({ pr: aged, comments: [stale, classification()] })).suggest,
		/codex-review/,
	);
});

test('未知形式・他PRのCodexサマリーは合格にしない', () => {
	const broken = {
		...botSummary(HEAD),
		body: '<!-- codex-review-state:v1 {not json} -->',
	};
	assert.equal(
		evaluate(snap({ comments: [broken, classification()] })).state,
		'wait-review',
	);
	const other = botSummary(HEAD, { meta: { pullRequestNumber: 8 } });
	assert.equal(
		evaluate(snap({ comments: [other, classification()] })).state,
		'wait-review',
	);
});

test('botを装う利用者コメント（loginやtypeが違う）はCodex完了信号にならない', () => {
	const asUser = { ...botSummary(HEAD), login: 'maru0014', authorType: 'User' };
	assert.equal(
		evaluate(snap({ comments: [asUser, classification()] })).state,
		'wait-review',
	);
	const botLoginUserType = { ...botSummary(HEAD), authorType: 'User' };
	assert.equal(
		evaluate(snap({ comments: [botLoginUserType, classification()] })).state,
		'wait-review',
	);
});

test('Codexの指摘が未解決なら blocked', () => {
	const c = botSummary(HEAD, { code: { has_unresolved_findings: true } });
	assert.equal(
		evaluate(snap({ comments: [c, classification()] })).state,
		'blocked',
	);
});

test('指摘2: ユーザー名義の自由文は自動の分類証拠にしない（Claude footerの有無に依らない）', () => {
	const free = {
		id: 3,
		login: 'maru0014',
		authorType: 'User',
		createdAt: '2026-10-28T00:02:00Z',
		body: `対象head ${HEAD}\n独立分類: A / R1`,
	};
	const v = evaluate(snap({ comments: [botSummary(HEAD), free] }));
	assert.equal(v.state, 'wait-classification');
	assert.match(v.reasons.join(), /手動の分類コメント1件/);
	assert.equal(
		readClassifications([free], { repo: REPO, number: 7, headSha: HEAD }).valid
			.length,
		0,
	);
});

test('指摘2: botを装うユーザーのマーカーや旧head・他PRのマーカーは無効', () => {
	const ctx = { repo: REPO, number: 7, headSha: HEAD };
	assert.equal(
		readClassifications([classification({}, HEAD, 'maru0014', 'User')], ctx)
			.valid.length,
		0,
	);
	assert.equal(
		readClassifications([classification({}, OLD)], ctx).valid.length,
		0,
	);
	assert.equal(
		readClassifications([classification({ pullRequestNumber: 8 })], ctx).valid
			.length,
		0,
	);
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), classification({}, OLD)] }))
			.state,
		'wait-classification',
	);
});

test('指摘2: 必須項目の欠落・矛盾・不明形式のマーカーは不合格で理由が残る', () => {
	const ctx = { repo: REPO, number: 7, headSha: HEAD };
	const bad = [
		{ class: 'A', risk: 'R3' }, // classとrisk矛盾
		{ class: 'Z' },
		{ approvalStatus: 'maybe' },
		{ class: 'B', risk: 'R2', approvalStatus: 'approved', approvalRef: '' },
		{
			class: 'B',
			risk: 'R2',
			approvalStatus: 'approved',
			approvalRef: 'x',
			unapprovedScope: ['deploy.yml'],
		},
		{ class: 'A', approvalStatus: 'approved', approvalRef: 'x' },
	];
	for (const o of bad) {
		const r = readClassifications([classification(o)], ctx);
		assert.equal(r.valid.length, 0, JSON.stringify(o));
		assert.equal(r.invalid.length, 1, JSON.stringify(o));
	}
	const v = evaluate(
		snap({
			comments: [botSummary(HEAD), classification({ class: 'A', risk: 'R3' })],
		}),
	);
	assert.equal(v.state, 'wait-classification');
	assert.match(v.reasons.join(), /矛盾/);
});

test('同一headの重複したbot分類コメントでも判定は変わらない（冪等）', () => {
	const c = classification();
	const a = evaluate(snap({ comments: [botSummary(HEAD), c] }));
	const b = evaluate(
		snap({ comments: [botSummary(HEAD), c, { ...c, id: 99 }] }),
	);
	assert.deepEqual(a, b);
});

test('分類依頼の履歴がある間は再依頼候補を出さず応答を待つ', () => {
	const asked = {
		id: 60,
		login: 'maru0014',
		authorType: 'User',
		createdAt: 'x',
		body: `@codex classify\n${HEAD}`,
	};
	const v = evaluate(snap({ comments: [botSummary(HEAD), asked] }));
	assert.equal(v.state, 'wait-classification');
	assert.equal(v.suggest, null);
	assert.match(
		evaluate(snap({ comments: [botSummary(HEAD)] })).suggest,
		/request-once: codex-classify/,
	);
});

test('指摘4: 未承認B/Cは blocked。承認参照つきのCodex bot approved-B/Cだけ継続できる', () => {
	const unapproved = classification({
		class: 'B',
		risk: 'R2',
		approvalStatus: 'unapproved',
	});
	const u = evaluate(snap({ comments: [botSummary(HEAD), unapproved] }));
	assert.equal(u.state, 'blocked');
	assert.equal(u.classification, 'unapproved-B');
	const approved = classification({
		class: 'B',
		risk: 'R2',
		approvalStatus: 'approved',
		approvalRef:
			'https://github.com/code-life-cafe/tools-codelife-cafe/issues/526#issuecomment-1',
	});
	const a = evaluate(snap({ comments: [botSummary(HEAD), approved] }));
	assert.equal(a.state, 'merge-ready');
	assert.equal(a.classification, 'approved-B');
});

test('指摘4: R3は追加独立リスクレビューの記録がなければ止める。承認参照が空のapprovedは無効', () => {
	const r3 = {
		class: 'B',
		risk: 'R3',
		approvalStatus: 'approved',
		approvalRef: 'ref',
	};
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), classification(r3)] })).state,
		'blocked',
	);
	const ok = classification({ ...r3, additionalRiskReview: true });
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), ok] })).state,
		'merge-ready',
	);
	const empty = classification({ ...r3, approvalRef: '  ' });
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), empty] })).state,
		'wait-classification',
	);
});

test('分類が矛盾したら最も厳しい側（A と unapproved-C が並べば blocked）', () => {
	const c = classification({
		class: 'C',
		risk: 'R4',
		approvalStatus: 'unapproved',
	});
	const v = evaluate(
		snap({ comments: [botSummary(HEAD), classification(), { ...c, id: 9 }] }),
	);
	assert.equal(v.state, 'blocked');
	assert.equal(v.classification, 'unapproved-C');
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

test('修正予算: CI失敗とCode/Security指摘は2周なら修正候補、3/4周と履歴不明なら人間へ返す', () => {
	for (const body of [
		'修正ループ: 2/3',
		'修正ループ: 3/3',
		'修正ループ: 4/3',
		'',
	]) {
		for (const kind of ['ci', 'code', 'security']) {
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
						: {
								comments: [
									botSummary(HEAD, {
										[kind]: { has_unresolved_findings: true },
									}),
									classification(),
								],
							}),
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
	const stale = evaluate(
		snap({
			pr,
			comments: [
				botSummary(OLD, { code: { has_unresolved_findings: true } }),
				classification(),
			],
		}),
	);
	assert.equal(stale.state, 'wait-review');
	assert.doesNotMatch(stale.suggest ?? '', /fix/);
});

test('修正予算: 例外承認の自由文で恒久上限を拡張しない。4周目の成功も人間が限定承認を照合する', () => {
	const pr = withPr({
		body: '修正ループ: 4/3\n本人承認: 今回だけ追加1周。以後停止。',
	});
	for (const comments of [
		[botSummary(HEAD), classification()],
		[
			botSummary(HEAD, { code: { has_unresolved_findings: true } }),
			classification(),
		],
	]) {
		const v = evaluate(snap({ pr, comments }));
		assert.equal(v.state, 'blocked');
		assert.equal(v.suggest, 'return-to-human');
	}
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
test('2周目1: 同一headで後から届いた approved-B が、bot明示の supersedes で旧 unapproved-B を置き換える', () => {
	const unapproved = {
		...classification({ class: 'B', risk: 'R2', approvalStatus: 'unapproved' }),
		id: 2,
		createdAt: '2026-10-28T00:01:00Z',
	};
	const approved = {
		...classification({
			class: 'B',
			risk: 'R2',
			approvalStatus: 'approved',
			approvalRef: 'ref',
			supersedes: [2],
		}),
		id: 5,
		createdAt: '2026-10-28T00:10:00Z',
	};
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), unapproved, approved] }))
			.classification,
		'approved-B',
	);
	// 順序が逆でも・重複しても同じ
	assert.equal(
		evaluate(
			snap({ comments: [approved, unapproved, approved, botSummary(HEAD)] }),
		).state,
		'merge-ready',
	);
	// supersedes が無ければ、未解決の反対判定として厳しい側が残る
	const plain = {
		...approved,
		body: marker({
			class: 'B',
			risk: 'R2',
			approvalStatus: 'approved',
			approvalRef: 'ref',
		}),
	};
	const v = evaluate(snap({ comments: [botSummary(HEAD), unapproved, plain] }));
	assert.equal(v.state, 'blocked');
	assert.equal(v.classification, 'unapproved-B');
	// 無関係なidを指していても、古い方は消えない
	const wrong = {
		...approved,
		body: marker({
			class: 'B',
			risk: 'R2',
			approvalStatus: 'approved',
			approvalRef: 'ref',
			supersedes: [999],
		}),
	};
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), unapproved, wrong] }))
			.classification,
		'unapproved-B',
	);
	// 古いマーカーが新しいマーカーを置き換える向きは無効
	const backwards = { ...approved, createdAt: '2026-10-28T00:00:30Z' };
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), unapproved, backwards] }))
			.classification,
		'unapproved-B',
	);
});

// ---- 3周目(4周目承認): 同head矛盾マーカー ----
test('4周目: 有効Aと矛盾する無効マーカー(承認済みなのに未承認範囲あり)が並ぶ間はmerge-readyにしない', () => {
	const validA = {
		...classification(),
		id: 2,
		createdAt: '2026-10-28T00:01:00Z',
	};
	const contradictory = {
		...classification({
			class: 'B',
			risk: 'R2',
			approvalStatus: 'approved',
			approvalRef: 'ref',
			unapprovedScope: ['deploy.yml'],
		}),
		id: 3,
		createdAt: '2026-10-28T00:02:00Z',
	};
	for (const comments of [
		[botSummary(HEAD), validA, contradictory],
		[botSummary(HEAD), contradictory, validA], // 順序逆転
		[botSummary(HEAD), validA, contradictory, validA], // 重複
	]) {
		const v = evaluate(snap({ comments }));
		assert.equal(v.state, 'blocked');
		assert.notEqual(v.state, 'merge-ready');
	}
	// 有効Aだけなら進める
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), validA] })).state,
		'merge-ready',
	);
	// 後続の有効な分類がsupersedesで当該コメントを明示置換したときだけ解消
	const replacement = {
		...classification({ supersedes: [3] }),
		id: 4,
		createdAt: '2026-10-28T00:10:00Z',
	};
	assert.equal(
		evaluate(
			snap({
				comments: [botSummary(HEAD), validA, contradictory, replacement],
			}),
		).state,
		'merge-ready',
	);
	// 無関係ID・先行投稿・信頼外投稿・旧headでは解消/発生しない
	const unrelated = { ...replacement, body: marker({ supersedes: [999] }) };
	assert.equal(
		evaluate(
			snap({ comments: [botSummary(HEAD), validA, contradictory, unrelated] }),
		).state,
		'blocked',
	);
	const earlier = { ...replacement, createdAt: '2026-10-28T00:01:30Z' };
	assert.equal(
		evaluate(
			snap({ comments: [botSummary(HEAD), validA, contradictory, earlier] }),
		).state,
		'blocked',
	);
	const human = { ...contradictory, login: 'someone', authorType: 'User' };
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), validA, human] })).state,
		'merge-ready',
	);
	const oldHead = classification(
		{
			class: 'B',
			risk: 'R2',
			approvalStatus: 'approved',
			approvalRef: 'ref',
			unapprovedScope: ['x'],
		},
		'0'.repeat(40),
	);
	assert.equal(
		evaluate(
			snap({ comments: [botSummary(HEAD), validA, { ...oldHead, id: 9 }] }),
		).state,
		'merge-ready',
	);
});

test('2周目1: 承認の更新があったときだけ、分類の再照合依頼を一度だけ提案する', () => {
	const unapproved = {
		...classification({ class: 'B', risk: 'R2', approvalStatus: 'unapproved' }),
		createdAt: '2026-10-28T00:05:00Z',
	};
	const ask = (at: string) => ({
		id: 70,
		login: 'maru0014',
		authorType: 'User',
		createdAt: at,
		body: `@codex classify\n${HEAD}`,
	});
	const approval = (at: string) => ({
		id: 71,
		login: 'maru0014',
		authorType: 'User',
		createdAt: at,
		body: '計画を承認します（2026-10-28）',
	});
	const run = (extra: unknown[]) =>
		evaluate(snap({ comments: [botSummary(HEAD), unapproved, ...extra] }));
	// 依頼後、分類より後に承認 → 再照合の提案
	assert.match(
		run([ask('2026-10-28T00:02:00Z'), approval('2026-10-28T00:20:00Z')])
			.suggest,
		/reconcile/,
	);
	// 承認が分類より前（無関係/古い承認）→ 提案しない
	assert.doesNotMatch(
		run([ask('2026-10-28T00:02:00Z'), approval('2026-10-28T00:03:00Z')])
			.suggest,
		/reconcile/,
	);
	// すでに承認後に再依頼済み → 重ねない
	assert.doesNotMatch(
		run([
			ask('2026-10-28T00:02:00Z'),
			approval('2026-10-28T00:20:00Z'),
			{ ...ask('2026-10-28T00:21:00Z'), id: 72 },
		]).suggest,
		/reconcile/,
	);
	// 承認の言及がない → 提案しない
	assert.doesNotMatch(run([ask('2026-10-28T00:02:00Z')]).suggest, /reconcile/);
});

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

test('2周目4: 必須項目の欠落・型不明は補完せず不合格', () => {
	const ctx = { repo: REPO, number: 7, headSha: HEAD };
	const noScope = JSON.parse(
		JSON.stringify({
			repository: REPO,
			pullRequestNumber: 7,
			headSha: HEAD,
			class: 'B',
			risk: 'R2',
			approvalStatus: 'approved',
			approvalRef: 'ref',
		}),
	);
	const mk = (m: object) => ({
		id: 3,
		login: BOT,
		authorType: 'Bot',
		createdAt: '2026-10-28T00:01:00Z',
		body: `<!-- codex-classification:v1 ${JSON.stringify(m)} -->`,
	});
	assert.equal(readClassifications([mk(noScope)], ctx).valid.length, 0);
	assert.equal(
		readClassifications([mk({ ...noScope, unapprovedScope: [] })], ctx).valid
			.length,
		1,
	);
	const { approvalRef: _omit, ...noRef } = { ...noScope, unapprovedScope: [] };
	assert.equal(readClassifications([mk(noRef)], ctx).valid.length, 0);
	for (const bad of [
		{ approvalRef: 5 },
		{ unapprovedScope: 'none' },
		{ additionalRiskReview: 'yes' },
		{ supersedes: ['abc'] },
		{ supersedes: 'x' },
	]) {
		assert.equal(
			readClassifications(
				[mk({ ...noScope, unapprovedScope: [], ...bad })],
				ctx,
			).valid.length,
			0,
			JSON.stringify(bad),
		);
	}
	// Aでも項目欠落は不合格
	assert.equal(
		readClassifications(
			[
				mk({
					repository: REPO,
					pullRequestNumber: 7,
					headSha: HEAD,
					class: 'A',
					risk: 'R1',
					approvalStatus: 'not-required',
				}),
			],
			ctx,
		).valid.length,
		0,
	);
});

test('2周目4: Codexメタデータがnull・文字列・配列でも例外にせず待ち状態を返す', () => {
	const mkState = (state: unknown, meta: unknown) => ({
		...botSummary(HEAD),
		body: `<!-- codex-review-state:v1 ${JSON.stringify(state)} -->\n<!-- codex-security-review:v1 ${JSON.stringify(meta)} -->`,
	});
	const meta = {
		headSha: HEAD,
		status: 'completed',
		pullRequestNumber: 7,
		repository: REPO,
	};
	for (const state of [
		{ code_review: null, security_review: null },
		{ code_review: 'x', security_review: [] },
		[],
		'str',
		{},
	]) {
		const v = evaluate(
			snap({ comments: [mkState(state, meta), classification()] }),
		);
		assert.equal(v.state, 'wait-review', JSON.stringify(state));
	}
	assert.equal(
		evaluate(
			snap({
				comments: [
					mkState({ code_review: {}, security_review: {} }, null),
					classification(),
				],
			}),
		).state,
		'wait-review',
	);
	// 想定外のsnapshotでも例外にしない
	const odd = evaluate(snap({ comments: [null] }));
	assert.equal(odd.state, 'blocked');
	assert.equal(odd.retriable, true);
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

// ---- 3周目（正式Codex Code review の4件）----
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

test('3周目2: 同じラベルでもR3の追加リスクレビュー未記録の判定が1つでも残れば進めない', () => {
	const ref = 'https://example.test/approval';
	const r2 = {
		...classification({
			class: 'B',
			risk: 'R2',
			approvalStatus: 'approved',
			approvalRef: ref,
		}),
		id: 10,
		createdAt: '2026-10-28T00:01:00Z',
	};
	const r3 = {
		...classification({
			class: 'B',
			risk: 'R3',
			approvalStatus: 'approved',
			approvalRef: ref,
		}),
		id: 11,
		createdAt: '2026-10-28T00:02:00Z',
	};
	const both = evaluate(snap({ comments: [botSummary(HEAD), r2, r3] }));
	assert.equal(both.state, 'blocked');
	assert.match(both.reasons[0], /R3/);
	// 順序を逆にしても同じ（起動順・再起動に依存しない）
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), r3, r2] })).state,
		'blocked',
	);
	// R3側がレビュー記録済みなら進める
	const reviewed = {
		...r3,
		body: marker({
			class: 'B',
			risk: 'R3',
			approvalStatus: 'approved',
			approvalRef: ref,
			additionalRiskReview: true,
		}),
	};
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), r2, reviewed] })).state,
		'merge-ready',
	);
	// botが明示的に置き換えたときは、置換後の判定だけを見る
	const replaced = {
		...r3,
		body: marker({
			class: 'B',
			risk: 'R3',
			approvalStatus: 'approved',
			approvalRef: ref,
			additionalRiskReview: true,
			supersedes: [10],
		}),
	};
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), r2, replaced] })).state,
		'merge-ready',
	);
});

test('3周目3: Aなのに未承認範囲が残る矛盾したマーカーは無効', () => {
	const ctx = { repo: REPO, number: 7, headSha: HEAD };
	const contradictory = classification({ unapprovedScope: ['deploy.yml'] });
	const r = readClassifications([contradictory], ctx);
	assert.equal(r.valid.length, 0);
	assert.match(r.invalid[0]?.why ?? '', /未承認範囲/);
	assert.equal(
		evaluate(snap({ comments: [botSummary(HEAD), contradictory] })).state,
		'wait-classification',
	);
});

// ---- 取得層 ----
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

test('第1段階: 不明/実指摘/Running/Error/cleanを区別し技術待ちは修正予算を消費しない', () => {
	for (const kind of ['code', 'security']) {
		for (const loops of [0, 3]) {
			for (const unknown of [null, undefined, 'false', 0]) {
				const comments = [
					botSummary(HEAD, { [kind]: { has_unresolved_findings: unknown } }),
					classification(),
				];
				const v = evaluate(
					snap({ comments, pr: withPr({ body: `修正ループ: ${loops}/3` }) }),
				);
				assert.equal(v.state, 'wait-review');
				assert.equal(v.reviewState, 'unknown');
				assert.equal(v.retriable, true);
				assert.equal(v.suggest, null);
			}
			for (const [status, expected] of [
				['running', 'running'],
				['queued', 'running'],
				['error', 'error'],
				['failed', 'error'],
				['cancelled', 'error'],
				['new-status', 'unknown'],
			]) {
				const v = evaluate(
					snap({
						comments: [
							botSummary(HEAD, { [kind]: { status } }),
							classification(),
						],
						pr: withPr({ body: `修正ループ: ${loops}/3` }),
					}),
				);
				assert.equal(v.state, 'wait-review');
				assert.equal(v.reviewState, expected);
				assert.equal(v.suggest, null);
			}
		}
	}
	assert.equal(
		readCodexSummary([botSummary(HEAD)], {
			repo: REPO,
			number: 7,
			headSha: HEAD,
		}).reviewState,
		'clean',
	);
	const mixed = evaluate(
		snap({
			comments: [
				botSummary(HEAD, {
					code: { has_unresolved_findings: null },
					security: { has_unresolved_findings: true },
				}),
			],
		}),
	);
	assert.equal(mixed.state, 'blocked');
	assert.equal(mixed.reviewState, 'findings');
	assert.equal(mixed.suggest, 'classify-and-fix-findings');
});

test('第1段階: 説明中のmarker名は無視し構造化された不正markerは報告する', () => {
	const explanation = {
		...classification(),
		id: 3,
		body: 'codex-classification:v1 の not-required を説明します',
	};
	assert.equal(
		evaluate(
			snap({ comments: [botSummary(HEAD), classification(), explanation] }),
		).state,
		'merge-ready',
	);
	for (const body of [
		'<!-- codex-classification:v1 {bad} -->',
		'<!-- codex-classification:v1 -->',
		marker({ approvalStatus: 'not_required' }),
		marker({ headSha: 'abcdef0' }),
		marker({ unapprovedScope: [1] }),
		`${marker()}\n${marker()}`,
	]) {
		const invalid = { ...explanation, body };
		assert.equal(
			evaluate(
				snap({ comments: [botSummary(HEAD), classification(), invalid] }),
			).state,
			'blocked',
		);
	}
});

test('第1段階: 日本語分類依頼は通常reviewに誤分類せず同headの再依頼を抑制する', () => {
	for (const request of [
		'@codex このheadの独立分類をお願いします',
		'@codex review このheadの分類確認をお願いします',
		'@codex classify',
	]) {
		const c = {
			id: 3,
			login: 'maker',
			authorType: 'User',
			createdAt: '2026-10-28T01:00:00Z',
			body: `${request}\n${HEAD}`,
		};
		assert.deepEqual([...priorRequests([c], HEAD)], ['classify']);
		const v = evaluate(snap({ comments: [botSummary(HEAD), c] }));
		assert.equal(v.state, 'wait-classification');
		assert.equal(v.suggest, null);
		assert.equal(priorRequests([c], OLD).size, 0);
	}
});

test('第1段階: receipt自由文/偽bot/短SHA/時刻不明はunknownをcleanにしない', () => {
	const summary = botSummary(HEAD, {
		security: { has_unresolved_findings: null },
	});
	const receipt = {
		...classification(),
		id: 3,
		body: 'No security issues found. Reviewed commit abcdef0. SecurityReport',
	};
	for (const extra of [
		receipt,
		{ ...botSummary(HEAD), login: 'fake' },
		{ ...botSummary(HEAD), authorType: 'User' },
		botSummary('abcdef0'),
	]) {
		const v = evaluate(snap({ comments: [summary, extra, classification()] }));
		assert.equal(v.state, 'wait-review');
		assert.notEqual(v.suggest, 'classify-and-fix-findings');
	}
	const badTime = { ...botSummary(HEAD), createdAt: 'bad', updatedAt: 'bad' };
	assert.equal(
		evaluate(snap({ comments: [badTime, classification()] })).state,
		'wait-review',
	);
	assert.equal(
		readClassifications([{ ...classification(), createdAt: 'bad' }], {
			repo: REPO,
			number: 7,
			headSha: HEAD,
		}).invalid.length,
		1,
	);
});

test('第1段階: PR531/533で観測した正式receiptの形でも構造化結果が無ければunknown', () => {
	// 2026-10-30取得: comment 6497625946 / 6499340453。完全SHAではなく10桁、自由文のみ。
	for (const shortSha of ['ae0fa97060', '71cffecc92']) {
		const receipt = {
			...classification(),
			id: 3,
			body: `<!-- codex-review-receipt:v1 -->\n### Codex Security Review\nSecurity review completed. No security issues were found in this pull request.\nReviewed commit: ${shortSha}`,
		};
		const v = evaluate(
			snap({
				comments: [
					botSummary(HEAD, { security: { has_unresolved_findings: null } }),
					receipt,
					classification(),
				],
			}),
		);
		assert.equal(v.state, 'wait-review');
		assert.equal(v.reviewState, 'unknown');
		assert.equal(v.suggest, null);
	}
});

test('第1段階: 日本語分類依頼の再照合も承認更新ごとに一度だけ', () => {
	const request = {
		id: 3,
		login: 'maker',
		authorType: 'User',
		body: `@codex このheadの独立分類をお願いします ${HEAD}`,
		createdAt: '2026-10-28T01:00:00Z',
	};
	const approval = {
		...request,
		id: 4,
		body: '本人承認の参照を更新',
		createdAt: '2026-10-28T02:00:00Z',
	};
	const cls = { latestMarkerAt: 0 };
	assert.equal(canRequestReconcile([request], HEAD, cls), false);
	assert.equal(canRequestReconcile([request, approval], HEAD, cls), true);
	const reconcile = { ...request, id: 5, createdAt: '2026-10-28T02:10:00Z' };
	assert.equal(
		canRequestReconcile([request, approval, reconcile], HEAD, cls),
		false,
	);
	assert.equal(canRequestReconcile([request, approval], OLD, cls), false);
});
