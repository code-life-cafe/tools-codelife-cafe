import { expect, test } from './fixtures/base';

test.describe('消費税・税込計算ツール', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('tax');
		await toolPage.goto();
		await toolPage.expectTitle('消費税計算（税込・税抜・軽減税率対応）');
		await toolPage.expectSafetyBadge();
	});

	test('10,000円・10%・税抜→税込で税額1,000円・税込11,000円が表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('tax');
		await toolPage.goto();

		await page.getByLabel('金額').fill('10000');

		const resultArea = page.getByTestId('tax-result');
		await expect(resultArea).toContainText('1,000円');
		await expect(resultArea).toContainText('11,000円');
		await expect(resultArea).toContainText('10,000円');
	});

	test('101円・10%で端数処理（切り捨て/切り上げ）が反映されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('tax');
		await toolPage.goto();

		await page.getByLabel('金額').fill('101');

		const resultArea = page.getByTestId('tax-result');
		// デフォルトは切り捨てなので税額は10円
		await expect(resultArea).toContainText('10円');

		// 端数処理を切り上げに変更
		await page.getByLabel('端数処理').click();
		await page.getByRole('option', { name: '切り上げ' }).click();

		await expect(resultArea).toContainText('11円');
	});

	test('税込→税抜タブで11,000円から税抜10,000円が求まること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('tax');
		await toolPage.goto();

		await page.getByRole('tab', { name: '税込 → 税抜' }).click();
		await page.getByLabel('金額').fill('11000');

		const resultArea = page.getByTestId('tax-result');
		await expect(resultArea).toContainText('10,000円');
		await expect(resultArea).toContainText('1,000円');
		await expect(resultArea).toContainText('11,000円');
	});

	test('全角カンマ入力が正規化されて計算されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('tax');
		await toolPage.goto();

		await page.getByLabel('金額').fill('１０，０００');

		const resultArea = page.getByTestId('tax-result');
		await expect(resultArea).toContainText('11,000円');
	});

	test('負数・非数値の入力で日本語エラーが表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('tax');
		await toolPage.goto();

		const amountInput = page.getByLabel('金額');

		await amountInput.fill('-100');
		await expect(page.getByTestId('tax-error')).toContainText('0以上');

		await amountInput.fill('abc');
		await expect(page.getByTestId('tax-error')).toContainText('数値を入力');
	});

	test('レスポンシブ表示（375px / 1440px）', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('tax');
		await toolPage.goto();

		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByLabel('金額')).toBeVisible();
		await page.getByLabel('金額').fill('10000');
		await expect(page.getByTestId('tax-result')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByLabel('金額')).toBeVisible();
		await expect(page.getByTestId('tax-result')).toBeVisible();
	});
});
