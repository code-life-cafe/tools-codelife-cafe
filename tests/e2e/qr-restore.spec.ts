import path from 'node:path';
import sharp from 'sharp';
import type { GrayImage } from '../../src/lib/tools/qr-restore';
import {
	DAMAGED_QR_TEXT,
	lowContrastNoisyQr,
	seededRandom,
} from '../helpers/qr-damage';
import { expect, test } from './fixtures/base';

async function toPng(image: GrayImage): Promise<Buffer> {
	return sharp(Buffer.from(image.data), {
		raw: { width: image.width, height: image.height, channels: 1 },
	})
		.png()
		.toBuffer();
}

/** 決定論的なノイズ画像（QRコードを含まない） */
function noiseImage(width: number, height: number): GrayImage {
	const random = seededRandom(7);
	const data = new Uint8ClampedArray(width * height);
	for (let i = 0; i < data.length; i++) data[i] = Math.floor(random() * 256);
	return { width, height, data };
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
		expect(page.url()).not.toContain(DAMAGED_QR_TEXT);
		expect(page.url()).not.toContain(encodeURIComponent(DAMAGED_QR_TEXT));
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

	test('処理中は進捗（n/13・手法名）を表示し、中止すると結果を出さずに次の画像を選べる', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('qr-restore').goto();
		// QRを含まない大きな画像は全手法を試すため、中止できるだけの時間がかかる
		await page.locator('input[type="file"]').setInputFiles({
			name: 'noise.png',
			mimeType: 'image/png',
			buffer: await toPng(noiseImage(1600, 1600)),
		});
		const progress = page.getByTestId('qr-restore-progress');
		await expect(progress).toContainText(/試行中（\d+\/13）: \S+/, {
			timeout: 30_000,
		});
		await progress.getByRole('button', { name: '中止' }).click();
		await expect(progress).toHaveCount(0);
		// 中止した処理の結果が後から表示されない
		await page.waitForTimeout(3_000);
		await expect(page.getByTestId('qr-restore-failed')).toHaveCount(0);
		await expect(page.getByTestId('qr-restore-success')).toHaveCount(0);
		await expect(page.getByRole('alert')).toHaveCount(0);

		await page.locator('input[type="file"]').setInputFiles({
			name: 'damaged-qr.png',
			mimeType: 'image/png',
			buffer: await toPng(lowContrastNoisyQr()),
		});
		await expect(page.getByTestId('qr-restore-text')).toHaveText(
			DAMAGED_QR_TEXT,
			{ timeout: 30_000 },
		);
	});

	test('読み取り機能（WASM）を読み込めない場合は、読めなかったではなくエラーを表示する', async ({
		page,
		createToolPage,
	}) => {
		await page.route('**/*.wasm', (route) =>
			route.request().url().includes('zxing_reader')
				? route.abort()
				: route.fallback(),
		);
		await createToolPage('qr-restore').goto();
		await page.locator('input[type="file"]').setInputFiles({
			name: 'damaged-qr.png',
			mimeType: 'image/png',
			buffer: await toPng(lowContrastNoisyQr()),
		});
		await expect(page.getByRole('alert')).toContainText(
			'QRコードの読み取り機能を読み込めませんでした',
			{ timeout: 30_000 },
		);
		await expect(page.getByTestId('qr-restore-failed')).toHaveCount(0);
		await expect(page.getByTestId('qr-restore-progress')).toHaveCount(0);
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
