// PR進行照合の純粋評価。取得（scripts/pr-gate-status.mjs）とは分離し、副作用を持たない。
// 出力はMerge許可ではなく「いま何を待つか/何をすべきか」の判定。Merge操作は含まない。
// 取得失敗・未知形式・旧SHA・矛盾は合格にせず、必ず待ちかblockedに倒す（fail-closed）。

export const STATES = [
	'ready',
	'sync-base',
	'wait-ci',
	'wait-review',
	'blocked',
	'merge-ready',
	'wait-deploy',
	'verify-production',
	'close',
	'done',
];

export const REQUIRED_CHECKS = ['lint', 'e2e'];
export const MAX_FIX_LOOPS = 3;
// 公開後の読み取りsmokeを行う既存deploy.yml内のjob名。
export const DEPLOY_JOB = 'deploy';
export const SMOKE_JOB = 'production-smoke';
// 独立レビュー記録のマーカー名。Codexの旧マーカーは信頼元にしない。
export const REVIEW_MARKER = 'claude-review:v1';

const FULL_SHA = /^[0-9a-f]{40}$/;
const RISK_BY_CLASS = { A: ['R0', 'R1'], B: ['R2', 'R3'], C: ['R4'] };

/** @returns {any} */
const result = (state, /** @type {any} */ extra = {}) => ({
	state,
	waitingOn: null,
	retriable: false,
	reasons: [],
	suggest: null,
	...extra,
});

function hasJsonMarker(body, name) {
	return new RegExp(`<!--\\s*${name}(?![\\w:-])`).test(body ?? '');
}

