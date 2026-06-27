import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/base';

const SAMPLE = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'sample-400x300.png',
);

const fileInput = (page: import('@playwright/test').Page) =>
	page.locator('input[type="file"]');

test.describe('画像メタデータ削除', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('image-metadata');
		await toolPage.goto();
	});

	test('ページ表示とSafetyBadge・プライバシー注記', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('image-metadata');
		await toolPage.expectTitle('画像メタデータ削除');
		await toolPage.expectSafetyBadge();
		await expect(
			page.getByText('ファイルはサーバーへ送信されません', { exact: false }),
		).toBeVisible();
	});

	test('PNGアップロード後にメタデータ削除結果をダウンロードできる', async ({
		page,
	}) => {
		await fileInput(page).setInputFiles(SAMPLE);
		await page.getByRole('button', { name: 'メタデータを削除' }).click();
		await expect(page.getByText('出力:', { exact: false })).toBeVisible();

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('link', { name: '個別ダウンロード' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe(
			'sample-400x300-metadata-removed.png',
		);
		const buf = fs.readFileSync(await download.path());
		expect(buf[0]).toBe(0x89);
		expect(buf[1]).toBe(0x50);
	});

	test('非対応形式は日本語エラーになる', async ({ page }) => {
		await fileInput(page).setInputFiles({
			name: 'anim.gif',
			mimeType: 'image/gif',
			buffer: Buffer.from('GIF89a fake'),
		});
		await expect(page.getByRole('alert')).toContainText('JPEG・PNG・WebP');
	});
});
