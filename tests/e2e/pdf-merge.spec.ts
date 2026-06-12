import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { expect, test } from './fixtures/base';

const FIXTURES = path.join(process.cwd(), 'tests', 'e2e', 'fixtures');
const PDF_3PAGES = path.join(FIXTURES, 'sample-3pages.pdf'); // 300x200pt
const PDF_5PAGES = path.join(FIXTURES, 'sample-5pages.pdf'); // 400x300pt
const PNG_SAMPLE = path.join(FIXTURES, 'sample-400x300.png');
const ENCRYPTED = path.join(FIXTURES, 'encrypted.pdf');
const TXT_SAMPLE = path.join(FIXTURES, 'hash-sample.txt');

const fileInput = (page: import('@playwright/test').Page) =>
	page.locator('input[type="file"]');

const mergeButton = (page: import('@playwright/test').Page) =>
	page.getByRole('button', { name: '結合してダウンロード' });

/** ファイル投入後、PDFのページ数表示（読み込み完了）を待つ */
async function uploadAndWait(
	page: import('@playwright/test').Page,
	files: string[],
	expectedReadyRows: number,
) {
	await fileInput(page).setInputFiles(files);
	await expect(page.getByTestId('merge-file-row')).toHaveCount(files.length);
	// ページ数（例: 3ページ）が出る = loadPdfInfo 完了
	await expect(
		page.getByTestId('merge-file-row').filter({ hasText: /\dページ/ }),
	).toHaveCount(expectedReadyRows);
}

/** ダウンロードされた merged.pdf を pdf-lib で開いて返す */
async function downloadMerged(page: import('@playwright/test').Page) {
	const downloadPromise = page.waitForEvent('download');
	await mergeButton(page).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('merged.pdf');
	const buf = fs.readFileSync(await download.path());
	return PDFDocument.load(new Uint8Array(buf));
}

test.describe('PDF結合', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('pdf-merge');
		await toolPage.goto();
	});

	test('ページ表示とSafetyBadge・プライバシー注記', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('pdf-merge');
		await toolPage.expectTitle('PDF結合');
		await toolPage.expectSafetyBadge();
		await expect(
			page
				.getByText('PDFや画像はサーバーに送信されません', { exact: false })
				.first(),
		).toBeVisible();
	});

	test('PDF 2つを結合するとページ数が合計と一致する', async ({ page }) => {
		await uploadAndWait(page, [PDF_3PAGES, PDF_5PAGES], 2);
		const merged = await downloadMerged(page);
		expect(merged.getPageCount()).toBe(8);
		// 既定順: 3ページPDF（300x200）が先頭
		const first = merged.getPage(0).getSize();
		expect(Math.round(first.width)).toBe(300);
		expect(Math.round(first.height)).toBe(200);
		// 結果パネルにページ数・サイズが表示される
		await expect(page.getByTestId('merge-result')).toContainText('8ページ');
	});

	test('並べ替え（2番目を先頭へ）が結合順に反映される', async ({ page }) => {
		await uploadAndWait(page, [PDF_3PAGES, PDF_5PAGES], 2);
		await page
			.getByRole('button', { name: 'sample-5pages.pdf を上へ移動' })
			.click();
		const merged = await downloadMerged(page);
		expect(merged.getPageCount()).toBe(8);
		// 並べ替え後: 5ページPDF（400x300）が先頭
		const first = merged.getPage(0).getSize();
		expect(Math.round(first.width)).toBe(400);
		expect(Math.round(first.height)).toBe(300);
	});

	test('PDF + PNG の混在結合で画像が1ページとして挿入される', async ({
		page,
	}) => {
		await uploadAndWait(page, [PDF_3PAGES, PNG_SAMPLE], 1);
		const merged = await downloadMerged(page);
		expect(merged.getPageCount()).toBe(4);
		// 画像ページは 96dpi 換算: 400px → 300pt, 300px → 225pt
		const imagePage = merged.getPage(3).getSize();
		expect(Math.round(imagePage.width)).toBe(300);
		expect(Math.round(imagePage.height)).toBe(225);
	});

	test('暗号化PDFは行内エラーで除外され、他ファイルの結合は継続する', async ({
		page,
	}) => {
		await uploadAndWait(page, [PDF_3PAGES, PDF_5PAGES, ENCRYPTED], 2);
		// 行内に日本語エラーが表示される
		await expect(
			page.getByText('パスワード付きPDFには対応していません', {
				exact: false,
			}),
		).toBeVisible();
		// 残り2ファイルで結合できる
		const merged = await downloadMerged(page);
		expect(merged.getPageCount()).toBe(8);
	});

	test('非対応ファイル（.txt）で日本語エラーが表示される', async ({ page }) => {
		await fileInput(page).setInputFiles([TXT_SAMPLE]);
		await expect(
			page.getByText('対応していない形式です', { exact: false }),
		).toBeVisible();
		await expect(page.getByTestId('merge-file-row')).toHaveCount(0);
	});

	test('1ファイル（PDFのみ）では結合ボタンが無効になる', async ({ page }) => {
		await uploadAndWait(page, [PDF_3PAGES], 1);
		await expect(mergeButton(page)).toBeDisabled();
	});

	test('削除ボタンでファイルを個別に取り除ける', async ({ page }) => {
		await uploadAndWait(page, [PDF_3PAGES, PDF_5PAGES], 2);
		await page
			.getByRole('button', { name: 'sample-3pages.pdf を削除' })
			.click();
		await expect(page.getByTestId('merge-file-row')).toHaveCount(1);
	});

	test('375px / 1440px でレスポンシブ表示される', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByText('PDF・画像をドラッグ＆ドロップ')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await uploadAndWait(page, [PDF_3PAGES, PDF_5PAGES], 2);
		await expect(page.getByTestId('merge-file-list')).toBeVisible();
	});
});
