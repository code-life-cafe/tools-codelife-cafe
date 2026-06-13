import { expect, test } from './fixtures/base';

test.describe('404ページ', () => {
	test('存在しないURLで404ページの内容が表示される', async ({ page }) => {
		const response = await page.goto('/this-page-does-not-exist');

		// プレビューサーバーは dist/404.html を404ステータスで返す
		expect(response?.status()).toBe(404);

		await expect(
			page.getByRole('heading', { name: 'ページが見つかりません' }),
		).toBeVisible();

		// noindex メタが付与されている
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
			'content',
			'noindex',
		);
	});

	test('トップページへのリンクと人気ツールへのリンクが機能する', async ({
		page,
	}) => {
		await page.goto('/this-page-does-not-exist');

		// 人気ツールのリンクが表示されている
		await expect(page.getByRole('link', { name: /JSON整形/ })).toBeVisible();

		// トップページへのリンクで回遊できる
		await page.getByRole('link', { name: 'トップページへ' }).click();
		await expect(page).toHaveURL(/\/$/);
	});

	test('検索ボタンで検索モーダルが開く', async ({ page }) => {
		await page.goto('/this-page-does-not-exist');

		await page.locator('#not-found-search').click();
		await expect(
			page.getByPlaceholder('ツールを検索... (Enterで移動)'),
		).toBeVisible();
	});
});
