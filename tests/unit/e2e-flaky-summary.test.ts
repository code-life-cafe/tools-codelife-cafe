import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	collectFlaky,
	formatSummary,
} from '../../scripts/lib/e2e-flaky-summary.mjs';

const report = {
	stats: { expected: 10, unexpected: 0, flaky: 2, skipped: 1 },
	suites: [
		{
			title: 'base64.spec.ts',
			file: 'base64.spec.ts',
			specs: [
				{
					title: 'エンコードできる',
					file: 'base64.spec.ts',
					tests: [
						{ projectName: 'chromium', status: 'expected' },
						{ projectName: 'mobile-chrome', status: 'flaky' },
					],
				},
			],
			suites: [
				{
					title: 'モード切替',
					file: 'base64.spec.ts',
					specs: [
						{
							title: 'デコード|に切り替える',
							file: 'base64.spec.ts',
							tests: [
								{ projectName: 'chromium', status: 'flaky' },
								{ projectName: 'mobile-chrome', status: 'skipped' },
							],
						},
					],
				},
			],
		},
	],
};

test('入れ子のsuiteも含めてflakyだけを集める', () => {
	assert.deepEqual(collectFlaky(report), [
		{
			file: 'base64.spec.ts',
			title: 'エンコードできる',
			project: 'mobile-chrome',
		},
		{
			file: 'base64.spec.ts',
			title: 'モード切替 › デコード|に切り替える',
			project: 'chromium',
		},
	]);
});

test('flakyが0件なら0件と書き、表を出さない', () => {
	const md = formatSummary({ stats: { expected: 3 }, suites: [] });
	assert.match(md, /flaky: \*\*0件\*\*/);
	assert.doesNotMatch(md, /\| ファイル \|/);
});

test('flakyがあれば件数と表を書き、表の区切り文字をエスケープする', () => {
	const md = formatSummary(report);
	assert.match(md, /flaky: \*\*2件\*\*/);
	assert.match(
		md,
		/\| base64\.spec\.ts \| エンコードできる \| mobile-chrome \|/,
	);
	assert.match(md, /デコード\\\|に切り替える/);
});

test('レポートが無い・形式が違う場合は集計不可と書く', () => {
	assert.match(formatSummary(null), /集計不可/);
	assert.match(formatSummary({ foo: 1 }), /集計不可/);
});

test('CLIはJSONが無くても終了コード0でサマリーに集計不可を書く', () => {
	const dir = mkdtempSync(join(tmpdir(), 'flaky-'));
	const summary = join(dir, 'summary.md');
	writeFileSync(summary, '');
	const r = spawnSync(
		process.execPath,
		['scripts/e2e-flaky-summary.mjs', join(dir, 'missing.json')],
		{
			encoding: 'utf-8',
			env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
		},
	);
	assert.equal(r.status, 0);
	assert.match(readFileSync(summary, 'utf-8'), /集計不可/);
});

test('CLIはflakyがあっても終了コード0', () => {
	const dir = mkdtempSync(join(tmpdir(), 'flaky-'));
	const file = join(dir, 'r.json');
	writeFileSync(file, JSON.stringify(report));
	const r = spawnSync(
		process.execPath,
		['scripts/e2e-flaky-summary.mjs', file],
		{
			encoding: 'utf-8',
			env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
		},
	);
	assert.equal(r.status, 0);
	assert.match(r.stdout, /2件/);
});
