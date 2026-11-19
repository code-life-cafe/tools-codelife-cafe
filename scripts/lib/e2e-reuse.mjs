// Deploy時のE2E再実行を省略してよいかを判定する純粋関数（Issue #723、承認済みC）。
//
// 省略できるのは、pull_request で成功した E2E Tests run のうち、次の両方を満たすものがある場合だけ。
// 1. run の head コミットのツリーが、今回デプロイするコミットのツリーと同じ
// 2. push前のmain（beforeSha）が、その head の祖先である
// pull_request の E2E は head を当時の base へマージした内容でテストする。当時の base は
// push前のmainの祖先なので、2 が成り立てば「テストした内容 = head のツリー = 今回のツリー」になる。
// ツリーの一致だけでは、別の base で実行した run を誤って流用しうるため 2 を必須にする。
// 判定できない場合は呼び出し側で「省略しない（E2Eを実行する）」に倒す。

const FULL_SHA = /^[0-9a-f]{40}$/;
const ZERO_SHA = '0'.repeat(40);
export const E2E_WORKFLOW_PATH = '.github/workflows/e2e.yml';

/** 40桁の小文字16進数で、すべて0ではないか */
export function isFullSha(value) {
	return (
		typeof value === 'string' && FULL_SHA.test(value) && value !== ZERO_SHA
	);
}

/** 流用候補になりうる run か（ツリーと祖先関係の確認前の条件） */
export function isCandidateRun(run, treeSha) {
	return (
		run !== null &&
		typeof run === 'object' &&
		run.event === 'pull_request' &&
		run.status === 'completed' &&
		run.conclusion === 'success' &&
		run.path === E2E_WORKFLOW_PATH &&
		isFullSha(run.head_sha) &&
		run.head_commit?.tree_id === treeSha
	);
}

/**
 * 流用できる run を探す。
 * @param {object} params
 * @param {unknown} params.runs GitHub API の workflow_runs（新しい順）
 * @param {string} params.treeSha 今回デプロイするコミットのツリー
 * @param {string | undefined} params.beforeSha push前のmainのコミット（初回pushなどではない）
 * @param {(ancestor: string, descendant: string) => Promise<boolean>} params.isAncestor
 * @returns {Promise<{reuse: boolean, run?: {id: number, head_sha: string, html_url?: string}, reason: string}>}
 */
export async function selectReusableRun({
	runs,
	treeSha,
	beforeSha,
	isAncestor,
}) {
	if (!Array.isArray(runs)) throw new Error('workflow_runs の形式が不正です');
	if (!isFullSha(treeSha)) throw new Error('デプロイ対象のツリーSHAが不正です');
	if (!isFullSha(beforeSha))
		return { reuse: false, reason: 'push前のmainのSHAがないため照合しません' };
	for (const run of runs) {
		if (!isCandidateRun(run, treeSha)) continue;
		if (await isAncestor(beforeSha, run.head_sha)) {
			return {
				reuse: true,
				run,
				reason: `run ${run.id}（head ${run.head_sha}）と同じツリーで、push前のmainを含む`,
			};
		}
	}
	return {
		reuse: false,
		reason: '同じツリーでpush前のmainを含む、成功したPRのE2E runがありません',
	};
}
