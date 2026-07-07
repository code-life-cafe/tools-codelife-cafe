import { expect, test } from './fixtures/base';

test.describe('UNIXタイムスタンプ⇔日時変換ツール', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();
		await toolPage.expectTitle('UNIXタイムスタンプ⇔日時変換');
		await toolPage.expectSafetyBadge();
	});

	test('UNIX秒を入力するとリアルタイムにISO 8601/UNIXミリ秒が表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByLabel('タイムゾーン').click();
		await page.getByRole('option', { name: 'UTC' }).click();

		await page.getByLabel('タイムスタンプまたは日時').fill('1783385779');

		const result = page.getByTestId('unix-time-result');
		await expect(result).toContainText('2026-07-07T00:56:19Z');
		await expect(result).toContainText('1783385779000');
	});

	test('日時文字列からUNIX秒への逆変換ができること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByLabel('タイムゾーン').click();
		await page.getByRole('option', { name: 'UTC' }).click();

		await page
			.getByLabel('タイムスタンプまたは日時')
			.fill('2026-07-07T00:56:19Z');

		const result = page.getByTestId('unix-time-result');
		await expect(result).toContainText('1783385779');
	});

	test('Slack TS形式（秒.マイクロ秒）が自動判定されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByLabel('タイムゾーン').click();
		await page.getByRole('option', { name: 'UTC' }).click();

		await page.getByLabel('タイムスタンプまたは日時').fill('1355517523.000005');

		const result = page.getByTestId('unix-time-result');
		await expect(result).toContainText('2012-12-14T20:38:43.000005Z');
	});

	test('Discordタイムスタンプタグが出力されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByLabel('タイムスタンプまたは日時').fill('1783385779');

		const result = page.getByTestId('unix-time-result');
		await expect(result).toContainText('<t:1783385779:F>');
	});

	test('解釈できない入力では静かにメッセージが表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByLabel('タイムスタンプまたは日時').fill('not-a-timestamp');

		await expect(page.getByText('解釈できません')).toBeVisible();
	});

	test('現在時刻ボタンで入力欄に値が入り結果が表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByRole('button', { name: '現在時刻を入力欄へ' }).click();

		await expect(page.getByTestId('unix-time-result')).toBeVisible();
	});

	test('一括変換タブで複数行を変換できること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByRole('tab', { name: '一括変換' }).click();
		await page
			.getByLabel('一括入力（1行1値）')
			.fill('1783385779\n2026-07-07T00:56:19Z\ninvalid-line');

		const table = page.getByTestId('unix-time-batch-result');
		await expect(table).toBeVisible();
		await expect(table.getByText('エラー')).toBeVisible();
		await expect(table.locator('tbody tr')).toHaveCount(3);
	});

	test('レスポンシブ表示（375px / 1440px）', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.setViewportSize({ width: 375, height: 667 });
		await page.getByLabel('タイムスタンプまたは日時').fill('1783385779');
		await expect(page.getByTestId('unix-time-result')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByTestId('unix-time-result')).toBeVisible();
	});
});
