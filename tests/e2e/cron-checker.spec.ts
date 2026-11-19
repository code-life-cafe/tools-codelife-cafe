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

	test('systemd timer形式のOnCalendar=をコピーでき、日と曜日の両指定は2行に分けること', async ({
		page,
		createToolPage,
	}) => {
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
		const input = page.getByLabel('cron式', { exact: true });
		const systemd = page.getByTestId('cron-systemd-timer');

		await input.fill('0 9 * * 1-5');
		const weekdays = '[Timer]\nOnCalendar=Mon..Fri *-*-* 09:00:00 Asia/Tokyo';
		await expect(systemd).toContainText('出力タイムゾーン: Asia/Tokyo（JST）');
		await expect(systemd.locator('pre')).toHaveText(weekdays);
		await expect(systemd).not.toContainText('OR条件');
		await systemd.getByRole('button', { name: 'コピー', exact: true }).click();
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe(weekdays);

		await input.fill('0 0 1,15 * 1');
		await expect(systemd.locator('pre')).toHaveText(
			'[Timer]\nOnCalendar=*-*-01,15 00:00:00 Asia/Tokyo\nOnCalendar=Mon *-*-* 00:00:00 Asia/Tokyo',
		);
		await expect(systemd).toContainText('OR条件');

		// 秒付きでもsystemdは秒まで表せるため、警告ではなく変換結果を出す。
		await input.fill('*/10 * * * * *');
		await expect(systemd.locator('pre')).toHaveText(
			'[Timer]\nOnCalendar=*-*-* *:*:00/10 Asia/Tokyo',
		);
	});

	test('フォーマット別コピーはモバイル幅でも横にはみ出さないこと', async ({
		page,
		createToolPage,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await createToolPage('cron-checker').goto();
		await page.getByLabel('cron式', { exact: true }).fill('0 0 1,15 * 1');
		await expect(page.getByTestId('cron-systemd-timer')).toBeVisible();
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth,
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});

	test('EventBridgeのcron式をJSTへ換算して解析欄に反映できること', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('cron-checker').goto();
		const panel = page.getByTestId('cron-import');
		const importInput = page.getByLabel(
			'読み込む式（AWS EventBridge・GitHub Actions）',
		);

		await importInput.fill('cron(0 9 ? * MON-FRI *)');
		await expect(panel).toContainText('AWS EventBridge（cron式）');
		await expect(page.getByTestId('cron-import-source')).toHaveText(
			'0 9 * * MON-FRI',
		);
		await expect(page.getByTestId('cron-import-jst')).toHaveText(
			'0 18 * * MON-FRI',
		);
		await panel.getByRole('button', { name: '解析欄へ反映' }).click();
		await expect(page.getByLabel('cron式', { exact: true })).toHaveValue(
			'0 18 * * MON-FRI',
		);
		await expect(page.getByTestId('cron-description')).toContainText('18:00');
		// 貼り付けた内容はURLに入れない
		expect(page.url()).not.toContain('MON-FRI');

		// AWSが受け付けない式はエラーを出し、反映ボタンを出さない
		await importInput.fill('cron(0 9 * * MON *)');
		await expect(page.getByTestId('cron-import-error')).toContainText(
			'どちらか一方を「?」',
		);
		await expect(
			panel.getByRole('button', { name: '解析欄へ反映' }),
		).toHaveCount(0);
	});

	test('GitHub Actionsのscheduleを読み込み、UTCの換算と5分未満の注意を出すこと', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('cron-checker').goto();
		const importInput = page.getByLabel(
			'読み込む式（AWS EventBridge・GitHub Actions）',
		);

		await importInput.fill("on:\n  schedule:\n    - cron: '*/2 0 * * *'");
		await expect(page.getByTestId('cron-import-jst')).toHaveText('*/2 9 * * *');
		const notes = page.getByTestId('cron-import-notes');
		await expect(notes).toContainText('既定どおりUTC');
		await expect(notes).toContainText('最短5分間隔');

		// 日付をまたぐ時刻が混在する式はJSTへ換算せず、反映ボタンを出さない
		await importInput.fill("- cron: '0 10,20 * * 1'");
		await expect(page.getByTestId('cron-import-source')).toHaveText(
			'0 10,20 * * 1',
		);
		await expect(page.getByTestId('cron-import-jst')).toHaveCount(0);
		await expect(page.getByTestId('cron-import')).toContainText(
			'換算できませんでした',
		);
	});

	for (const width of [375, 1440]) {
		test(`他の形式からの読み込み欄は${width}px幅でも横にはみ出さないこと`, async ({
			page,
			createToolPage,
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await createToolPage('cron-checker').goto();
			await page
				.getByLabel('読み込む式（AWS EventBridge・GitHub Actions）')
				.fill('cron(0/15 0-23 ? JAN,FEB,MAR,APR,MAY,JUN * 2027-2030)');
			await expect(page.getByTestId('cron-import-result')).toBeVisible();
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - window.innerWidth,
			);
			expect(overflow).toBeLessThanOrEqual(0);
		});
	}

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
