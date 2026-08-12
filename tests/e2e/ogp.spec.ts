import { expect, test } from './fixtures/base';

test.describe('OGP画像生成 (/ogp)', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('ogp');
		await toolPage.goto();
	});

	test('ページ表示とSafetyBadge', async ({ createToolPage }) => {
		const toolPage = createToolPage('ogp');
		await toolPage.expectTitle('OGP画像ジェネレーター');
		await toolPage.expectSafetyBadge();
	});

	test('タイトル未入力時はダウンロード不可、入力でボタンが有効化', async ({
		page,
	}) => {
		const downloadBtn = page.getByRole('button', {
			name: /PNGダウンロード/,
		});
		// 初期状態（タイトル空）では無効化されていること
		await expect(downloadBtn).toBeDisabled();

		// タイトルを入力
		await page.locator('#ogp-title').fill('テストOGPタイトル');
		await expect(downloadBtn).toBeEnabled();

		// サブタイトルを入力
		await page.locator('#ogp-subtitle').fill('CODE:LIFE Tools');
		await expect(downloadBtn).toBeEnabled();
	});
});
