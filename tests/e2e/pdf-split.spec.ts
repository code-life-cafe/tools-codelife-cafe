import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { expect, test } from './fixtures/base';

const FIXTURES = path.join(process.cwd(), 'tests', 'e2e', 'fixtures');
const PDF_5PAGES = path.join(FIXTURES, 'sample-5pages.pdf');
const ENCRYPTED = path.join(FIXTURES, 'encrypted.pdf');

const fileInput = (page: import('@playwright/test').Page) =>
	page.locator('input[type="file"]');

/** PDFを投入してページ数表示（読み込み完了）を待つ */
async function uploadPdf(page: import('@playwright/test').Page) {
	await fileInput(page).setInputFiles(PDF_5PAGES);
	await expect(page.getByTestId('pdf-page-count')).toContainText('全5ページ');
}

/** ZIPバイナリの PK シグネチャと EOCD のエントリ数を検証する */
function expectZipEntries(buf: Buffer, expected: number) {
	expect(buf[0]).toBe(0x50); // P
	expect(buf[1]).toBe(0x4b); // K
	const eocd = buf.length - 22;
	expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
	expect(buf.readUInt16LE(eocd + 10)).toBe(expected);
}

test.describe('PDF分割・ページ抽出', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('pdf-split');
		await toolPage.goto();
	});

	test('ページ表示とSafetyBadge・プライバシー注記', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('pdf-split');
		await toolPage.expectTitle('PDF分割');
		await toolPage.expectSafetyBadge();
		await expect(
			page.getByText('PDFはサーバーに送信されません', { exact: false }).first(),
		).toBeVisible();
	});

	test('範囲で分割: 1-2,4-5 で2ファイルのZIPがダウンロードされる', async ({
		page,
	}) => {
		await uploadPdf(page);
		await page.getByLabel('分割範囲').fill('1-2,4-5');
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: '分割してダウンロード' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('sample-5pages_split.zip');
		const buf = fs.readFileSync(await download.path());
		expectZipEntries(buf, 2);

		// 個別ダウンロードリンクも一覧表示され、ページ数が範囲と一致する
		await expect(page.getByTestId('split-results')).toBeVisible();
		const itemDownload = page.waitForEvent('download');
		await page
			.getByRole('button', { name: 'sample-5pages_p1-2.pdf をダウンロード' })
			.click();
		const item = await itemDownload;
		const pdf = await PDFDocument.load(
			new Uint8Array(fs.readFileSync(await item.path())),
		);
		expect(pdf.getPageCount()).toBe(2);
	});

	test('ページ抽出: 2,4 で2ページの単一PDFがダウンロードされる', async ({
		page,
	}) => {
		await uploadPdf(page);
		await page.getByRole('tab', { name: 'ページ抽出' }).click();
		await page.getByLabel('抽出ページ').fill('2,4');
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: '抽出してダウンロード' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('sample-5pages_extract.pdf');
		const pdf = await PDFDocument.load(
			new Uint8Array(fs.readFileSync(await download.path())),
		);
		expect(pdf.getPageCount()).toBe(2);
	});

	test('1ページずつ分割: 5ファイルのZIPがダウンロードされる', async ({
		page,
	}) => {
		await uploadPdf(page);
		await page.getByRole('tab', { name: '1ページずつ分割' }).click();
		const downloadPromise = page.waitForEvent('download');
		await page
			.getByRole('button', { name: '1ページずつ分割してダウンロード' })
			.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('sample-5pages_split.zip');
		const buf = fs.readFileSync(await download.path());
		expectZipEntries(buf, 5);
	});

	test('不正範囲（0-2）で日本語エラーが表示され実行ボタンが無効になる', async ({
		page,
	}) => {
		await uploadPdf(page);
		await page.getByLabel('分割範囲').fill('0-2');
		await expect(page.getByTestId('range-errors')).toContainText(
			'1以上で指定してください',
		);
		await expect(
			page.getByRole('button', { name: '分割してダウンロード' }),
		).toBeDisabled();
	});

	test('不正範囲（9-、5ページPDF）で日本語エラーが表示される', async ({
		page,
	}) => {
		await uploadPdf(page);
		await page.getByLabel('分割範囲').fill('9-');
		await expect(page.getByTestId('range-errors')).toContainText(
			'このPDFは全5ページです',
		);
		await expect(
			page.getByRole('button', { name: '分割してダウンロード' }),
		).toBeDisabled();
	});

	test('暗号化PDFで日本語エラーが表示される', async ({ page }) => {
		await fileInput(page).setInputFiles(ENCRYPTED);
		await expect(
			page.getByText('パスワード付きPDFには対応していません', {
				exact: false,
			}),
		).toBeVisible();
	});

	test('375px / 1440px でレスポンシブ表示される', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByText('PDFをドラッグ＆ドロップ')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await uploadPdf(page);
		await expect(page.getByRole('tab', { name: '範囲で分割' })).toBeVisible();
	});
});
