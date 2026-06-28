import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/base';
import { getCanvasPixel } from './helpers/canvas';

const RED = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'merge-red-120x80.png',
);
const BLUE = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'merge-blue-80x60.png',
);

const fileInput = (page: import('@playwright/test').Page) =>
	page.locator('input[type="file"]');

const previewCanvas = (page: import('@playwright/test').Page) =>
	page.getByTestId('merge-preview-canvas');

async function canvasSize(
	page: import('@playwright/test').Page,
): Promise<[number, number]> {
	return previewCanvas(page).evaluate((el) => {
		const c = el as HTMLCanvasElement;
		return [c.width, c.height];
	});
}

async function uploadAndWait(
	page: import('@playwright/test').Page,
	files: string | string[],
) {
	await fileInput(page).setInputFiles(files);
	// プレビューcanvasが描画される（width>0）まで待つ
	await expect.poll(async () => (await canvasSize(page))[0]).toBeGreaterThan(0);
}

test.describe('画像連結・コンタクトシート', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('image-merge');
		await toolPage.goto();
	});

	test('ページ表示とSafetyBadge・プライバシー注記', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('image-merge');
		await toolPage.expectTitle('画像の連結・結合');
		await toolPage.expectSafetyBadge();
		await expect(
			page
				.getByText('画像はサーバーに送信されません', { exact: false })
				.first(),
		).toBeVisible();
	});

	test('2枚投入→縦結合→ダウンロード（出力サイズ検証）', async ({ page }) => {
		await uploadAndWait(page, [RED, BLUE]);

		// デフォルト（縦・幅をそろえる・余白0）: 赤120x80 + 青を幅120へ拡大(120x90) = 120x170
		await expect.poll(async () => canvasSize(page)).toEqual([120, 170]);
		await expect(page.getByText('出力サイズ: 120×170px')).toBeVisible();

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: '結合画像をダウンロード' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('merged.png');

		const buf = fs.readFileSync(await download.path());
		// PNGシグネチャ
		expect(buf[0]).toBe(0x89);
		expect(buf[1]).toBe(0x50);
		// IHDR の幅・高さ（offset 16 / 20）
		expect(buf.readUInt32BE(16)).toBe(120);
		expect(buf.readUInt32BE(20)).toBe(170);
	});

	test('横結合・グリッド（列数2）が反映される', async ({ page }) => {
		await uploadAndWait(page, [RED, BLUE]);

		// 横に連結: 高さを最大(80)にそろえる。赤120x80 + 青(80x60→107x80) = 227x80
		await page.getByRole('combobox', { name: '結合モード' }).click();
		await page.getByRole('option', { name: '横に連結' }).click();
		await expect.poll(async () => canvasSize(page)).toEqual([227, 80]);

		// グリッド（列数2）: 統一幅120のセル2列1行 = 240x80
		await page.getByRole('combobox', { name: '結合モード' }).click();
		await page.getByRole('option', { name: 'グリッド' }).click();
		await expect(
			page.getByRole('spinbutton', { name: 'グリッド列数' }),
		).toHaveValue('2');
		await expect.poll(async () => canvasSize(page)).toEqual([240, 80]);
	});

	test('並び替えが結果に反映される', async ({ page }) => {
		await uploadAndWait(page, [RED, BLUE]);

		// 初期: 縦結合で上が赤
		await expect
			.poll(async () => getCanvasPixel(page, 'merge-preview-canvas', 60, 20))
			.toEqual([255, 0, 0, 255]);

		// 2枚目（青）を前へ移動 → 上が青になる
		await page.getByRole('button', { name: '2枚目を前へ移動' }).click();
		await expect
			.poll(async () => getCanvasPixel(page, 'merge-preview-canvas', 40, 20))
			.toEqual([0, 0, 255, 255]);
	});

	test('375px / 1440px でレスポンシブ表示される', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByText('画像をドラッグ＆ドロップ')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await uploadAndWait(page, [RED, BLUE]);
		await expect(previewCanvas(page)).toBeVisible();
	});
});
