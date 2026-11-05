import fs from 'node:fs';
import {
	defaultOptions,
	generateQRSvg,
} from '../../src/lib/tools/qr-generator.ts';
import { expect, test } from './fixtures/base.ts';

test.describe('QR Generator', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const page = createToolPage('qr-generator');
		await page.goto();
	});

	test('generates QR code from text', async ({ page }) => {
		const input = page.getByRole('textbox').first();
		await input.fill('https://example.com');

		// Check if QR image is generated
		const qrImage = page.getByRole('img', { name: /QRコード/i });
		await expect(qrImage).toBeVisible();

		// Check download buttons
		await expect(
			page.getByRole('button', { name: /PNG ダウンロード/i }),
		).toBeEnabled();
	});

	test('容量超過で旧QRとPNG/SVG保存を無効にし、短い入力で復帰する', async ({
		page,
	}) => {
		const input = page.getByRole('textbox').first();
		const preview = page.getByRole('img', { name: 'QRコード', exact: true });
		const png = page.getByRole('button', { name: 'PNG ダウンロード' });
		const svg = page.getByRole('button', { name: 'SVG ダウンロード' });
		await input.fill('最初の入力');
		await expect(preview).toBeVisible();
		await expect(png).toBeEnabled();
		await expect(svg).toBeEnabled();
		await input.fill('x'.repeat(5000));
		await expect(page.getByRole('alert')).toContainText('短く');
		await expect(preview).toHaveCount(0);
		await expect(png).toBeDisabled();
		await expect(svg).toBeDisabled();

		await input.fill('復帰後の入力');
		await expect(preview).toBeVisible();
		await expect(page.getByRole('alert')).toHaveCount(0);
		await expect(png).toBeEnabled();
		await expect(svg).toBeEnabled();
		const downloadPromise = page.waitForEvent('download');
		await svg.click();
		const download = await downloadPromise;
		expect(fs.readFileSync(await download.path(), 'utf8')).toBe(
			await generateQRSvg('復帰後の入力'),
		);
	});

	test('入力を連続変更しても最後の入力の結果だけを保存でき、空欄でも旧QRを残さない', async ({
		page,
	}) => {
		const input = page.getByRole('textbox').first();
		const preview = page.getByRole('img', { name: 'QRコード', exact: true });
		await input.fill('変更前');
		await expect(preview).toBeVisible();
		await input.fill('x'.repeat(5000));
		await input.fill('途中の入力');
		await input.fill('x'.repeat(5000));
		await expect(page.getByRole('alert')).toContainText('短く');
		await expect(preview).toHaveCount(0);
		await input.fill('最後の入力');
		await expect(preview).toBeVisible();
		await expect(page.getByRole('alert')).toHaveCount(0);
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'SVG ダウンロード' }).click();
		const download = await downloadPromise;
		expect(fs.readFileSync(await download.path(), 'utf8')).toBe(
			await generateQRSvg('最後の入力'),
		);
		await input.fill('');
		await expect(preview).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'PNG ダウンロード' }),
		).toBeDisabled();
		await expect(
			page.getByRole('button', { name: 'SVG ダウンロード' }),
		).toBeDisabled();
	});

	test('訂正レベルを上げて容量超過になった場合も無効にし、戻すと再生成する', async ({
		page,
	}) => {
		// 小文字はバイトモード: 1500バイトはMでは収まり、Hでは容量を超える。
		const text = 'x'.repeat(1500);
		await page.getByRole('textbox').first().fill(text);
		await expect(
			page.getByRole('img', { name: 'QRコード', exact: true }),
		).toBeVisible();
		await page.getByRole('combobox').nth(1).click();
		await page.getByRole('option', { name: 'H（高）', exact: true }).click();
		await expect(page.getByRole('alert')).toContainText('短く');
		await expect(
			page.getByRole('img', { name: 'QRコード', exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'PNG ダウンロード' }),
		).toBeDisabled();
		await expect(
			page.getByRole('button', { name: 'SVG ダウンロード' }),
		).toBeDisabled();
		await page.getByRole('combobox').nth(1).click();
		await page.getByRole('option', { name: 'M（中）', exact: true }).click();
		await expect(
			page.getByRole('img', { name: 'QRコード', exact: true }),
		).toBeVisible();
		await expect(page.getByRole('alert')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'PNG ダウンロード' }),
		).toBeEnabled();
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'SVG ダウンロード' }).click();
		const download = await downloadPromise;
		expect(fs.readFileSync(await download.path(), 'utf8')).toBe(
			await generateQRSvg(text, defaultOptions),
		);
	});
});
