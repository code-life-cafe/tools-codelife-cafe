import { expect, test } from './fixtures/base';

test.describe('Personal Info Masking Tool', () => {
	test('should load the page correctly', async ({ createToolPage }) => {
		const toolPage = createToolPage('masking');
		await toolPage.goto();
		await toolPage.expectTitle('個人情報マスキング | CODE:LIFE Tools');
		await toolPage.expectSafetyBadge();
	});

	test('should mask personal information automatically', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('masking');
		await toolPage.goto();

		// 1. Fill personal info in the input textbox
		const textareas = page.getByRole('textbox');
		await textareas
			.first()
			.fill(
				'私のメールは test@example.com です。電話番号は 090-1234-5678 です。',
			);

		// 2. Check if output textbox contains masked values
		await expect(textareas.last()).toContainText('***');
		await expect(textareas.last()).not.toContainText('test@example.com');
		await expect(textareas.last()).not.toContainText('090-1234-5678');
	});

	test('input and output textareas allow vertical resize with min/max height on desktop', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('masking');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		for (const id of ['#masking-input-textarea', '#masking-output-textarea']) {
			const textarea = page.locator(id);
			const style = await textarea.evaluate((el) => {
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
		}
	});

	test('input and output textareas disable resize on mobile viewport', async ({
		page,
		createToolPage,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const toolPage = createToolPage('masking');
		await toolPage.goto();

		for (const id of ['#masking-input-textarea', '#masking-output-textarea']) {
			const resize = await page
				.locator(id)
				.evaluate((el) => getComputedStyle(el).resize);
			expect(resize).toBe('none');
		}
	});

	test('input textarea keeps a fixed height on mobile even with long content', async ({
		page,
		createToolPage,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const toolPage = createToolPage('masking');
		await toolPage.goto();

		const textarea = page.locator('#masking-input-textarea');
		const heightBefore = await textarea.evaluate((el) => el.clientHeight);

		await textarea.fill(
			Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n'),
		);

		const heightAfter = await textarea.evaluate((el) => el.clientHeight);
		expect(heightAfter).toBe(heightBefore);
	});
});
