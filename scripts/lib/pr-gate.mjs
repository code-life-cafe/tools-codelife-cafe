// PR進行照合の純粋評価。取得（scripts/pr-gate-status.mjs）とは分離し、副作用を持たない。
// 出力はMerge許可ではなく「いま何を待つか/何をすべきか」の判定。Merge操作は含まない。
// 取得失敗・未知形式・旧SHA・矛盾は合格にせず、必ず待ちかblockedに倒す（fail-closed）。

export const STATES = [
	'ready',
	'sync-base',
	'wait-ci',
	'wait-review',
	'wait-classification',
	'blocked',
	'merge-ready',
	'wait-deploy',
	'verify-production',
	'close',
	'done',
];

export const CODEX_BOT_LOGIN = 'chatgpt-codex-connector[bot]';
export const REQUIRED_CHECKS = ['lint', 'e2e'];
export const MAX_FIX_LOOPS = 3;
// 公開後の読み取りsmokeを行う既存deploy.yml内のjob名。
export const DEPLOY_JOB = 'deploy';
export const SMOKE_JOB = 'production-smoke';
// head遅れで時間経過のみを根拠に再依頼候補を出すまでの分数。
export const REREQUEST_AFTER_MINUTES = 20;

const FULL_SHA = /^[0-9a-f]{40}$/;
const RISK_BY_CLASS = { A: ['R0', 'R1'], B: ['R2', 'R3'], C: ['R4'] };
const STRICTNESS = [
	'A',
	'approved-B',
	'approved-C',
	'unapproved-B',
	'unapproved-C',
];

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
	return new RegExp(`<!--\\s*${name}(?=\\s|-->|$)`).test(body ?? '');
}

