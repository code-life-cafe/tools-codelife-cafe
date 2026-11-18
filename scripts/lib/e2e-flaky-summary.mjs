// Playwright JSON reporter の結果から、再試行で通った不安定テスト（flaky）を集計する純粋関数。
// 記録だけの段階（Issue #719）。ジョブの合否は変えない。

/** suites を再帰的にたどり、status が flaky のテストを {file, title, project} で返す */
export function collectFlaky(report) {
	const out = [];
	const walk = (suite, titles) => {
		const nextTitles =
			suite.title && !suite.file?.endsWith(suite.title)
				? [...titles, suite.title]
				: titles;
		for (const spec of suite.specs ?? []) {
			for (const t of spec.tests ?? []) {
				if (t.status === 'flaky') {
					out.push({
						file: spec.file ?? suite.file ?? '',
						title: [...nextTitles, spec.title].filter(Boolean).join(' › '),
						project: t.projectName ?? '',
					});
				}
			}
		}
		for (const child of suite.suites ?? []) walk(child, nextTitles);
	};
	for (const s of report?.suites ?? []) walk(s, []);
	return out;
}

/** ジョブサマリー用のMarkdownを返す。report が null なら集計不可と書く */
export function formatSummary(report) {
	const head = '## E2E 不安定テスト（flaky）\n\n';
	if (!report || !Array.isArray(report.suites)) {
		return `${head}集計不可: Playwright の JSON レポートを読めませんでした。\n`;
	}
	const flaky = collectFlaky(report);
	const stats = report.stats ?? {};
	const lines = [
		`${head}flaky: **${flaky.length}件**（再試行で成功したテスト。CI設定 retries=2）`,
		'',
		`expected: ${stats.expected ?? '-'} / unexpected: ${stats.unexpected ?? '-'} / skipped: ${stats.skipped ?? '-'}`,
	];
	if (flaky.length > 0) {
		lines.push(
			'',
			'| ファイル | テスト | プロジェクト |',
			'| --- | --- | --- |',
		);
		for (const f of flaky) {
			const esc = (s) => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
			lines.push(`| ${esc(f.file)} | ${esc(f.title)} | ${esc(f.project)} |`);
		}
	}
	return `${lines.join('\n')}\n`;
}
