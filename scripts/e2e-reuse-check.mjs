#!/usr/bin/env node
// Deploy前に、PRで成功済みのE2Eを流用できるかを判定し、$GITHUB_OUTPUT に reuse=true|false を書く（Issue #723）。
// どんな失敗でも reuse=false（=E2Eを実行する）にして終了コード0で終わる。省略は安全側の例外だけ。
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import {
	E2E_WORKFLOW_PATH,
	isFullSha,
	selectReusableRun,
} from './lib/e2e-reuse.mjs';

const {
	GITHUB_API_URL,
	GITHUB_REPOSITORY,
	GITHUB_TOKEN,
	GITHUB_OUTPUT,
	GITHUB_STEP_SUMMARY,
	BEFORE_SHA,
} = process.env;

// 照合が止まってもデプロイを長く待たせないよう、git・APIとも上限を付ける（超えたらE2Eを実行）
const TIMEOUT_MS = 30_000;

function git(args) {
	return spawnSync('git', args, { encoding: 'utf-8', timeout: TIMEOUT_MS });
}

async function isAncestor(ancestor, descendant) {
	if (!isFullSha(ancestor) || !isFullSha(descendant)) return false;
	// PRのheadはブランチ削除後も refs/pull 経由で取得できる。取得できなければ照合しない
	const fetched = git(['fetch', '--no-tags', '--quiet', 'origin', descendant]);
	if (fetched.status !== 0)
		throw new Error(`git fetch ${descendant} に失敗しました`);
	const result = git(['merge-base', '--is-ancestor', ancestor, descendant]);
	if (result.status === 0) return true;
	if (result.status === 1) return false;
	throw new Error(`git merge-base が失敗しました: ${result.stderr.trim()}`);
}

function write(file, text) {
	if (!file) return;
	try {
		appendFileSync(file, text);
	} catch (error) {
		console.warn(`[e2e-reuse] ${file} へ書けません: ${error.message}`);
	}
}

let decision = { reuse: false, reason: '' };
try {
	if (!GITHUB_API_URL || !GITHUB_REPOSITORY || !GITHUB_TOKEN)
		throw new Error('GitHub API設定が不足しています');
	const tree = git(['rev-parse', 'HEAD^{tree}']);
	if (tree.status !== 0) throw new Error('ツリーSHAを取得できません');
	const treeSha = tree.stdout.trim();
	const workflow = E2E_WORKFLOW_PATH.split('/').pop();
	const response = await fetch(
		`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow}/runs?event=pull_request&status=success&per_page=100`,
		{
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${GITHUB_TOKEN}`,
				'X-GitHub-Api-Version': '2022-11-28',
			},
		},
	);
	if (!response.ok) throw new Error(`GitHub API ${response.status}`);
	const data = await response.json();
	decision = await selectReusableRun({
		runs: data?.workflow_runs,
		treeSha,
		beforeSha: BEFORE_SHA,
		isAncestor,
	});
} catch (error) {
	decision = {
		reuse: false,
		reason: `照合できないためE2Eを実行します: ${error.message}`,
	};
}

const line = decision.reuse
	? `E2Eを省略: ${decision.reason}（${decision.run.html_url}）`
	: `E2Eを実行: ${decision.reason}`;
console.log(`[e2e-reuse] ${line}`);
write(
	GITHUB_OUTPUT,
	`reuse=${decision.reuse ? 'true' : 'false'}\nrun-id=${decision.run?.id ?? ''}\n`,
);
write(GITHUB_STEP_SUMMARY, `## Deploy前E2Eの流用判定\n\n${line}\n`);
process.exit(0);
