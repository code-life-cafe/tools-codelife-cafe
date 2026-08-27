import { expect, test } from './fixtures/base';

test.describe('QR Encrypt Tool', () => {
	test('should load the page correctly', async ({ createToolPage }) => {
		const toolPage = createToolPage('qr-encrypt');
		await toolPage.goto();
		await toolPage.expectTitle('暗号化QR生成・復号');
		await toolPage.expectSafetyBadge();
	});

	test('switches between encrypt and decrypt tabs', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-encrypt');
		await toolPage.goto();

		await expect(
			page.getByRole('tab', { name: '暗号化してQR生成' }),
		).toHaveAttribute('data-state', 'active');

		await page.getByRole('tab', { name: 'QRを読み取って復号' }).click();
		await expect(
			page.getByRole('tab', { name: 'QRを読み取って復号' }),
		).toHaveAttribute('data-state', 'active');
		await expect(
			page.getByRole('tab', { name: 'カメラで読み取り' }),
		).toBeVisible();

		await page.getByRole('tab', { name: '暗号化してQR生成' }).click();
		await expect(
			page.getByRole('tab', { name: '暗号化してQR生成' }),
		).toHaveAttribute('data-state', 'active');
	});

	test('encrypts text into a QR code image', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-encrypt');
		await toolPage.goto();

		await page
			.getByPlaceholder(
				'QRコードにして共有したい秘密のメッセージを入力してください',
			)
			.fill('秘密のメッセージ');
		await page
			.getByPlaceholder('共有するパスフレーズ')
			.fill('correct horse battery staple');

		await page.getByRole('button', { name: '暗号化してQR生成' }).click();

		const qrImage = page.getByRole('img', { name: '暗号化QRコード' });
		await expect(qrImage).toBeVisible({ timeout: 15_000 });

		await expect(
			page.getByRole('button', { name: /PNG ダウンロード/i }),
		).toBeEnabled();
		await expect(
			page.getByRole('button', { name: /SVG ダウンロード/i }),
		).toBeEnabled();
	});

	test('shows validation error for empty passphrase-less generation attempt', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-encrypt');
		await toolPage.goto();

		// テキスト・パスフレーズが空の間はボタンが無効化されていること
		await expect(
			page.getByRole('button', { name: '暗号化してQR生成' }),
		).toBeDisabled();
	});
});
