import { expect, test } from './fixtures/base';

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
});
