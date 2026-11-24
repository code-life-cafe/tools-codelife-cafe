import path from 'node:path';
import sharp from 'sharp';
import type { GrayImage } from '../../src/lib/tools/qr-restore';
import { DAMAGED_QR_TEXT, lowContrastNoisyQr } from '../helpers/qr-damage';
import { expect, test } from './fixtures/base';

async function toPng(image: GrayImage): Promise<Buffer> {
	return sharp(Buffer.from(image.data), {
		raw: { width: image.width, height: image.height, channels: 1 },
	})
		.png()
		.toBuffer();
}

const NOT_A_QR = path.join(
	import.meta.dirname,
	'fixtures',
	'qr-reader',
	'not-a-qr.png',
);

test.describe('QRコード復元', () => {
	test('ページを表示し、画像は送信しない旨を示す', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('qr-restore').goto();
		await expect(page.locator('h1')).toContainText('QRコード復元');
		await expect(
			page.getByText('画像はサーバーに送信されません。').first(),
		).toBeVisible();
	});

	test('低コントラスト＋ノイズのQRを補正して読み取り、手法と補正後の画像を表示する', async ({
		page,
		createToolPage,
	}) => {
		const bodies: string[] = [];
		const externalRequests: string[] = [];
		await page.route('**/api/event', async (route) => {
			bodies.push(route.request().postData() ?? '');
			await route.fulfill({ status: 204 });
		});
		await createToolPage('qr-restore').goto();
		const origin = new URL(page.url()).origin;
		page.on('request', (req) => {
			const url = req.url();
			if (!url.startsWith(origin) && !url.startsWith('data:')) {
				externalRequests.push(url);
			}
		});

		await page.locator('input[type="file"]').setInputFiles({
			name: 'damaged-qr.png',
			mimeType: 'image/png',
			buffer: await toPng(lowContrastNoisyQr()),
		});

		const success = page.getByTestId('qr-restore-success');
		await expect(success).toBeVisible({ timeout: 30_000 });
		await expect(success).toContainText('読み取れました（1件）');
		await expect(page.getByTestId('qr-restore-text')).toHaveText(
			DAMAGED_QR_TEXT,
		);
		await expect(success).toContainText('成功した手法:');
		await expect(success).not.toContainText('成功した手法: 元の画像');
		await expect(success.getByRole('link', { name: '開く' })).toHaveAttribute(
			'href',
			DAMAGED_QR_TEXT,
		);
		const preview = page.getByTestId('qr-restore-preview');
		await expect(preview).toBeVisible();
		expect(await preview.evaluate((c: HTMLCanvasElement) => c.width > 0)).toBe(
			true,
		);

		// 画像・読み取り結果を外部へ送らず、保存もしない（tool_run はツール名のみ）
		expect(externalRequests).toEqual([]);
		await expect
			.poll(() => bodies.filter((b) => b.includes('"tool_run"')).length)
			.toBe(1);
		const run = JSON.parse(
			bodies.find((b) => b.includes('"tool_run"')) ?? '{}',
		) as { props?: Record<string, unknown> };
		expect(run.props?.tool).toBe('qr-restore');
		for (const body of bodies) expect(body).not.toContain(DAMAGED_QR_TEXT);
		const stored = await page.evaluate(() =>
			JSON.stringify({ ...localStorage, ...sessionStorage }),
		);
		expect(stored).not.toContain(DAMAGED_QR_TEXT);
		expect(page.url()).not.toContain('tools.codelife.cafe%2Fqr-restore');
	});

	test('QRコードを含まない画像は、全手法を試して読み取れない旨とコツを表示する', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('qr-restore').goto();
		await page.locator('input[type="file"]').setInputFiles(NOT_A_QR);
		const failed = page.getByTestId('qr-restore-failed');
		await expect(failed).toBeVisible({ timeout: 60_000 });
		await expect(failed).toContainText('読み取れませんでした');
		await expect(failed).toContainText('13通りの補正を試しました');
		await expect(failed).toContainText('位置検出パターン');
	});

	test('非対応形式のファイルはエラーを表示し、処理を始めない', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('qr-restore').goto();
		await page.locator('input[type="file"]').setInputFiles({
			name: 'memo.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('QRではありません'),
		});
		await expect(page.getByRole('alert')).toContainText(
			'対応形式は PNG・JPEG・WebP です',
		);
		await expect(page.getByTestId('qr-restore-progress')).toHaveCount(0);
	});

	test('QRコード読み取りで見つからなかったとき、復元ツールへ案内する', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('qr-reader').goto();
		await page.getByRole('tab', { name: '画像から読み取り' }).click();
		await page.getByLabel('QRコード画像を選択').setInputFiles(NOT_A_QR);
		await expect(page.getByText('QRコードが見つかりませんでした')).toBeVisible({
			timeout: 15_000,
		});
		await expect(
			page.getByRole('link', { name: 'QRコード復元', exact: true }),
		).toHaveAttribute('href', '/qr-restore/');
	});
});

test.describe('レスポンシブ', () => {
	for (const width of [375, 1440]) {
		test(`${width}px で結果を表示しても横にはみ出さない`, async ({
			page,
			createToolPage,
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await createToolPage('qr-restore').goto();
			await page.locator('input[type="file"]').setInputFiles({
				name: 'damaged-qr.png',
				mimeType: 'image/png',
				buffer: await toPng(lowContrastNoisyQr()),
			});
			await expect(page.getByTestId('qr-restore-success')).toBeVisible({
				timeout: 30_000,
			});
			await expect
				.poll(() =>
					page.evaluate(
						() => document.documentElement.scrollWidth <= window.innerWidth,
					),
				)
				.toBe(true);
		});
	}
});
