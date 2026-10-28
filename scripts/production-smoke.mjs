#!/usr/bin/env node
// 公開後の読み取りsmoke（既存deploy.ymlのproduction-smokeジョブから実行）。
// 固定の公開URLに対して HTTP / 公開SHA(build-info.json) / 既知の短いダミー入力でのwordcloud生成・再生成 を確認し、
// 結果を証拠ファイルに保存する。失敗は終了コード1（=公開確認失敗）。秘密・ユーザー入力・書き込みなし。
// 解析計測を汚さないよう X-CLC-Synthetic を付け、計測系リクエストはブラウザ側で遮断する。
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	assertAllowedBaseUrl,
	checkHttp,
	summarize,
	waitForBuildInfo,
} from './lib/production-smoke.mjs';

const env = process.env;
const baseUrl = assertAllowedBaseUrl(
	env.SMOKE_BASE_URL ?? 'https://tools.codelife.cafe',
	{ allowLocal: env.SMOKE_LOCAL_TEST === '1' },
);
const outDir = env.SMOKE_OUT_DIR ?? 'production-smoke';
const result = {
	ok: false,
	baseUrl,
	expectedSha: env.EXPECTED_SHA ?? '',
	runId: env.SMOKE_RUN_ID ?? '',
	runAttempt: env.SMOKE_RUN_ATTEMPT ?? '',
	startedAt: new Date().toISOString(),
	http: null,
	buildInfo: null,
	operation: null,
};

const FIRST = '吾輩は猫である。名前はまだ無い。名前は猫である。';
const SECOND =
	'確認用の文章です。確認用の文章を再び解析して、確認結果を表示します。';

async function operate() {
	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch({
		timeout: 30_000,
		executablePath: env.SMOKE_CHROMIUM_PATH || undefined,
	});
	const blocked = [];
	try {
		const context = await browser.newContext({
			serviceWorkers: 'block',
			extraHTTPHeaders: { 'X-CLC-Synthetic': '1' },
		});
		for (const pattern of [
			'**/api/event',
			'**/*cloudflareinsights.com/**',
			'**/cdn-cgi/rum*',
			'**/*googletagmanager*',
		]) {
			await context.route(pattern, (route) => {
				blocked.push(route.request().url());
				return route.abort();
			});
		}
		const page = await context.newPage();
		page.setDefaultTimeout(30_000);
		page.setDefaultNavigationTimeout(30_000);
		const resp = await page.goto(`${baseUrl}/wordcloud/`, {
			waitUntil: 'load',
		});
		const status = resp?.status() ?? null;
		if (status !== 200) throw new Error(`/wordcloud/ HTTP ${status}`);
		await page.waitForFunction(
			() =>
				document.querySelectorAll('astro-island[ssr][client="load"]').length ===
				0,
			null,
			{ timeout: 30_000 },
		);
		const input = page.getByLabel('解析対象テキスト');
		const table = page.getByRole('table');
		const heights = [];
		const card = page.getByTestId('wordcloud-canvas');
		await input.fill(FIRST);
		await table.getByText('猫').first().waitFor({ timeout: 30_000 });
		heights.push(Math.round((await card.boundingBox())?.height ?? 0));
		await input.fill(SECOND);
		await table.getByText('確認').first().waitFor({ timeout: 30_000 });
		heights.push(Math.round((await card.boundingBox())?.height ?? 0));
		const svgCount = await page
			.locator('[data-testid="wordcloud-canvas"] svg')
			.count();
		if (svgCount < 1) throw new Error('ワードクラウドのSVGが表示されない');
		return {
			ok: true,
			status,
			firstInput: FIRST,
			secondInput: SECOND,
			cardHeights: heights,
			svgCount,
			blockedAnalyticsRequests: blocked.length,
		};
	} finally {
		await browser.close();
	}
}

// 全体の期限。通信やブラウザ操作が止まっても、期限切れの失敗証拠を保存して必ず終了する。
const deadlineMs = Number(env.SMOKE_DEADLINE_MS ?? 600_000);
const watchdog = setTimeout(() => {
	result.ok = false;
	result.error = `全体期限(${deadlineMs}ms)超過`;
	writeEvidence();
	process.exit(1);
}, deadlineMs);

try {
	result.http = await checkHttp({ url: `${baseUrl}/` });
	result.buildInfo = await waitForBuildInfo({
		baseUrl,
		expectedSha: result.expectedSha,
		runId: result.runId,
		runAttempt: result.runAttempt,
	});
	if (result.http.ok && result.buildInfo.ok) {
		try {
			result.operation = await operate();
		} catch (e) {
			result.operation = { ok: false, error: String(e?.message ?? e) };
		}
	}
	result.ok = Boolean(
		result.http.ok && result.buildInfo.ok && result.operation?.ok,
	);
} catch (e) {
	result.error = String(e?.message ?? e);
}
function writeEvidence() {
	result.finishedAt = new Date().toISOString();
	mkdirSync(outDir, { recursive: true });
	writeFileSync(
		join(outDir, 'smoke-result.json'),
		`${JSON.stringify(result, null, 2)}\n`,
	);
	const summary = summarize(result);
	writeFileSync(join(outDir, 'smoke-summary.md'), summary);
	if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
	console.log(summary);
	console.log(JSON.stringify(result));
}

writeEvidence();
clearTimeout(watchdog);
process.exit(result.ok ? 0 : 1);
