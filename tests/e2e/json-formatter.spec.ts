import { expect, test } from './fixtures/base';

test.describe('JSON Formatter', () => {
	test('loads page and shows format UI', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();

		// Verify key UI elements are present
		await expect(page.getByRole('textbox').first()).toBeVisible();
		await expect(page.getByRole('button', { name: /整形/ })).toBeVisible();
	});

	test('should format valid JSON and show error for invalid JSON', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();

		// 1. Input valid JSON
		const inputArea = page.getByRole('textbox').first();
		await inputArea.fill('{"a":1,"b":"hello"}');

		// Verify output is formatted (should contain newline and indentation)
		const outputContainer = page.locator('pre');
		await expect(outputContainer).toContainText('"a": 1');
		await expect(outputContainer).toContainText('"b": "hello"');

		// 2. Input invalid JSON
		await inputArea.fill('{"a":1');

		// Verify error banner is visible
		const errorBanner = page.locator('.bg-destructive\\/10');
		await expect(errorBanner).toBeVisible();
		await expect(errorBanner).toContainText('エラー');
	});

	test('input textarea allows vertical resize with min/max height on desktop', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		const inputArea = page.locator('#json-input-textarea');
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
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await page.setViewportSize({ width: 390, height: 844 });
		await toolPage.goto();

		const inputArea = page.locator('#json-input-textarea');
		const resize = await inputArea.evaluate(
			(el) => getComputedStyle(el).resize,
		);
		expect(resize).toBe('none');
	});
});
