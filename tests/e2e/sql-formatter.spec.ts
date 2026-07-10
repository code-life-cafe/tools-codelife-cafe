import { expect, test } from './fixtures/base';

test.describe('SQL Formatter Tool', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('sql-formatter');
		await toolPage.goto();
	});

	test('should load the page correctly', async ({ page }) => {
		await expect(page).toHaveTitle('SQL整形・フォーマッター | CODE:LIFE Tools');
		await expect(
			page.getByRole('heading', { name: 'SQL整形・フォーマッター' }),
		).toBeVisible();
	});

	test('should format SQL with default options (2 spaces, uppercase)', async ({
		page,
	}) => {
		const input = 'select id, name from users where status = 1';
		await page.locator('textarea').fill(input);

		await expect(page.locator('.shimmer code')).toContainText(
			'SELECT\n  id,\n  name\nFROM\n  users\nWHERE\n  status = 1',
		);
	});

	test('should disable uppercase when toggled off', async ({ page }) => {
		const input = 'select id from test';
		await page.locator('textarea').fill(input);

		// wait for format
		await expect(page.locator('.shimmer code')).toContainText(
			'SELECT\n  id\nFROM\n  test',
		);

		// Toggle uppercase off
		await page.getByLabel('大文字化').click();

		await expect(page.locator('.shimmer code')).toContainText(
			'select\n  id\nfrom\n  test',
		);
	});

	test('should compress SQL to a single line', async ({ page }) => {
		const input = 'SELECT\n  id,\n  name\nFROM\n  users\nWHERE\n  status = 1;';
		await page.locator('textarea').fill(input);

		// wait for format
		await expect(page.locator('.shimmer code')).toContainText('SELECT');

		// Toggle compress on
		await page.getByLabel('圧縮 (1行化)').click();

		// Inner text of compressed should be single line
		await expect(page.locator('.shimmer code')).toContainText(
			'SELECT id, name FROM users WHERE status = 1;',
		);
	});

	test('should handle different dialects and indents', async ({ page }) => {
		await page
			.locator('textarea')
			.fill('SELECT * FROM users LIMIT 10 OFFSET 0');
		await expect(page.locator('.shimmer code')).toContainText(
			'SELECT\n  *\nFROM\n  users',
		);

		// Change dialect to PostgreSQL
		await page.getByRole('combobox').first().click();
		await page.getByRole('option', { name: 'PostgreSQL' }).click();

		// Change indent to Tabs
		await page.getByRole('combobox').nth(1).click();
		await page.getByRole('option', { name: 'Tabs' }).click();

		await expect(page.locator('.shimmer code')).toContainText(
			'SELECT\n\t*\nFROM\n\tusers',
		);
	});

	test('should clear the input when clear button is clicked', async ({
		page,
	}) => {
		await page.locator('textarea').fill('SELECT * FROM users');
		await expect(page.locator('.shimmer code')).toBeVisible();

		// Click clear
		await page.getByRole('button', { name: 'クリア' }).click();

		// Check if textarea is empty
		await expect(page.locator('textarea')).toBeEmpty();

		// Check if output is back to placeholder text
		await expect(
			page.getByText('左側（または上）にSQLを入力すると'),
		).toBeVisible();
	});

	test('input textarea allows vertical resize with min/max height on desktop', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });

		const inputArea = page.locator('textarea');
		const style = await inputArea.evaluate((el) => {
			const computed = getComputedStyle(el);
			return {
				resize: computed.resize,
				minHeight: computed.minHeight,
				maxHeight: computed.maxHeight,
			};
		});

		expect(style.resize).toBe('vertical');
		expect(style.minHeight).toBe('240px');
		// 80dvh はビューポート高さ 900px の80% = 720px
		expect(style.maxHeight).toBe('720px');
	});

	test('input textarea disables resize on mobile viewport', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });

		const inputArea = page.locator('textarea');
		const resize = await inputArea.evaluate(
			(el) => getComputedStyle(el).resize,
		);
		expect(resize).toBe('none');
	});

	test('restores full-size layout from a shared settings URL', async ({
		page,
		context,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);

		const container = page.locator('#tool-layout-container');
		await expect(container).not.toHaveClass(/max-w-full/);

		// Enable full-size mode and copy the share URL
		await page.getByRole('button', { name: 'フルサイズ' }).click();
		await expect(container).toHaveClass(/max-w-full/);

		await page.getByRole('button', { name: '設定を共有' }).click();
		const shareUrl = await page.evaluate(() => navigator.clipboard.readText());

		// Open the shared URL in a fresh page and confirm full-size is restored
		const newPage = await context.newPage();
		await newPage.goto(shareUrl);
		await expect(newPage.locator('#tool-layout-container')).toHaveClass(
			/max-w-full/,
		);
		await newPage.close();
	});
});
