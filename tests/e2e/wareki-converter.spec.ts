import { expect, test } from './fixtures/base';

test.describe('Wareki Converter Tool', () => {
	test('should load the page correctly', async ({ createToolPage }) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();
		await toolPage.expectTitle('和暦↔西暦・年齢変換 | CODE:LIFE Tools');
		await toolPage.expectSafetyBadge();
	});

	test('should convert seireki to wareki and vice versa', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		// 1. Convert Seireki to Wareki (default)
		const seirekiInput = page.locator('input[type="number"]');
		await seirekiInput.fill('2000');

		// Verify output (平成12年) in the result table
		await expect(page.getByRole('cell', { name: '平成12年' })).toBeVisible();

		// 2. Switch direction to Wareki -> Seireki
		await page.getByRole('switch').click();

		// Set Wareki input to 令和2年
		const warekiInput = page.locator('input[type="text"]');
		await warekiInput.fill('令和2年');

		// Verify output (2020年)
		await expect(page.getByRole('cell', { name: '2020年' })).toBeVisible();
	});

	test('should show pre-Meiji era results with a caveat notice', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		await page.getByRole('switch').click();
		const warekiInput = page.locator('input[type="text"]');
		await warekiInput.fill('慶応3年');

		await expect(page.getByRole('cell', { name: '1867年' })).toBeVisible();
		await expect(
			page.getByText(
				'年単位の対応候補です。旧暦月日を新暦月日に変換した結果ではありません。',
				{ exact: true },
			),
		).toBeVisible();
	});

	test('should show multiple era candidates for a era-change year', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		const seirekiInput = page.locator('input[type="number"]');
		await seirekiInput.fill('1868');

		await expect(
			page.getByRole('cell', { name: '慶応4年 明治元年' }).first(),
		).toBeVisible();
	});

	test('should copy the exact result text matching the on-screen display', async ({
		page,
		context,
		createToolPage,
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);

		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		// 1868年は改元年（慶応4年/明治元年が併存）で、旧暦注意も表示される境界ケース
		const seirekiInput = page.locator('input[type="number"]');
		await seirekiInput.fill('1868');

		await expect(
			page.getByRole('cell', { name: '慶応4年 明治元年' }).first(),
		).toBeVisible();

		await page.getByRole('button', { name: 'コピー' }).click();
		await expect(
			page.getByRole('button', { name: 'コピーしました' }),
		).toBeVisible();

		const clipboardText = await page.evaluate(() =>
			navigator.clipboard.readText(),
		);

		// 年齢範囲はテスト実行日に依存するため、画面表示と同じ計算式で期待値を組み立てる
		const now = new Date();
		const min = now.getFullYear() - 1868 - 1;
		const max = now.getFullYear() - 1868;

		expect(clipboardText).toBe(
			[
				'和暦: 慶応4年 / 明治元年',
				'西暦: 1868年',
				'干支: 辰年',
				`年齢: ${min}〜${max}歳`,
				'注意: 年単位の対応候補です。旧暦月日を新暦月日に変換した結果ではありません。',
			].join('\n'),
		);
	});

	test('should reject a non-existent date', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		const seirekiInput = page.locator('input[type="number"]');
		await seirekiInput.fill('2023');
		await page.getByRole('combobox', { name: '月（任意）' }).click();
		await page.getByRole('option', { name: '2月', exact: true }).click();
		await page.getByRole('combobox', { name: '日（任意）' }).click();
		await page.getByRole('option', { name: '31日', exact: true }).click();

		await expect(
			page.getByText(
				'存在しない日付です。月・日の入力内容を確認してください。',
			),
		).toBeVisible();
	});

	test('should reject a wareki/date combination outside the era boundary', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		await page.getByRole('switch').click();
		const warekiInput = page.locator('input[type="text"]');
		await warekiInput.fill('平成元年');

		await page.getByRole('combobox', { name: '月（任意）' }).click();
		await page.getByRole('option', { name: '1月', exact: true }).click();
		await page.getByRole('combobox', { name: '日（任意）' }).click();
		await page.getByRole('option', { name: '1日', exact: true }).click();

		await expect(
			page.getByText('指定した和暦と月日の組み合わせが一致しません'),
		).toBeVisible();
	});
});
