import path from 'node:path';
import { expect, test } from './fixtures/base';

const FIX = (name: string) =>
	path.join(process.cwd(), 'tests', 'e2e', 'fixtures', name);

const EXIF_JPG = FIX('convert-exif.jpg');

test.describe('EXIF メタデータ閲覧・削除 (/exif)', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('exif');
		await toolPage.goto();
	});

	test('ページ表示とSafetyBadge', async ({ createToolPage }) => {
		const toolPage = createToolPage('exif');
		await toolPage.expectTitle('EXIF確認・削除');
		await toolPage.expectSafetyBadge();
	});

	test('画像アップロード → EXIF表示 → 削除ボタン有効化', async ({ page }) => {
		const fileInput = page.getByTestId('exif-input');
		await fileInput.setInputFiles(EXIF_JPG);

		// ストリップボタンが表示されること
		const stripBtn = page.getByTestId('strip-button');
		await expect(stripBtn).toBeVisible({ timeout: 10_000 });
		await expect(stripBtn).toBeEnabled();

		// クリアボタンが機能すること
		await page.getByRole('button', { name: 'クリア' }).click();
		await expect(stripBtn).not.toBeVisible();
	});
});
