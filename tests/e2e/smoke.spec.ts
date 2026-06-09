import { toolSlugs } from '../../src/lib/tools/catalog';
import { expect, test } from './fixtures/base';

test.describe('Smoke Tests - Tools', () => {
	for (const toolSlug of toolSlugs) {
		test(`Tool page /${toolSlug} should load and show safety badge`, async ({
			page,
			createToolPage,
		}) => {
			const response = await page.goto(`/${toolSlug}`);
			expect(response?.status()).toBe(200);

			const toolPage = createToolPage(toolSlug);
			await toolPage.expectSafetyBadge();
		});
	}

	test('Top page should load successfully', async ({ page }) => {
		const response = await page.goto('/');
		expect(response?.status()).toBe(200);
		await expect(page).toHaveTitle(/CODE:LIFE/i);
	});
});
