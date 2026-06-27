import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/base';

test.describe('ワードクラウド生成 Tool', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('wordcloud');
		await toolPage.goto();
		await toolPage.expectTitle('ワードクラウド生成');
		await toolPage.expectSafetyBadge();
	});

	test('テキスト入力からワードクラウドおよび頻度表が可視化されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wordcloud');
		await toolPage.goto();

		const input = page.getByLabel('解析対象テキスト');
		await input.fill('吾輩は猫である。名前はまだ無い。名前は猫である。');

		// 解析結果が表示されるまで待機（テーブル内の「猫」と「名前」が存在すること）
		await expect(page.getByRole('table')).toContainText('猫');
		await expect(page.getByRole('table')).toContainText('名前');
	});

	test('CSV / SVG / PNG エクスポートボタンが正常に動作すること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wordcloud');
		await toolPage.goto();

		const input = page.getByLabel('解析対象テキスト');
		await input.fill('吾輩は猫である。名前はまだ無い。吾輩は猫である。');

		await expect(page.getByRole('table')).toContainText('猫');

		// CSVダウンロード検証
		const csvDownloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'CSV ダウンロード' }).click();
		const csvDownload = await csvDownloadPromise;
		expect(csvDownload.suggestedFilename()).toMatch(/^wordcloud-.*\.csv$/);

		const csvPath = path.join(os.tmpdir(), `test-${Date.now()}.csv`);
		await csvDownload.saveAs(csvPath);
		const csvContent = fs.readFileSync(csvPath, 'utf-8');
		expect(csvContent.startsWith('\uFEFF')).toBe(true);
		expect(csvContent).toContain('順位,単語,品詞,出現回数');
		fs.unlinkSync(csvPath);

		// SVGダウンロード検証
		const svgDownloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'SVG ダウンロード' }).click();
		const svgDownload = await svgDownloadPromise;
		expect(svgDownload.suggestedFilename()).toMatch(/^wordcloud-.*\.svg$/);

		const svgPath = path.join(os.tmpdir(), `test-${Date.now()}.svg`);
		await svgDownload.saveAs(svgPath);
		const svgContent = fs.readFileSync(svgPath, 'utf-8');
		expect(svgContent).toContain('<svg');
		fs.unlinkSync(svgPath);
	});

	test('レスポンシブ表示（375px / 1440px）', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wordcloud');
		await toolPage.goto();

		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByLabel('解析対象テキスト')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByLabel('解析対象テキスト')).toBeVisible();
	});
});
