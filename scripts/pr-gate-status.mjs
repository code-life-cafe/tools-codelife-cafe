#!/usr/bin/env node
// PR進行照合（読み取り専用）。GitHub REST/GraphQLのGET相当だけを使い、書き込み・Merge・コメント投稿はしない。
// 使い方: node scripts/pr-gate-status.mjs <PR番号> [--repo owner/name] [--issue <番号>]
// 認証は任意（GITHUB_TOKEN / GH_TOKEN）。未設定でも公開情報は取得できるが、未解決threadは不明（null）になりblockedに倒れる。
// 注意: 環境のproxyを使う場合は NODE_USE_ENV_PROXY=1 が必要（Node 22）。
import { evaluate } from './lib/pr-gate.mjs';

const API = 'https://api.github.com';
const DEFAULT_REPO = 'code-life-cafe/tools-codelife-cafe';
const PAGE_LIMIT = 100; // 100件/ページ。到達しても終わらなければ不完全として扱う。

/** @param {{ token?: string, fetchImpl?: any }} [opts] */
export function createClient({ token, fetchImpl = fetch } = {}) {
	const headers = {
		accept: 'application/vnd.github+json',
		'user-agent': 'pr-gate-status',
	};
	if (token) headers.authorization = `Bearer ${token}`;
	return {
		async get(path) {
			const res = await fetchImpl(`${API}${path}`, { method: 'GET', headers });
			if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
			return res.json();
		},
		// GraphQLはread専用のqueryだけを送る。mutationは拒否する。
		async graphql(query, variables) {
			if (!token) throw new Error('GraphQLは認証が必要');
			if (!/^\s*query\b/.test(query)) throw new Error('queryのみ許可');
			const res = await fetchImpl(`${API}/graphql`, {
				method: 'POST',
				headers: { ...headers, 'content-type': 'application/json' },
				body: JSON.stringify({ query, variables }),
			});
			if (!res.ok) throw new Error(`graphql -> ${res.status}`);
			const body = await res.json();
			if (body.errors)
				throw new Error(
					`graphql errors: ${JSON.stringify(body.errors).slice(0, 200)}`,
				);
			return body.data;
		},
	};
}

async function attempt(errors, label, fn) {
	try {
		return await fn();
	} catch (e) {
		errors.push(`${label}: ${e.message}`);
		return null;
	}
}

// 全ページを取得する。ページ上限に達しても終わらない場合は例外（不完全な一覧を返さない）。
async function paged(client, path, pick) {
	const out = [];
	const sep = path.includes('?') ? '&' : '?';
	for (let page = 1; page <= PAGE_LIMIT; page++) {
		const chunk = pick(
			await client.get(`${path}${sep}per_page=100&page=${page}`),
		);
		if (!Array.isArray(chunk)) throw new Error(`${path}: 未知の応答形式`);
		out.push(...chunk);
		if (chunk.length < 100) return out;
	}
	throw new Error(`${path}: ${PAGE_LIMIT}ページ上限に到達(不完全)`);
}

const THREADS_QUERY = `query($o:String!,$r:String!,$n:Int!,$after:String){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{isResolved}}}}}`;

async function unresolvedThreads(client, owner, name, number) {
	let after = null;
	let count = 0;
	for (let i = 0; i < PAGE_LIMIT; i++) {
		const d = await client.graphql(THREADS_QUERY, {
			o: owner,
			r: name,
			n: number,
			after,
		});
		const t = d?.repository?.pullRequest?.reviewThreads;
		if (!t || !Array.isArray(t.nodes) || !t.pageInfo)
			throw new Error('threads: 未知の応答形式');
		count += t.nodes.filter((n) => !n.isResolved).length;
		if (!t.pageInfo.hasNextPage) return count;
		after = t.pageInfo.endCursor;
	}
	throw new Error('threads: ページ上限に到達(不完全)');
}

function normalizePull(pull) {
	return {
		number: pull.number,
		state: pull.state,
		draft: pull.draft,
		merged: Boolean(pull.merged),
		headSha: pull.head.sha,
		baseRef: pull.base.ref,
		baseSha: pull.base.sha,
		mergeableState: pull.mergeable_state,
		mergeCommitSha: pull.merge_commit_sha,
		body: pull.body ?? '',
	};
}

async function readRules(client, repo, baseRef) {
	const list = await client.get(`/repos/${repo}/rules/branches/${baseRef}`);
	if (!Array.isArray(list)) throw new Error('rules: 未知の応答形式');
	const rsc = list.filter((r) => r.type === 'required_status_checks');
	const requiredChecks = rsc.flatMap((r) =>
		(r.parameters?.required_status_checks ?? []).map((c) => ({
			context: c.context,
			integrationId: c.integration_id ?? null,
		})),
	);
	const rules = {
		strict:
			rsc.length > 0 &&
			rsc.every(
				(r) => r.parameters?.strict_required_status_checks_policy === true,
			),
		requiredChecks,
		enforcement: null,
		bypassActors: null,
	};
	const ids = [
		...new Set(
			list
				.filter((r) => r.type === 'required_status_checks')
				.map((r) => r.ruleset_id),
		),
	];
	if (ids.length) {
		const details = await Promise.all(
			ids.map((id) => client.get(`/repos/${repo}/rulesets/${id}`)),
		);
		rules.enforcement = details.every((d) => d.enforcement === 'active')
			? 'active'
			: 'other';
		rules.bypassActors = details.every((d) => Array.isArray(d.bypass_actors))
			? details.reduce((n, d) => n + d.bypass_actors.length, 0)
			: null;
	}
	return rules;
}

