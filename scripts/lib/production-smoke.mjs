// 公開後の読み取りsmokeの判定部分（ネットワーク・時間は注入可能にしてunit testする）。
// 対象は固定の公開URLだけ。ユーザー入力・秘密・書き込みは扱わない。

const FULL_SHA = /^[0-9a-f]{40}$/;
const ALLOWED_HOSTS = [
	/^tools\.codelife\.cafe$/,
	/^[0-9a-f]{8}\.tools-codelife-cafe\.pages\.dev$/,
];

// allowLocal はローカル検証専用（workflowでは指定しない）。http://localhost / 127.0.0.1 だけ許可する。
export function assertAllowedBaseUrl(raw, { allowLocal = false } = {}) {
	let u;
	try {
		u = new URL(raw);
	} catch {
		throw new Error(`URLが不正: ${raw}`);
	}
	if (
		allowLocal &&
		u.protocol === 'http:' &&
		['localhost', '127.0.0.1'].includes(u.hostname) &&
		!u.username &&
		!u.password
	) {
		return u.origin;
	}
	if (
		u.protocol !== 'https:' ||
		u.port ||
		u.username ||
		u.password ||
		(u.pathname !== '/' && u.pathname !== '')
	) {
		throw new Error(`許可されない公開URL: ${raw}`);
	}
	if (!ALLOWED_HOSTS.some((re) => re.test(u.hostname)))
		throw new Error(`許可されないホスト: ${u.hostname}`);
	return u.origin;
}

const HEADERS = { 'X-CLC-Synthetic': '1' };

export async function checkHttp({ fetchImpl = fetch, url }) {
	const res = await fetchImpl(url, {
		headers: HEADERS,
		cache: 'no-store',
		redirect: 'manual',
	});
	return { url, status: res.status, ok: res.status === 200 };
}

// 公開側が目的のSHAを返すまで（CDN反映待ち）一定回数再試行する。一致しない/取得できない/形式不明は失敗。
export async function waitForBuildInfo({
	fetchImpl = fetch,
	baseUrl,
	expectedSha,
	runId,
	runAttempt,
	attempts = 30,
	intervalMs = 10_000,
	sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
	if (!FULL_SHA.test(expectedSha ?? ''))
		throw new Error('EXPECTED_SHA が40桁の小文字16進ではありません');
	const history = [];
	for (let i = 1; i <= attempts; i++) {
		const url = `${baseUrl}/build-info.json?run=${runId}-${runAttempt}-${i}`;
		const entry = { attempt: i, url, status: null, sha: null, error: null };
		try {
			const res = await fetchImpl(url, {
				headers: HEADERS,
				cache: 'no-store',
				redirect: 'manual',
			});
			entry.status = res.status;
			if (res.status === 200) {
				const body = await res.json();
				entry.sha = typeof body?.sha === 'string' ? body.sha : null;
				entry.runId = body?.runId ?? null;
			}
		} catch (e) {
			entry.error = String(e?.message ?? e);
		}
		history.push(entry);
		if (entry.status === 200 && entry.sha === expectedSha)
			return { ok: true, matched: entry, history };
		if (i < attempts) await sleep(intervalMs);
	}
	return { ok: false, matched: null, history };
}

export function summarize(result) {
	const lines = [
		`### 公開後smoke: ${result.ok ? '成功' : '失敗'}`,
		`- 対象: ${result.baseUrl}`,
		`- merge SHA: \`${result.expectedSha}\``,
		`- run: ${result.runId} / attempt ${result.runAttempt}`,
		`- HTTP(/): ${result.http?.status ?? '未実行'}`,
		`- 公開SHA(build-info): ${result.buildInfo?.matched?.sha ?? '不一致/未取得'}(試行${result.buildInfo?.history?.length ?? 0}回)`,
		`- 操作(wordcloud): ${result.operation ? (result.operation.ok ? '成功' : `失敗: ${result.operation.error}`) : '未実行'}`,
	];
	return `${lines.join('\n')}\n`;
}
