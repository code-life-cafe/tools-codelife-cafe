import path from 'node:path';
import { expect, test } from './fixtures/base';

const FIX = (name: string) =>
	path.join(process.cwd(), 'tests', 'e2e', 'fixtures', name);

const PNG = FIX('sample-400x300.png');

test.describe('画像 Base64 / Data URI 変換', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('image-base64');
		await toolPage.goto();
	});

	test('ページ表示とSafetyBadge', async ({ createToolPage }) => {
		const toolPage = createToolPage('image-base64');
		await toolPage.expectTitle('画像 Base64 / Data URI 変換');
		await toolPage.expectSafetyBadge();
	});

	test('画像投入 → Data URIスニペットが表示される', async ({ page }) => {
		await page.getByTestId('encode-file-input').setInputFiles(PNG);

		const results = page.getByTestId('snippet-results');
		await expect(results).toBeVisible({ timeout: 10_000 });

		const dataUriSnippet = page.getByTestId('snippet-data-uri');
		await expect(dataUriSnippet).toBeVisible();
		await expect(dataUriSnippet).toContainText('data:image/png;base64,');

		const imgSnippet = page.getByTestId('snippet-img');
		await expect(imgSnippet).toBeVisible();
		await expect(imgSnippet).toContainText('<img src=');

		const cssSnippet = page.getByTestId('snippet-css-bg');
		await expect(cssSnippet).toBeVisible();
		await expect(cssSnippet).toContainText('background-image: url(');
	});

	test('サイズ情報と肥大率が表示される', async ({ page }) => {
		await page.getByTestId('encode-file-input').setInputFiles(PNG);

		await expect(page.getByTestId('snippet-results')).toBeVisible({
			timeout: 10_000,
		});

		await expect(page.getByText('元サイズ:')).toBeVisible();
		await expect(page.getByText('Base64:')).toBeVisible();
		await expect(page.getByText('肥大率:')).toBeVisible();
	});

	test('コピーボタンで表示が「コピー済み」に変わる', async ({ page }) => {
		await page.getByTestId('encode-file-input').setInputFiles(PNG);

		await expect(page.getByTestId('snippet-results')).toBeVisible({
			timeout: 10_000,
		});

		const copyBtn = page
			.getByTestId('snippet-data-uri')
			.getByRole('button', { name: /コピー/ });
		await copyBtn.click();
		await expect(
			page
				.getByTestId('snippet-data-uri')
				.getByRole('button', { name: 'コピーしました' }),
		).toBeVisible();
	});

	test('Base64貼り付け → プレビュー表示 → ダウンロード', async ({ page }) => {
		await page.getByTestId('tab-decode').click();

		const b64 =
			'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
		await page.getByTestId('decode-input').fill(b64);

		const preview = page.getByTestId('decode-preview');
		await expect(preview).toBeVisible({ timeout: 5_000 });

		const downloadBtn = page.getByTestId('decode-download');
		await expect(downloadBtn).toBeVisible();

		const downloadPromise = page.waitForEvent('download');
		await downloadBtn.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('decoded.png');
	});

	test('不正なBase64でエラー表示', async ({ page }) => {
		await page.getByTestId('tab-decode').click();
		await page.getByTestId('decode-input').fill('this-is-not-valid-base64!!!');

		const error = page.getByTestId('decode-error');
		await expect(error).toBeVisible({ timeout: 5_000 });
	});

	test('レスポンシブ表示（375px / 1440px）', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByTestId('tab-encode')).toBeVisible();
		await expect(page.getByTestId('tab-decode')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByTestId('tab-encode')).toBeVisible();
		await expect(page.getByTestId('tab-decode')).toBeVisible();
	});

	test('画像アップロード時にネットワークリクエストが飛ばない', async ({
		page,
	}) => {
		const requests: string[] = [];
		page.on('request', (req) => {
			const url = req.url();
			if (
				!url.startsWith('data:') &&
				!url.includes('localhost') &&
				!url.includes('127.0.0.1') &&
				!url.includes('fonts.gstatic.com') &&
				!url.includes('fonts.googleapis.com')
			) {
				requests.push(url);
			}
		});

		await page.getByTestId('encode-file-input').setInputFiles(PNG);
		await expect(page.getByTestId('snippet-results')).toBeVisible({
			timeout: 10_000,
		});

		expect(requests).toEqual([]);
	});
});