function parseJsonMarker(body, name) {
	// Codex botの分類コメントは波括弧がHTML数値参照（&#123; &#125;）で返るため、先に戻す。
	const text = (body ?? '')
		.replaceAll('&#123;', '{')
		.replaceAll('&#125;', '}')
		.replaceAll('&quot;', '"');
	if (
		[...text.matchAll(new RegExp(`<!--\\s*${name}(?=\\s|-->|$)`, 'g'))]
			.length !== 1
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

const isCodexBot = (c) => c.login === CODEX_BOT_LOGIN && c.authorType === 'Bot';

// Codex Review Summary（bot本人のコメント）を読み、対象headの完了状況を返す。
export function readCodexSummary(comments, { repo, number, headSha }) {
	const latest = comments
		.filter(isCodexBot)
		.filter((c) => hasJsonMarker(c.body, 'codex-review-state:v1'))
		.sort(
			(a, b) =>
				Date.parse(b.updatedAt ?? b.createdAt) -
				Date.parse(a.updatedAt ?? a.createdAt),
		)[0];
	if (!latest)
		return {
			ok: false,
			code: 'summary-missing',
			detail: 'Codex Review Summaryが未取得',
		};
	if (!Number.isFinite(Date.parse(latest.updatedAt ?? latest.createdAt)))
		return {
			ok: false,
			code: 'summary-time-invalid',
			detail: 'サマリー時刻が不正',
		};
	const state = parseJsonMarker(latest.body, 'codex-review-state:v1');
	const sec = parseJsonMarker(latest.body, 'codex-security-review:v1');
	const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
	if (!isObj(state) || !isObj(sec))
		return {
			ok: false,
			code: 'summary-unparsable',
			detail: 'メタデータ形式が未知',
		};
	if (sec.repository !== repo || sec.pullRequestNumber !== number) {
		return {
			ok: false,
			code: 'summary-other-pr',
			detail: 'repository/PR番号が不一致',
		};
	}
	// 完全SHAのみ比較する。欠落（Code対象SHAなし等）は合格にしない。
	const check = (label, r) => {
		if (!isObj(r) || !FULL_SHA.test(r.commit_sha ?? '')) {
			return {
				code: `${label}-sha-missing`,
				detail: `${label}の対象commit_shaが欠落/不正`,
			};
		}
		if (r.commit_sha !== headSha) {
			return {
				code: `${label}-stale`,
				detail: `${label}は旧head ${r.commit_sha.slice(0, 7)}`,
			};
		}
		if (['error', 'failed', 'cancelled', 'canceled'].includes(r.status)) {
			return { code: `${label}-error`, detail: `${label}のstatus=${r.status}` };
		}
		if (r.status !== 'completed') {
			return {
				code: `${label}-${['running', 'queued', 'pending', 'in_progress'].includes(r.status) ? 'running' : 'unknown'}`,
				detail: `${label}のstatus=${r.status}`,
			};
		}
		if (r.has_unresolved_findings === true) {
			return {
				code: `${label}-findings`,
				detail: `${label}に未解決指摘あり`,
			};
		}
		if (r.has_unresolved_findings !== false)
			return {
				code: `${label}-unknown`,
				detail: `${label}の指摘有無が不明（技術待ち）`,
			};
		return null;
	};
	const problems = [
		check('code', state.code_review),
		check('security', state.security_review),
	].filter(Boolean);
	if (problems.length) {
		// 別レビューの結果不明で、確認済みの実指摘を隠さない。
		const primary =
			problems.find((p) => p.code.endsWith('-findings')) ?? problems[0];
		return {
			ok: false,
			...primary,
			reviewState: /-(findings|running|error)$/.test(primary.code)
				? primary.code.split('-').at(-1)
				: 'unknown',
			all: problems,
		};
	}
	if (sec.headSha !== headSha || sec.status !== 'completed') {
		const stale = sec.headSha !== headSha;
		return {
			ok: false,
			code: stale
				? 'security-meta-stale'
				: `security-meta-${['running', 'queued', 'pending', 'in_progress'].includes(sec.status) ? 'running' : ['error', 'failed', 'cancelled', 'canceled'].includes(sec.status) ? 'error' : 'unknown'}`,
			detail: `security-review meta headSha=${String(sec.headSha).slice(0, 7)} status=${sec.status}`,
		};
	}

	return { ok: true, reviewState: 'clean' };
}

// 分類マーカー（codex-classification:v1）の検証。形式・SHA・分類とriskの整合・承認参照を満たすものだけ有効。
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
	if (
		m.supersedes !== undefined &&
		!(
			Array.isArray(m.supersedes) &&
			m.supersedes.every((x) => /^\d+$/.test(String(x).replace(/^.*[#/]/, '')))
		)
	)
		return { ok: false, why: 'supersedesの形式が不明' };
	const supersedes = (m.supersedes ?? []).map((x) =>
		String(x).replace(/^.*[#/]/, ''),
	);
	if (m.class === 'A') {
		if (m.unapprovedScope.length)
			return { ok: false, why: 'Aなのに未承認範囲が残っている(矛盾)' };
		return m.approvalStatus === 'not-required'
			? { ok: true, label: 'A', class: 'A', risk: m.risk, supersedes }
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
			supersedes,
		};
	}
	if (m.approvalStatus === 'unapproved') {
		return {
			ok: true,
			label: `unapproved-${m.class}`,
			class: m.class,
			risk: m.risk,
			supersedes,
		};
	}
	return { ok: false, why: 'approvalStatusが不正' };
}

// 独立分類の自動証拠は、検証済みCodex連携botの構造化マーカーだけ。
// ユーザー名義の自由文（Codexチャット経由を含む）はログインから人間/Codex/Claudeを区別できないため、
// 自動許可の証拠にせず manual として件数だけ返す。
export function readClassifications(comments, ctx) {
	const valid = [];
	const invalid = [];
	let manual = 0;
	for (const c of comments) {
		const body = c.body ?? '';
		if (isCodexBot(c) && hasJsonMarker(body, 'codex-classification:v1')) {
			const v = Number.isFinite(Date.parse(c.createdAt))
				? validateClassification(
						parseJsonMarker(body, 'codex-classification:v1'),
						ctx,
					)
				: { ok: false, why: '分類の投稿時刻が不正' };
			// 他headを対象にした正しい形式のマーカーは今回のheadには無関係。
			if (v.ok) valid.push({ ...v, id: c.id, at: c.createdAt });
			else if (v.why !== '対象headが不一致')
				invalid.push({ id: c.id, why: v.why, at: c.createdAt });
			continue;
		}
		if (body.includes(ctx.headSha) && /独立分類/.test(body)) manual += 1;
	}
	// botが後続の分類で明示的に置き換えた旧判定だけを無効化する。未解決の反対判定は残り、厳しい側が優先される。
	const live = valid.filter(
		(v) =>
			!valid.some(
				(n) =>
					n !== v &&
					n.supersedes.includes(String(v.id)) &&
					Date.parse(n.at) > Date.parse(v.at),
			),
	);
	live.sort(
		(a, b) => STRICTNESS.indexOf(b.label) - STRICTNESS.indexOf(a.label),
	);
	// 無効マーカーも、botが後続の有効な分類で明示的に置き換えた場合だけ解消する（無関係ID・先行投稿では解消しない）。
	const liveInvalid = invalid.filter(
		(i) =>
			!valid.some(
				(n) =>
					n.supersedes.includes(String(i.id)) &&
					Date.parse(n.at) > Date.parse(i.at),
			),
	);
	const latestMarkerAt = valid.reduce(
		(t, v) => Math.max(t, Date.parse(v.at)),
		0,
	);
	return { valid: live, invalid: liveInvalid, manual, latestMarkerAt };
}

// 既存の依頼履歴（headとtypeで判定）。同じhead・同じ種別の依頼を重ねない根拠。
const isClassificationRequest = (body) =>
	/@codex\s+classify\b/i.test(body) ||
	(/@codex\b/i.test(body) &&
		/(?:独立分類|分類(?:確認|依頼|を|してください))/.test(body));

export function priorRequests(comments, headSha) {
	const types = new Set();
	for (const c of comments) {
		if (isCodexBot(c) || !(c.body ?? '').includes(headSha)) continue;
		const b = c.body;
		if (isClassificationRequest(b)) types.add('classify');
		else if (/@codex\s+security\s+review/i.test(b)) types.add('security');
		else if (/@codex\s+review/i.test(b)) types.add('review');
	}
	return types;
}

// 分類の再照合依頼（承認参照の更新・形式訂正）を、更新ごとに一度だけ許可する。
// 最後の分類依頼より後に、bot以外の「承認」を含むコメントがあるときだけ true（現在の判定が未承認B/Cまたは無効マーカーの場合に使う）。
export function canRequestReconcile(comments, headSha, cls) {
	const lastRequest = comments
		.filter(
			(c) =>
				!isCodexBot(c) &&
				(c.body ?? '').includes(headSha) &&
				isClassificationRequest(c.body ?? ''),
		)
		.reduce((t, c) => Math.max(t, Date.parse(c.createdAt)), 0);
	const updates = comments.filter(
		(c) =>
			!isCodexBot(c) &&
			/承認|approval/i.test(c.body ?? '') &&
			Date.parse(c.createdAt) > Math.max(lastRequest, cls.latestMarkerAt),
	);
	return lastRequest > 0 && updates.length > 0;
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

function reviewRequestHint(review, comments, head, snapshot) {
	const prior = priorRequests(comments, head);
	const security = /^security/.test(review.code);
	const type = security ? 'security' : 'review';
	if (prior.has(type)) {
		return { suggest: null, note: `${type}は同headに依頼済み。待つ` };
	}
	const shaMissing = /sha-missing$/.test(review.code);
	const ageMin =
		snapshot.now != null && snapshot.pr.headCommittedAt
			? (snapshot.now - Date.parse(snapshot.pr.headCommittedAt)) / 60000
			: null;
	const timedOut =
		/^(summary-missing|code-stale|security-stale|security-meta-stale)$/.test(
			review.code,
		) &&
		ageMin != null &&
		ageMin >= REREQUEST_AFTER_MINUTES;
	if (!shaMissing && !timedOut) return { suggest: null, note: null };
	return {
		suggest: `request-once: codex-${security ? 'security-review' : 'review'} (head ${head})`,
		note: null,
	};
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

	const review = readCodexSummary(comments, {
		repo,
		number: pr.number,
		headSha: head,
	});
	if (!review.ok) {
		if (/findings$/.test(review.code)) {
			return result('blocked', {
				...base,
				reasons: [review.detail],
				reviewState: review.reviewState,
				suggest: repairSuggestion('classify-and-fix-findings'),
			});
		}
		const hint = reviewRequestHint(review, comments, head, snapshot);
		return result('wait-review', {
			...base,
			waitingOn: 'Codexレビュー',
			reviewState:
				review.reviewState ??
				(/error$/.test(review.code)
					? 'error'
					: /running$/.test(review.code)
						? 'running'
						: 'unknown'),
			retriable: true,
			reasons: [review.detail, ...(hint.note ? [hint.note] : [])],
			suggest: hint.suggest,
		});
	}

	const cls = readClassifications(comments, {
		repo,
		number: pr.number,
		headSha: head,
	});
	if (!cls.valid.length) {
		const requested = priorRequests(comments, head).has('classify');
		return result('wait-classification', {
			...base,
			waitingOn: '独立分類(同一head・Codex bot)',
			retriable: true,
			reasons: [
				'対象headの検証済みbot分類マーカーが未記録。「重大指摘なし」・ユーザー名義の自由文では代替しない',
				...cls.invalid.map((i) => `無効なマーカー(${i.id}): ${i.why}`),
				...(cls.manual
					? [`手動の分類コメント${cls.manual}件は自動証拠にしない(人間が確認)`]
					: []),
				...(requested ? ['同headにCodex分類依頼済み。応答を待つ'] : []),
			],
			suggest: !requested
				? `request-once: codex-classify (head ${head})`
				: cls.invalid.length && canRequestReconcile(comments, head, cls)
					? `request-once: codex-classify-reconcile (head ${head})`
					: null,
		});
	}
	// 同headに解消されていない無効マーカーが残る間は、有効な分類があっても進めない（矛盾を捨ててmerge-readyにしない）。
	if (cls.invalid.length) {
		return result('blocked', {
			...base,
			retriable: true,
			reasons: [
				'同headに矛盾/無効な分類マーカーが残っている。botのsupersedesで明示的に置き換えられるまで進めない',
				...cls.invalid.map((i) => `無効なマーカー(${i.id}): ${i.why}`),
			],
			suggest: canRequestReconcile(comments, head, cls)
				? `request-once: codex-classify-reconcile (head ${head})`
				: null,
		});
	}
	const top = cls.valid[0]; // 矛盾時は最も厳しい分類
	if (top.label.startsWith('unapproved-')) {
		return result('blocked', {
			...base,
			classification: top.label,
			reasons: [`分類${top.label}: 本人承認の参照が未照合。承認範囲外は人間へ`],
			suggest: canRequestReconcile(comments, head, cls)
				? `request-once: codex-classify-reconcile (head ${head})`
				: 'request-approval-reference-or-return-to-human',
		});
	}
	// 同じラベル(例: approved-B)でもR3の追加リスクレビュー未記録の判定が1つでも残れば進めない。
	if (cls.valid.some((v) => v.risk === 'R3' && !v.additionalRiskReview)) {
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
