import { expect, test } from './fixtures/base';

const section = (page: import('@playwright/test').Page) =>
	page.locator('section[aria-labelledby="related-tools-heading"]');

test.describe('関連ツール 回遊カード', () => {
	test('related 指定ツールは指定先のカードを表示する', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('base64');
		await toolPage.goto();

		const related = section(page);
		await expect(
			related.getByRole('heading', { name: '関連ツール' }),
		).toBeVisible();
		// base64.related = url-encoder / cipher / unicode-converter
		await expect(related.locator('a[href="/url-encoder"]')).toHaveCount(1);
		await expect(related.locator('a[href="/cipher"]')).toHaveCount(1);
		await expect(related.locator('a[href="/unicode-converter"]')).toHaveCount(
			1,
		);
		// 自分自身へのリンクは出ない
		await expect(related.locator('a[href="/base64"]')).toHaveCount(0);
	});

	test('related 未指定ツールは同カテゴリで補完表示する', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('char-count');
		await toolPage.goto();

		const related = section(page);
		await expect(
			related.getByRole('heading', { name: '関連ツール' }),
		).toBeVisible();
		// テキスト解析カテゴリの他ツール（text-diff）が補完される
		await expect(related.locator('a[href="/text-diff"]')).toHaveCount(1);
		await expect(related.locator('a[href="/char-count"]')).toHaveCount(0);
	});

	test('カードから関連ツールへ遷移できる', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('base64');
		await toolPage.goto();

		await section(page).locator('a[href="/url-encoder"]').click();
		await expect(page).toHaveURL(/\/url-encoder$/);
	});
});
