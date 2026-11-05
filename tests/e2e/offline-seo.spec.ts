import { expect, test } from './fixtures/base.ts';

test('オフライン案内ページの head に noindex が出力される', async ({
	page,
}) => {
	const response = await page.goto('/offline/');
	expect(response?.status()).toBe(200);
	const robots = page.locator('head meta[name="robots"]');
	await expect(robots).toHaveCount(1);
	await expect(robots).toHaveAttribute('content', 'noindex');
	await expect(
		page.getByRole('heading', { level: 1, name: 'オフライン状態です' }),
	).toBeVisible();
	await expect(
		page.getByRole('link', { name: 'トップページへ', exact: true }),
	).toHaveAttribute('href', '/');
});

test('通常のツールページは noindex にならない', async ({ page }) => {
	const response = await page.goto('/transcribe/');
	expect(response?.status()).toBe(200);
	await expect(
		page.locator('head meta[name="robots"][content*="noindex"]'),
	).toHaveCount(0);
});
