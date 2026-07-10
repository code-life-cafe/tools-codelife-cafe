import { expect, test } from './fixtures/base';

test.describe('Text Diff', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const page = createToolPage('text-diff');
		await page.goto();
	});

	test('computes diff correctly', async ({ page }) => {
		const textboxes = page.getByRole('textbox');
		await textboxes.first().fill('hello\nworld');
		await textboxes.nth(1).fill('hello\nplaywright');

		// Check if diff summary appears
		await expect(page.getByText(/差分統計/i)).toBeVisible();
		await expect(page.getByText(/追加:\s*1行/)).toBeVisible();
		await expect(page.getByText(/削除:\s*1行/)).toBeVisible();
	});

	test('both textareas allow vertical resize with min/max height on desktop', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });

		for (const id of ['#text-diff-textarea-a', '#text-diff-textarea-b']) {
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

	test('both textareas disable resize on mobile viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });

		for (const id of ['#text-diff-textarea-a', '#text-diff-textarea-b']) {
			const resize = await page
				.locator(id)
				.evaluate((el) => getComputedStyle(el).resize);
			expect(resize).toBe('none');
		}
	});
});
