#!/usr/bin/env node
// E2Eジョブの最後に、flaky件数を $GITHUB_STEP_SUMMARY へ書く（Issue #719）。
// 記録だけの段階のため、どんな場合も終了コード0で終わる。
import { appendFileSync, readFileSync } from 'node:fs';
import { formatSummary } from './lib/e2e-flaky-summary.mjs';

const path = process.argv[2] ?? 'test-results/e2e-results.json';
let report = null;
try {
	report = JSON.parse(readFileSync(path, 'utf-8'));
} catch (error) {
	console.warn(`[e2e-flaky-summary] ${path} を読めません: ${error.message}`);
}
const md = formatSummary(report);
process.stdout.write(md);
if (process.env.GITHUB_STEP_SUMMARY) {
	try {
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
	} catch (error) {
		console.warn(`[e2e-flaky-summary] サマリーへ書けません: ${error.message}`);
	}
}
process.exit(0);