/**
 * @param {any} client
 * @param {{ repo?: string, number: number, issue?: any, now?: number }} opts
 * @returns {Promise<any>}
 */
export async function collect(
	client,
	{ repo = DEFAULT_REPO, number, issue, now = Date.now() },
) {
	const errors = [];
	const [owner, name] = repo.split('/');
	const pull = await attempt(errors, 'pull', () =>
		client.get(`/repos/${repo}/pulls/${number}`),
	);
	if (!pull) return { repo, errors };
	const pr = normalizePull(pull);
	const snapshot = {
		repo,
		pr,
		errors,
		now,
		issueNumber: issue ? Number(issue) : null,
	};

	snapshot.comments = await attempt(errors, 'comments', async () =>
		(
			await paged(client, `/repos/${repo}/issues/${number}/comments`, (x) => x)
		).map((c) => ({
			id: c.id,
			login: c.user?.login,
			authorType: c.user?.type,
			body: c.body,
			createdAt: c.created_at,
			updatedAt: c.updated_at,
		})),
	);

	if (pr.merged) {
		snapshot.deploy = await attempt(errors, 'deploy-runs', async () => {
			const d = await client.get(
				`/repos/${repo}/actions/workflows/deploy.yml/runs?head_sha=${pr.mergeCommitSha}&event=push&branch=${pr.baseRef}&per_page=20`,
			);
			if (!Array.isArray(d.workflow_runs)) throw new Error('未知の応答形式');
			const runs = [];
			for (const r of d.workflow_runs) {
				const base = {
					id: r.id,
					attempt: r.run_attempt,
					headSha: r.head_sha,
					event: r.event,
					branch: r.head_branch,
					status: r.status,
					conclusion: r.conclusion,
					jobs: null,
				};
				const jobs = await attempt(errors, `jobs(${r.id})`, async () => {
					const j = await client.get(
						`/repos/${repo}/actions/runs/${r.id}/jobs?filter=latest&per_page=100`,
					);
					if (!Array.isArray(j.jobs)) throw new Error('未知の応答形式');
					return j.jobs.map((x) => ({
						name: x.name,
						status: x.status,
						conclusion: x.conclusion,
					}));
				});
				runs.push({ ...base, jobs });
			}
			return { runs };
		});
		if (snapshot.issueNumber) {
			const i = await attempt(errors, 'issue', () =>
				client.get(`/repos/${repo}/issues/${snapshot.issueNumber}`),
			);
			snapshot.issue = i && { state: i.state, body: i.body ?? '' };
		}
		return snapshot;
	}

	snapshot.checks = await attempt(errors, 'check-runs', async () => {
		const out = [];
		let total = Infinity;
		for (let page = 1; out.length < total && page <= PAGE_LIMIT; page++) {
			const d = await client.get(
				`/repos/${repo}/commits/${pr.headSha}/check-runs?per_page=100&page=${page}`,
			);
			if (!Array.isArray(d.check_runs)) throw new Error('未知の応答形式');
			total = d.total_count;
			out.push(...d.check_runs);
			if (d.check_runs.length === 0) break;
		}
		if (out.length < total) throw new Error('check-runsが不完全');
		return out.map((c) => ({
			name: c.name,
			status: c.status,
			conclusion: c.conclusion,
			headSha: c.head_sha,
			startedAt: c.started_at,
			appId: c.app?.id ?? null,
		}));
	});
	snapshot.reviews = await attempt(errors, 'reviews', async () =>
		(
			await paged(client, `/repos/${repo}/pulls/${number}/reviews`, (x) => x)
		).map((r) => ({
			login: r.user?.login,
			authorType: r.user?.type,
			state: r.state,
			submittedAt: r.submitted_at,
		})),
	);
	const cmp = await attempt(errors, 'compare', () =>
		client.get(`/repos/${repo}/compare/${pr.baseRef}...${pr.headSha}`),
	);
	snapshot.behindBy = typeof cmp?.behind_by === 'number' ? cmp.behind_by : null;
	snapshot.rules = await attempt(errors, 'rules', () =>
		readRules(client, repo, pr.baseRef),
	);
	snapshot.unresolvedThreads = await attempt(errors, 'threads', () =>
		unresolvedThreads(client, owner, name, number),
	);
	const commit = await attempt(errors, 'head-commit', () =>
		client.get(`/repos/${repo}/commits/${pr.headSha}`),
	);
	pr.headCommittedAt = commit?.commit?.committer?.date ?? null;

	// 取得の最後にPRを読み直し、途中でhead/base/状態が変わっていないことを確認する。
	const again = await attempt(errors, 'pull(re-read)', () =>
		client.get(`/repos/${repo}/pulls/${number}`),
	);
	if (again) {
		const a = normalizePull(again);
		const changed = ['headSha', 'baseSha', 'state', 'draft', 'merged'].filter(
			(k) => a[k] !== pr[k],
		);
		if (changed.length) snapshot.inconsistent = changed.join(',');
	} else {
		snapshot.inconsistent = '再読に失敗';
	}
	return snapshot;
}

const isMain =
	process.argv[1] &&
	import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
	const args = process.argv.slice(2);
	const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
	const number = Number(args.find((a) => /^\d+$/.test(a)));
	if (!number) {
		console.error(
			'usage: node scripts/pr-gate-status.mjs <PR番号> [--repo owner/name] [--issue N]',
		);
		process.exit(2);
	}
	const client = createClient({
		token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
	});
	const snapshot = await collect(client, {
		repo: opt('--repo'),
		number,
		issue: opt('--issue'),
	});
	const verdict = evaluate(snapshot);
	console.log(
		JSON.stringify({ number, ...verdict, errors: snapshot.errors }, null, 2),
	);
}
