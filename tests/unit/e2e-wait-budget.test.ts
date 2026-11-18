import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// E2Eの固定待ち（waitForTimeout）を増やさないための歯止め（Issue #722）。
// 固定待ちは不安定テストの温床で、失敗を「待ち時間を足して通す」方向に誘導する。
// 上限は減らす方向にだけ更新する。上げる変更は、状態を待つ書き方にできない理由をPRに書き、
// 独立レビューで確認する対象とする。
const WAIT_FOR_TIMEOUT_BUDGET = 52;

const E2E_DIR = join(import.meta.dirname, '..', 'e2e');

function listTs(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return listTs(p);
		return e.name.endsWith('.ts') ? [p] : [];
	});
}

export function countWaitForTimeout(source: string): number {
	return source.match(/\bwaitForTimeout\s*\(/g)?.length ?? 0;
}

test('countWaitForTimeout: 呼び出しだけを数える', () => {
	assert.equal(countWaitForTimeout(''), 0);
	assert.equal(
		countWaitForTimeout(
			'await page.waitForTimeout(100);\nawait page.waitForTimeout (50);',
		),
		2,
	);
	assert.equal(countWaitForTimeout('// waitForTimeoutは使わない'), 0);
});

test(`E2Eの waitForTimeout は ${WAIT_FOR_TIMEOUT_BUDGET} か所を超えない`, (t) => {
	const perFile = listTs(E2E_DIR)
		.map((f) => ({ f, n: countWaitForTimeout(readFileSync(f, 'utf-8')) }))
		.filter((x) => x.n > 0);
	const total = perFile.reduce((sum, x) => sum + x.n, 0);
	assert.ok(
		total <= WAIT_FOR_TIMEOUT_BUDGET,
		`waitForTimeout が ${total} か所あり、上限 ${WAIT_FOR_TIMEOUT_BUDGET} を超えています。` +
			'固定時間の待ちではなく、expect(locator).toBeVisible() や waitForFunction などで状態を待ってください。',
	);
	if (total < WAIT_FOR_TIMEOUT_BUDGET) {
		t.diagnostic(
			`waitForTimeout が ${total} か所に減りました。WAIT_FOR_TIMEOUT_BUDGET を ${total} に下げてください。`,
		);
	}
});
