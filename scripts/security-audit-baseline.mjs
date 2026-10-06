import { appendFileSync } from 'node:fs';
const { GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_TOKEN, GITHUB_RUN_ID, GITHUB_OUTPUT } = process.env;
try {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_API_URL || !GITHUB_OUTPUT) throw new Error('GitHub API設定が不足しています');
  async function get(path) {
    const response = await fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/${path}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub API失敗: ${response.status}`);
    return response.json();
  }
  const current = await get(`actions/runs/${GITHUB_RUN_ID}`);
  let baseline;
  for (let page = 1; page <= 10 && !baseline; page++) {
    const data = await get(`actions/workflows/deploy.yml/runs?branch=main&event=push&status=success&per_page=100&page=${page}`);
    if (!Array.isArray(data.workflow_runs)) throw new Error('workflow履歴が不正です');
    baseline = data.workflow_runs.find(run => run.id !== current.id && run.created_at < current.created_at && run.conclusion === 'success' && run.head_branch === 'main');
    if (data.workflow_runs.length < 100) break;
  }
  if (!baseline || !/^[0-9a-f]{40}$/.test(baseline.head_sha)) throw new Error('直前の正常デプロイSHAが見つかりません。比較なしではデプロイしません');
  appendFileSync(GITHUB_OUTPUT, `sha=${baseline.head_sha}\n`);
  console.log(`直前の正常デプロイ: ${baseline.head_sha} (run ${baseline.id})`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
