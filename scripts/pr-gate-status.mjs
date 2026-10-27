#!/usr/bin/env node
// PR進行照合（読み取り専用）。GitHub REST/GraphQLのGET相当だけを使い、書き込み・Merge・コメント投稿はしない。
// 使い方: node scripts/pr-gate-status.mjs <PR番号> [--repo owner/name] [--issue <番号>]
// 認証は任意（GITHUB_TOKEN / GH_TOKEN）。未設定でも公開情報は取得できるが、未解決threadは不明（null）になりblockedに倒れる。
import { evaluate } from './lib/pr-gate.mjs';

const API = 'https://api.github.com';
const DEFAULT_REPO = 'code-life-cafe/tools-codelife-cafe';

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
		async graphql(query, variables) {
			if (!token) throw new Error('GraphQLは認証が必要');
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

/**
 * @param {any} client
 * @param {{ repo?: string, number: number, issue?: any }} opts
 * @returns {Promise<any>}
 */
export async function collect(client, { repo = DEFAULT_REPO, number, issue }) {
	const errors = [];
	const [owner, name] = repo.split('/');
	const pull = await attempt(errors, 'pull', () =>
		client.get(`/repos/${repo}/pulls/${number}`),
	);
	if (!pull) return { repo, errors };
	const pr = {
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
	const comments = await attempt(errors, 'comments', async () => {
		const out = [];
		for (let page = 1; page <= 10; page++) {
			const chunk = await client.get(
				`/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`,
			);
			out.push(...chunk);
			if (chunk.length < 100) break;
		}
		return out.map((c) => ({
			id: c.id,
			login: c.user?.login,
			body: c.body,
			createdAt: c.created_at,
			updatedAt: c.updated_at,
		}));
	});
	const snapshot = { repo, pr, comments, errors };
	if (pr.merged) {
		const runs = await attempt(errors, 'deploy-runs', () =>
			client.get(
				`/repos/${repo}/actions/workflows/deploy.yml/runs?head_sha=${pr.mergeCommitSha}`,
			),
		);
		snapshot.deploy = runs && {
			runs: runs.workflow_runs.map((r) => ({
				headSha: r.head_sha,
				status: r.status,
				conclusion: r.conclusion,
			})),
		};
		if (issue) {
			const i = await attempt(errors, 'issue', () =>
				client.get(`/repos/${repo}/issues/${issue}`),
			);
			snapshot.issue = i && { state: i.state };
		}
		return snapshot;
	}
	const checks = await attempt(errors, 'check-runs', async () => {
		const d = await client.get(
			`/repos/${repo}/commits/${pr.headSha}/check-runs?per_page=100`,
		);
		return d.check_runs.map((c) => ({
			name: c.name,
			status: c.status,
			conclusion: c.conclusion,
			headSha: c.head_sha,
			startedAt: c.started_at,
		}));
	});
	snapshot.checks = checks;
	const cmp = await attempt(errors, 'compare', () =>
		client.get(`/repos/${repo}/compare/${pr.baseRef}...${pr.headSha}`),
	);
	snapshot.behindBy = cmp ? cmp.behind_by : null;
	const rules = await attempt(errors, 'rules', () =>
		client.get(`/repos/${repo}/rules/branches/${pr.baseRef}`),
	);
	if (rules) {
		const rsc = rules.find((r) => r.type === 'required_status_checks');
		snapshot.rules = {
			strict: rsc?.parameters?.strict_required_status_checks_policy === true,
			requiredChecks: (rsc?.parameters?.required_status_checks ?? []).map(
				(c) => c.context,
			),
		};
	}
	snapshot.unresolvedThreads = await attempt(errors, 'threads', async () => {
		const q = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}}}}}`;
		const d = await client.graphql(q, { o: owner, r: name, n: number });
		return d.repository.pullRequest.reviewThreads.nodes.filter(
			(t) => !t.isResolved,
		).length;
	});
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
