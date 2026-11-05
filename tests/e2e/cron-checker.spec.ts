import { expect, test } from './fixtures/base.ts';

test('入力の編集・クリアでURLへcron本文や不正入力を保存しない', async ({
	page,
}) => {
	await page.goto('/cron-checker?keep=1#result');
	const originalUrl = page.url();
	const input = page.getByLabel('cron式', { exact: true });
	await input.fill(
		'0 9 * * * curl https://example.invalid/job?token=DEMO_SECRET',
	);
	await expect(page.getByRole('alert')).toContainText('フィールド数が不正です');
	expect(page.url()).toBe(originalUrl);
	await expect(
		page.getByRole('button', { name: '共有URLをコピー' }),
	).toHaveCount(0);
	await input.fill('0 18 * * *');
	await expect(page.getByTestId('cron-description')).toContainText('18:00');
	expect(page.url()).toBe(originalUrl);
	await input.clear();
	await expect(page.getByRole('alert')).toBeVisible();
	expect(page.url()).toBe(originalUrl);
});

test('明示操作時だけ検証済みcron式の共有URLをコピーする', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: async (text: string) => {
					document.documentElement.dataset.copiedShare = text;
				},
			},
		});
	});
	await page.goto('/cron-checker?keep=1#result');
	const originalUrl = page.url();
	await page.getByLabel('cron式', { exact: true }).fill('  */5 * * * * *  ');
	const share = page.getByRole('button', { name: '共有URLをコピー' });
	await expect(share).toBeVisible();
	await expect(page.locator('html')).not.toHaveAttribute('data-copied-share');
	expect(page.url()).toBe(originalUrl);
	await share.click();
	const expected = new URL(originalUrl);
	expected.searchParams.set('expr', '*/5 * * * * *');
	await expect(page.locator('html')).toHaveAttribute(
		'data-copied-share',
		expected.toString(),
	);
	expect(page.url()).toBe(originalUrl);
});

test.describe('cron式チェッカー', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('cron-checker');
		await toolPage.goto();
		await toolPage.expectTitle('cron式チェッカー');
		await toolPage.expectSafetyBadge();
	});

	test('cron式を入力すると日本語解説と次回実行日時が表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('cron-checker');
		await toolPage.goto();

		const input = page.getByLabel('cron式');
		await input.fill('0 9 * * 1');

		await expect(page.getByTestId('cron-description')).toHaveText(
			'毎週月曜 9:00',
		);
		await expect(page.getByTestId('cron-next-runs')).toBeVisible();
	});

	test('不正なcron式はエラーメッセージが表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('cron-checker');
		await toolPage.goto();

		const input = page.getByLabel('cron式');
		await input.fill('* * *');

		await expect(page.getByRole('alert')).toContainText(
			'フィールド数が不正です',
		);
	});

	test('JST入力・既存の日時表示・GitHub Actionsのコピーが一致すること', async ({
		page,
		createToolPage,
	}) => {
		await page.clock.setFixedTime(new Date('2026-01-31T14:00:00Z'));
		await page.addInitScript(() => {
			let copied = '';
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: {
					writeText: async (text: string) => {
						copied = text;
					},
					readText: async () => copied,
				},
			});
		});
		await createToolPage('cron-checker').goto();
		await page.getByLabel('cron式', { exact: true }).fill('0 9 * * *');
		await expect(
			page.getByText('入力タイムゾーン: Asia/Tokyo（JST）'),
		).toBeVisible();
		await expect(page.getByTestId('cron-description')).toHaveText('毎日 9:00');
		const table = page.getByTestId('cron-next-runs');
		await expect(
			table.getByRole('columnheader', { name: 'JST', exact: true }),
		).toBeVisible();
		await expect(
			table.getByRole('columnheader', { name: 'UTC', exact: true }),
		).toBeVisible();
		const cells = table.locator('tbody tr').first().getByRole('cell');
		await expect(cells.nth(1)).toContainText(/2026\/02\/01.*09:00:00/);
		await expect(cells.nth(2)).toContainText(/2026\/02\/01.*00:00:00/);
		const github = page.getByTestId('cron-github-actions');
		const expected =
			"schedule:\n  - cron: '0 9 * * *'\n    timezone: 'Asia/Tokyo'";
		await expect(github).toContainText('出力タイムゾーン: Asia/Tokyo（JST）');
		await expect(github.locator('pre')).toHaveText(expected);
		await github.getByRole('button', { name: 'コピー', exact: true }).click();
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe(expected);

		// 追加タイムゾーンは表示列だけを変え、入力や出力の解釈は変えない。
		await page.getByLabel('次回実行日時（10件）').click();
		await page
			.getByRole('option', { name: 'America/New_York', exact: true })
			.click();
		await expect(
			table.getByRole('columnheader', { name: 'America/New_York' }),
		).toBeVisible();
		await expect(cells.nth(1)).toContainText(/2026\/02\/01.*09:00:00/);
		await expect(github.locator('pre')).toHaveText(expected);
	});

	test('秒付きcron式ではGitHub Actionsの警告を表示しコピーを出さない', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('cron-checker').goto();
		for (const expression of ['*/5 * * * * *', '0 0 9 * * *']) {
			await page.getByLabel('cron式', { exact: true }).fill(expression);
			const github = page.getByTestId('cron-github-actions');
			await expect(github).toContainText('秒フィールドに対応していません');
			await expect(github.getByRole('button')).toHaveCount(0);
			await expect(
				page.getByTestId('cron-next-runs').locator('tbody tr'),
			).toHaveCount(10);
		}
	});

	test('毎分実行は危険パターンとして警告されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('cron-checker');
		await toolPage.goto();

		const input = page.getByLabel('cron式');
		await input.fill('* * * * *');

		await expect(page.getByTestId('cron-lint-issues')).toContainText(
			'毎分実行',
		);
	});

	test('日本語からcron式を逆引き生成し、解析欄に反映できること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('cron-checker');
		await toolPage.goto();

		await page
			.getByPlaceholder('例: 平日の9時と18時 / 毎週月曜9時 / 15分おき')
			.fill('15分おき');

		const reverseResult = page.getByTestId('cron-reverse-result');
		await expect(reverseResult).toContainText('*/15 * * * *');

		await reverseResult.getByRole('button', { name: '解析欄へ反映' }).click();
		await expect(page.getByLabel('cron式')).toHaveValue('*/15 * * * *');
	});

	test('プリセットボタンからcron式を入力できること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('cron-checker');
		await toolPage.goto();

		await page.getByRole('button', { name: '平日9時', exact: true }).click();
		await expect(page.getByLabel('cron式')).toHaveValue('0 9 * * 1-5');
	});

	test('?expr= 付きURLへアクセスするとcron式が復元されること', async ({
		page,
	}) => {
		await page.goto('/cron-checker?expr=*/15+*+*+*+*');
		await page.waitForLoadState('networkidle');

		await expect(page.getByLabel('cron式')).toHaveValue('*/15 * * * *');
		await expect(page.getByTestId('cron-description')).toContainText(
			'15分おき',
		);
	});
});
