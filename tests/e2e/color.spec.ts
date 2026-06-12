import { expect, test } from './fixtures/base';

test.describe('カラーコード変換ツール', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('color');
		await toolPage.goto();
		await toolPage.expectTitle('カラーコード変換');
		await toolPage.expectSafetyBadge();
	});

	test('HEX入力でRGB/HSL/CMYKの4形式が表示・コピーできること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('color');
		await toolPage.goto();

		const input = page.getByLabel('カラーコード入力');
		await input.fill('');
		await input.fill('#1E90FF');

		await expect(page.getByTestId('color-result-hex')).toContainText('#1e90ff');
		await expect(page.getByTestId('color-result-rgb')).toContainText(
			'rgb(30, 144, 255)',
		);
		await expect(page.getByTestId('color-result-hsl')).toContainText('hsl(');
		await expect(page.getByTestId('color-result-cmyk')).toContainText('cmyk(');

		// コピー動作
		await page
			.getByTestId('color-result-hex')
			.getByRole('button', { name: /コピー/ })
			.click();
		await expect(
			page
				.getByTestId('color-result-hex')
				.getByRole('button', { name: 'コピーしました' }),
		).toBeVisible();
	});

	test('rgb()入力でHEXが表示されること', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('color');
		await toolPage.goto();

		const input = page.getByLabel('カラーコード入力');
		await input.fill('');
		await input.fill('rgb(30, 144, 255)');

		await expect(page.getByTestId('color-result-hex')).toContainText('#1e90ff');
	});

	test('カラーピッカーの変更がテキスト出力に反映されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('color');
		await toolPage.goto();

		await page.getByLabel('カラーピッカー').fill('#ff0000');

		await expect(page.getByTestId('color-result-hex')).toContainText('#ff0000');
		await expect(page.getByTestId('color-result-rgb')).toContainText(
			'rgb(255, 0, 0)',
		);
	});

	test('不正な入力で例つきの日本語エラーが表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('color');
		await toolPage.goto();

		const input = page.getByLabel('カラーコード入力');
		await input.fill('');
		await input.fill('#GGG');

		const error = page.getByTestId('color-error');
		await expect(error).toBeVisible();
		await expect(error).toContainText('カラーコードを認識できません');
		await expect(error).toContainText('#1E90FF');
		await expect(error).toContainText('rgb(30, 144, 255)');
	});

	test('375px幅でレイアウトが崩れないこと', async ({
		page,
		createToolPage,
	}) => {
		await page.setViewportSize({ width: 375, height: 800 });
		const toolPage = createToolPage('color');
		await toolPage.goto();

		await expect(page.getByLabel('カラーコード入力')).toBeVisible();
		await expect(page.getByLabel('カラーピッカー')).toBeVisible();
		await expect(page.getByTestId('color-results')).toBeVisible();
	});

	test('1440px幅でレイアウトが崩れないこと', async ({
		page,
		createToolPage,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		const toolPage = createToolPage('color');
		await toolPage.goto();

		await expect(page.getByLabel('カラーコード入力')).toBeVisible();
		await expect(page.getByLabel('カラーピッカー')).toBeVisible();
		await expect(page.getByTestId('color-results')).toBeVisible();
	});
});