function parseJsonMarker(body, name) {
	// Codex botの分類コメントは波括弧がHTML数値参照（&#123; &#125;）で返るため、先に戻す。
	const text = (body ?? '')
		.replaceAll('&#123;', '{')
		.replaceAll('&#125;', '}')
		.replaceAll('&quot;', '"');
	if (
		[...text.matchAll(new RegExp(`<!--\\s*${name}(?![\\w:-])`, 'g'))].length !==
		1
	)
		return null;
	const matches = [
		...text.matchAll(new RegExp(`<!--\\s*${name}\\s+([\\s\\S]*?)-->`, 'g')),
	];
	if (matches.length !== 1) return null;
	const m = matches[0];
	if (!m) return null;
	try {
		return JSON.parse(m[1]);
	} catch {
		return null;
	}
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const REF = /^[\w.:-]{3,200}$/;
const SEVERITY = ['P0', 'P1', 'P2'];
const FINDING_STATUS = ['open', 'fixed-verified', 'dismissed'];
const SCOPE_KEYS = ['code', 'tests', 'security', 'classification'];

// 独立レビュー記録（claude-review:v1）の検証。形式・SHA・別担当・範囲・finding・分類を満たすものだけ有効。
// 実装者と別の担当であることは reviewerRef(subagent:…) と makerRef の不一致で「記録上」確認するだけで、
// 暗号学的な証明ではない。偽装対策のための新しい資格情報・サービスは導入しない。
export function validateReviewRecord(m, { repo, number, headSha }) {
	if (!isObj(m))
		return { ok: false, code: 'review-unparsable', why: '形式不明' };
	if (m.repository !== repo || m.pullRequestNumber !== number)
		return {
			ok: false,
			code: 'review-other-pr',
			why: 'repository/PR番号が不一致',
		};
	if (!FULL_SHA.test(m.headSha ?? ''))
		return {
			ok: false,
			code: 'review-sha-missing',
			why: '対象headの完全SHAが欠落/不正',
		};
	if (m.headSha !== headSha)
		return {
			ok: false,
			code: 'review-stale',
			why: `旧head ${m.headSha.slice(0, 7)} のレビュー記録`,
		};
	const bad = (why) => ({ ok: false, code: 'review-invalid', why });
	if (
		typeof m.reviewerRef !== 'string' ||
		!/^subagent:[\w.-][\w.:-]{2,}$/.test(m.reviewerRef) ||
		!REF.test(m.reviewerRef)
	)
		return bad('reviewerRef(subagent:<実行参照>)が欠落/不正');
	if (
		typeof m.makerRef !== 'string' ||
		!REF.test(m.makerRef) ||
		/^subagent:/.test(m.makerRef)
	)
		return bad('makerRef(実装者のセッション参照)が欠落/不正');
	if (m.reviewerRef === m.makerRef)
		return bad('レビュー担当が実装者と同一(独立レビューではない)');
	if (!Number.isInteger(m.round) || m.round < 1) return bad('roundが欠落/不正');
	if (m.status !== 'completed')
		return {
			ok: false,
			code: 'review-not-completed',
			why: `レビューstatus=${String(m.status)}`,
		};
	if (!isObj(m.scope) || !SCOPE_KEYS.every((k) => m.scope[k] === true))
		return bad(`scopeが不足(${SCOPE_KEYS.join('/')}をすべてtrueで確認する)`);
	if (
		!Array.isArray(m.unverified) ||
		!m.unverified.every((x) => typeof x === 'string')
	)
		return bad('unverifiedが欠落/型不明');
	if (m.unverified.length)
		return {
			ok: false,
			code: 'review-unverified',
			why: `未確認項目が残っている: ${m.unverified.join(' / ')}`,
		};
	if (!Array.isArray(m.findings)) return bad('findingsが欠落/型不明');
	for (const f of m.findings) {
		if (
			!isObj(f) ||
			typeof f.id !== 'string' ||
			!f.id ||
			!SEVERITY.includes(f.severity) ||
			typeof f.blocking !== 'boolean' ||
			!FINDING_STATUS.includes(f.status) ||
			typeof f.evidence !== 'string' ||
			!f.evidence.trim()
		)
			return bad(
				'findingの形式が不正(id/severity/blocking/status/evidenceが必須)',
			);
	}
	const cls = validateClassification(
		isObj(m.classification)
			? {
					repository: repo,
					pullRequestNumber: number,
					headSha,
					...m.classification,
				}
			: null,
		{ repo, number, headSha },
	);
	if (!cls.ok) return bad(`classification: ${cls.why}`);
	const open = m.findings.filter((f) => f.blocking && f.status === 'open');
	return {
		ok: true,
		reviewerRef: m.reviewerRef,
		round: m.round,
		openBlocking: open.map((f) => f.id),
		classification: cls,
	};
}

// PR commentsから独立レビュー記録を読む。信頼するのは人間アカウント(type=User)が投稿した構造化マーカーだけ。
// Bot名義(旧Codex botを含む)の記録、自由文の「レビュー済み」、短SHAは採用しない。
export function readClaudeReview(comments, ctx) {
	const cands = comments.filter(
		(c) => c.authorType === 'User' && hasJsonMarker(c.body, REVIEW_MARKER),
	);
	if (!cands.length)
		return {
			ok: false,
			code: 'review-missing',
			reviewState: 'unavailable',
			detail:
				'実装者と別のClaudeサブエージェントによるレビュー記録が未取得(review-evidence-unavailable)',
		};
	const isTime = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
	if (
		cands.some(
			(c) =>
				!isTime(c.createdAt) || (c.updatedAt != null && !isTime(c.updatedAt)),
		)
	)
		return {
			ok: false,
			code: 'review-time-invalid',
			reviewState: 'unknown',
			detail: 'レビュー記録の投稿/更新時刻が不正。最新結果を確定できない',
		};
	const at = (c) => Date.parse(c.updatedAt ?? c.createdAt);
	cands.sort((a, b) => at(b) - at(a));
	const latest = cands[0];
	if (cands.some((c) => at(c) === at(latest) && c.body !== latest.body))
		return {
			ok: false,
			code: 'review-time-ambiguous',
			reviewState: 'unknown',
			detail: '同時刻の最新記録の内容が異なる。順序を確定できない',
		};
	const v = validateReviewRecord(
		parseJsonMarker(latest.body, REVIEW_MARKER),
		ctx,
	);
	if (!v.ok)
		return {
			ok: false,
			code: v.code,
			reviewState: v.code === 'review-stale' ? 'stale' : 'unknown',
			detail: v.why,
		};
	if (v.openBlocking.length)
		return {
			ok: false,
			code: 'review-findings',
			reviewState: 'findings',
			detail: `未解決のblocking finding: ${v.openBlocking.join(', ')}`,
		};
	return {
		ok: true,
		reviewState: 'clean',
		classification: v.classification,
		reviewerRef: v.reviewerRef,
		round: v.round,
	};
}

// 独立レビュー記録内の分類の検証。形式・SHA・分類とriskの整合・承認参照を満たすものだけ有効。
export function validateClassification(m, { repo, number, headSha }) {
	if (!m || typeof m !== 'object' || Array.isArray(m))
		return { ok: false, why: '形式不明' };
	if (m.repository !== repo || m.pullRequestNumber !== number)
		return { ok: false, why: 'repository/PR番号が不一致' };
	if (!FULL_SHA.test(m.headSha ?? ''))
		return { ok: false, why: '対象headの完全SHAが不正' };
	if (m.headSha !== headSha) return { ok: false, why: '対象headが不一致' };
	if (!RISK_BY_CLASS[m.class]) return { ok: false, why: 'classが不正' };
	if (!RISK_BY_CLASS[m.class].includes(m.risk))
		return { ok: false, why: 'classとriskが矛盾' };
	// 文書が必須とする項目は欠落・型不明なら不合格（補完しない）。
	if (
		!('approvalRef' in m) ||
		!(m.approvalRef === null || typeof m.approvalRef === 'string')
	)
		return { ok: false, why: 'approvalRefが欠落/型不明' };
	if (
		!Array.isArray(m.unapprovedScope) ||
		!m.unapprovedScope.every((x) => typeof x === 'string')
	)
		return { ok: false, why: 'unapprovedScopeが欠落/型不明' };
	if (
		m.additionalRiskReview !== undefined &&
		typeof m.additionalRiskReview !== 'boolean'
	)
		return { ok: false, why: 'additionalRiskReviewの型が不明' };
	if (m.class === 'A') {
		if (m.unapprovedScope.length)
			return { ok: false, why: 'Aなのに未承認範囲が残っている(矛盾)' };
		return m.approvalStatus === 'not-required'
			? { ok: true, label: 'A', class: 'A', risk: m.risk }
			: { ok: false, why: 'Aのapprovalが不正' };
	}
	if (m.approvalStatus === 'approved') {
		const ref = typeof m.approvalRef === 'string' ? m.approvalRef.trim() : '';
		if (!ref) return { ok: false, why: 'approvalRefが空' };
		if (m.unapprovedScope.length)
			return { ok: false, why: '未承認範囲が残っている' };
		return {
			ok: true,
			label: `approved-${m.class}`,
			class: m.class,
			risk: m.risk,
			approvalRef: ref,
			additionalRiskReview: m.additionalRiskReview === true,
		};
	}
	if (m.approvalStatus === 'unapproved') {
		return {
			ok: true,
			label: `unapproved-${m.class}`,
			class: m.class,
			risk: m.risk,
		};
	}
	return { ok: false, why: 'approvalStatusが不正' };
}

// 修正周回。履歴（コメント/本文）の最大値を採用し、再起動や重複で0に戻さない。取れなければnull。
export function readFixLoops(texts) {
	let max = null;
	for (const t of texts) {
		for (const m of (t ?? '').matchAll(/修正ループ[:：]\s*(\d+)\s*\/\s*3/g)) {
			max = Math.max(max ?? 0, Number(m[1]));
		}
	}
	return max;
}

// 人間レビューの最新状態（reviewerごと）。CHANGES_REQUESTEDが残るreviewerを返す。
export function changesRequestedBy(reviews) {
	const latest = new Map();
	const ordered = [...reviews].sort(
		(a, b) => Date.parse(a.submittedAt ?? 0) - Date.parse(b.submittedAt ?? 0),
	);
	for (const r of ordered) {
		if (r.authorType === 'Bot') continue;
		if (['COMMENTED', 'PENDING'].includes(r.state)) continue;
		latest.set(r.login, r.state);
	}
	return [...latest]
		.filter(([, s]) => s === 'CHANGES_REQUESTED')
		.map(([l]) => l);
}

function summarizeChecks(checks, headSha, required) {
	const missing = [];
	const pending = [];
	const failed = [];
	for (const req of required) {
		const candidates = checks
			.filter(
				(c) =>
					c.headSha === headSha &&
					c.name === req.context &&
					(req.integrationId == null || c.appId === req.integrationId),
			)
			.sort(
				(a, b) => Date.parse(b.startedAt ?? 0) - Date.parse(a.startedAt ?? 0),
			);
		const c = candidates[0];
		if (!c) missing.push(req.context);
		else if (c.status !== 'completed') pending.push(req.context);
		else if (c.conclusion !== 'success')
			failed.push(`${req.context}:${c.conclusion}`);
	}
	return { missing, pending, failed };
}

// snapshot: scripts/pr-gate-status.mjs が正規化して渡す。unknown/null は「不明」として扱う。
/** @param {any} snapshot @returns {any} */
export function evaluate(snapshot) {
	try {
		return evaluateInner(snapshot);
	} catch (e) {
		// 想定外の形式でも例外で終わらせず、不明な待ち状態（再取得）に倒す。
		return result('blocked', {
			retriable: true,
			reasons: [`評価中に想定外の形式: ${e?.message ?? e}`],
		});
	}
}

function evaluateInner(snapshot) {
	const { pr, repo, errors = [] } = snapshot;
	if (!pr || !FULL_SHA.test(pr.headSha ?? '')) {
		return result('blocked', {
			retriable: true,
			reasons: ['PR/headを取得できない', ...errors],
		});
	}
	const head = pr.headSha;
	const base = { head, base: pr.baseSha ?? null };
	if (snapshot.inconsistent) {
		return result('blocked', {
			...base,
			retriable: true,
			reasons: [`取得中にPRが変化: ${snapshot.inconsistent}。再取得`],
		});
	}
	if (pr.merged) return evaluatePostMerge(snapshot, base);
	if (pr.state !== 'open')
		return result('done', { ...base, reasons: ['マージされずに閉じている'] });

	const comments = snapshot.comments ?? null;
	if (
		comments === null ||
		snapshot.checks == null ||
		snapshot.reviews == null
	) {
		return result('blocked', {
			...base,
			retriable: true,
			reasons: ['コメント/check-run/reviewの取得に失敗または不完全', ...errors],
		});
	}

	const loops = readFixLoops([pr.body, ...comments.map((c) => c.body)]);
	// 例外承認の自由文を自動権限として解釈しない。限定承認は人間が別途照合する。
	const repairSuggestion = (suggest) =>
		loops != null && loops < MAX_FIX_LOOPS ? suggest : 'return-to-human';
	const required = snapshot.rules?.requiredChecks?.length
		? snapshot.rules.requiredChecks
		: REQUIRED_CHECKS.map((context) => ({ context }));
	const ci = summarizeChecks(snapshot.checks, head, required);
	if (ci.failed.length) {
		return result('blocked', {
			...base,
			reasons: [`必須CI失敗: ${ci.failed.join(', ')}`],
			suggest: repairSuggestion('fix-ci(修正周回に計上)'),
		});
	}
	if (pr.mergeableState === 'dirty') {
		return result('blocked', {
			...base,
			reasons: ['競合あり。意味判断が必要なら人間へ'],
			suggest: 'merge-base-and-resolve',
		});
	}
	// 最新baseを含まないheadは新headでCI/レビューをやり直すため、待つ前にbase取り込みを優先する。
	if (snapshot.behindBy == null) {
		return result('blocked', {
			...base,
			retriable: true,
			reasons: ['base差分(behind_by)を取得できない', ...errors],
		});
	}
	if (snapshot.behindBy > 0) {
		return result('sync-base', {
			...base,
			reasons: [`headはbaseに${snapshot.behindBy}コミット遅れ`],
			suggest: 'merge-main-then-push(CI/レビュー再照合)',
		});
	}
	if (ci.pending.length || ci.missing.length) {
		return result('wait-ci', {
			...base,
			waitingOn: 'CI',
			retriable: true,
			reasons: [
				...ci.pending.map((n) => `${n}実行中`),
				...ci.missing.map((n) => `${n}未起動(対象head/連携app)`),
			],
		});
	}
	if (pr.draft) {
		return result('ready', {
			...base,
			reasons: ['対象headの必須CIが成功したDraft'],
			suggest: 'mark-ready-for-review(二重のreview依頼はしない)',
		});
	}

	const holders = changesRequestedBy(snapshot.reviews);
	if (holders.length) {
		return result('blocked', {
			...base,
			reasons: [`人間の変更要求が残っている: ${holders.join(', ')}`],
			suggest: 'address-or-ask-reviewer',
		});
	}

	if (loops != null && loops > MAX_FIX_LOOPS) {
		return result('blocked', {
			...base,
			reasons: [`修正ループ${loops}/3超過`],
			suggest: 'return-to-human',
		});
	}

	const review = readClaudeReview(comments, {
		repo,
		number: pr.number,
		headSha: head,
	});
	if (!review.ok) {
		if (review.code === 'review-findings') {
			return result('blocked', {
				...base,
				reasons: [review.detail],
				reviewState: review.reviewState,
				suggest: repairSuggestion('classify-and-fix-findings'),
			});
		}
		// 未実施・取得不能・旧SHA・形式不正・矛盾は合格にしない。新headごとに別担当レビューを実施し、記録を追加する。
		return result('wait-review', {
			...base,
			waitingOn: '独立Claudeレビュー(同一head・別担当)',
			reviewState: review.reviewState ?? 'unknown',
			retriable: true,
			reasons: [review.detail],
			suggest: /^review-(missing|stale)$/.test(review.code)
				? `run-independent-claude-review (head ${head})`
				: 'fix-or-reissue-review-record',
		});
	}

	// 分類は独立レビュー記録の一部。同じレビューが対象headの実差分・AC・許可境界で判定したものだけを使う。
	const top = review.classification;
	if (top.label.startsWith('unapproved-')) {
		return result('blocked', {
			...base,
			classification: top.label,
			reasons: [`分類${top.label}: 本人承認の参照が未照合。承認範囲外は人間へ`],
			suggest: 'request-approval-reference-or-return-to-human',
		});
	}
	if (top.risk === 'R3' && !top.additionalRiskReview) {
		return result('blocked', {
			...base,
			classification: top.label,
			reasons: ['R3: 追加の独立リスクレビューの記録が必要'],
		});
	}

	if (snapshot.unresolvedThreads == null) {
		return result('blocked', {
			...base,
			retriable: true,
			reasons: ['未解決thread数を取得できない/不完全(GraphQL・認証)'],
		});
	}
	if (snapshot.unresolvedThreads > 0) {
		return result('blocked', {
			...base,
			reasons: [`未解決thread ${snapshot.unresolvedThreads}件`],
			suggest: 'respond-to-threads',
		});
	}
	const rules = snapshot.rules;
	const names = rules?.requiredChecks?.map((r) => r.context) ?? [];
	if (
		!rules ||
		rules.strict !== true ||
		!REQUIRED_CHECKS.every((n) => names.includes(n))
	) {
		return result('blocked', {
			...base,
			retriable: rules == null,
			reasons: ['strict required checks(lint/e2e)を確認できない/無効'],
		});
	}
	if (rules.enforcement !== 'active' || rules.bypassActors !== 0) {
		return result('blocked', {
			...base,
			retriable: rules.bypassActors == null,
			reasons: [
				'rulesetがactiveでない、またはbypass actorを確認できない/存在する',
			],
		});
	}
	if (loops == null) {
		return result('blocked', {
			...base,
			retriable: true,
			reasons: ['修正ループ履歴を確認できない'],
		});
	}
	if (pr.mergeableState !== 'clean') {
		return result('wait-ci', {
			...base,
			waitingOn: 'mergeable状態',
			retriable: true,
			reasons: [`mergeable_state=${pr.mergeableState}`],
		});
	}
	return result('merge-ready', {
		...base,
		classification: top.label,
		reasons: [
			'全条件成立。Merge直前に再取得し、head指定の通常Mergeを既存主体が行う',
		],
		suggest: `merge --match-head-commit ${head}`,
	});
}

// Merge後の判定。公開確認は「merge commitのpush Deploy runの deploy / production-smoke 両jobの成功」だけを証拠にし、
// 誰かのコメント文字列では完了扱いにしない。
function evaluatePostMerge(snapshot, base) {
	const { pr, deploy } = snapshot;
	const sha = pr.mergeCommitSha;
	if (!FULL_SHA.test(sha ?? '')) {
		return result('blocked', {
			...base,
			retriable: true,
			reasons: ['merge commit SHAを取得できない'],
		});
	}
	if (deploy == null) {
		return result('blocked', {
			...base,
			mergeCommit: sha,
			retriable: true,
			reasons: ['Deploy run取得失敗', ...(snapshot.errors ?? [])],
		});
	}
	const run = deploy.runs
		.filter(
			(r) => r.headSha === sha && r.event === 'push' && r.branch === 'main',
		)
		.sort((a, b) => (b.attempt ?? 1) - (a.attempt ?? 1))[0];
	const m = { ...base, mergeCommit: sha };
	if (!run) {
		return result('wait-deploy', {
			...m,
			waitingOn: 'Deploy起動',
			retriable: true,
			reasons: ['merge commitのmain push Deploy runが未確認'],
		});
	}
	// run全体の集約表示（status/conclusion）は遅れることがある。必須jobの完了を、この run・attempt に結び付けて判定する。
	const jobs = (run.jobs ?? null)?.filter(
		(j) => j.runAttempt == null || j.runAttempt === (run.attempt ?? 1),
	);
	if (jobs == null) {
		return result('blocked', {
			...m,
			runId: run.id,
			retriable: true,
			reasons: ['Deploy jobの取得に失敗'],
		});
	}
	const job = (name) => jobs.find((j) => j.name === name);
	const deployed = job(DEPLOY_JOB);
	const smoke = job(SMOKE_JOB);
	const failedJob = [deployed, smoke].find(
		(j) => j?.status === 'completed' && j.conclusion !== 'success',
	);
	if (failedJob) {
		return result('blocked', {
			...m,
			runId: run.id,
			reasons: [
				`${failedJob.name} が ${failedJob.conclusion}。${failedJob.name === SMOKE_JOB ? '公開確認失敗(Deploy成功と混同しない)' : 'Deploy失敗'}として人間へ通知`,
			],
		});
	}
	if (run.status === 'completed' && run.conclusion !== 'success') {
		return result('blocked', {
			...m,
			runId: run.id,
			reasons: [`Deploy ${run.conclusion}。公開確認失敗として人間へ通知`],
		});
	}
	const pending = [deployed, smoke].filter(
		(j) => j && j.status !== 'completed',
	);
	if (pending.length || !deployed) {
		return result('wait-deploy', {
			...m,
			runId: run.id,
			waitingOn: 'Deploy/公開検証',
			retriable: true,
			reasons: [
				...pending.map((j) => `${j.name} status=${j.status}`),
				...(!deployed ? [`${DEPLOY_JOB} job未確認`] : []),
			],
		});
	}
	if (!smoke) {
		// runが完了済みで smoke job が無い（導入前のrun）。進行中のrunでは、後続jobの出現を待つ。
		if (run.status !== 'completed') {
			return result('wait-deploy', {
				...m,
				runId: run.id,
				waitingOn: 'Deploy/公開検証',
				retriable: true,
				reasons: [`run status=${run.status}。${SMOKE_JOB} job未確認`],
			});
		}
		return result('verify-production', {
			...m,
			runId: run.id,
			reasons: [
				`${SMOKE_JOB} jobがない。HTTP・公開SHA・必要操作を別途確認し記録する(コメント文字列は自動証拠にしない)`,
			],
			suggest: 'verify-production-manually-and-record-run-id',
		});
	}
	// ここまで: 公開SHA+HTTP+最小操作はCI上で成功。次はIssue側（指定・取得・ACの完了）。
	if (snapshot.issueNumber == null) {
		return result('blocked', {
			...m,
			runId: run.id,
			reasons: ['対象Issueが未指定。close/done判定不能(--issue)'],
		});
	}
	const issue = snapshot.issue;
	if (!issue) {
		return result('blocked', {
			...m,
			runId: run.id,
			retriable: true,
			reasons: ['対象Issueを取得できない'],
		});
	}
	const open = (issue.body ?? '').match(/^\s*[-*]\s+\[ \]/gm)?.length ?? 0;
	// ACの完了は close/done のどちらでも先に確認する（マージで自動closeされたIssueも対象）。
	if (open > 0) {
		return result('blocked', {
			...m,
			runId: run.id,
			reasons: [
				`Issueの未チェックACが${open}件${issue.state === 'closed' ? '(すでにclose済み。再openまたはACの整理が必要)' : ''}。完了まで done/close にしない`,
			],
		});
	}
	if (issue.state === 'closed') {
		return result('done', {
			...m,
			runId: run.id,
			reasons: ['公開検証成功・Issue close済み'],
		});
	}
	return result('close', {
		...m,
		runId: run.id,
		reasons: [
			'公開検証成功・ACすべてチェック済み。Issueをclose(効果測定はNotionへ引継ぎ)',
		],
		suggest: 'close-issue-and-handoff-rum-to-notion',
	});
}
