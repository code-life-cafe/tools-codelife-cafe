import crypto from 'node:crypto';
import { expect, test } from './fixtures/base';

// deflate-raw圧縮が効きにくいランダム文字列を生成し、
// 暗号化後ペイロードを実用警告閾値（1,300B）超・QR上限（2,953B）内に収める。
function randomPayloadText(length: number): string {
	return crypto.randomBytes(length).toString('base64').slice(0, length);
}

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

	test('shows practical scan warning for large payloads and highlights the zoom button', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-encrypt');
		await toolPage.goto();

		// 900文字のランダム文字列 → 暗号化後ペイロードは実用警告閾値（1,300B）超・上限（2,953B）以内
		await page
			.getByPlaceholder(
				'QRコードにして共有したい秘密のメッセージを入力してください',
			)
			.fill(randomPayloadText(900));
		await page
			.getByPlaceholder('共有するパスフレーズ')
			.fill('correct horse battery staple');

		// 入力時点（暗号化実行前）の使用量メーターに警告文が表示される
		await expect(
			page.getByText('このサイズは画面表示では読み取りにくい可能性があります'),
		).toBeVisible();

		await page.getByRole('button', { name: '暗号化してQR生成' }).click();

		const qrImage = page.getByRole('img', { name: '暗号化QRコード' });
		await expect(qrImage).toBeVisible({ timeout: 15_000 });

		// 警告時は拡大表示ボタンが強調表示（primaryボタン = defaultバリアント）になる
		const zoomButton = page.getByRole('button', { name: '拡大表示' });
		await expect(zoomButton).toBeVisible();
		await expect(zoomButton).toHaveAttribute('data-variant', 'default');
	});

	test('opens and closes the fullscreen zoom dialog', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-encrypt');
		await toolPage.goto();

		await page
			.getByPlaceholder(
				'QRコードにして共有したい秘密のメッセージを入力してください',
			)
			.fill('拡大表示のテスト');
		await page
			.getByPlaceholder('共有するパスフレーズ')
			.fill('correct horse battery staple');
		await page.getByRole('button', { name: '暗号化してQR生成' }).click();

		await expect(page.getByRole('img', { name: '暗号化QRコード' })).toBeVisible(
			{ timeout: 15_000 },
		);

		await page.getByRole('button', { name: '拡大表示' }).click();

		const dialog = page.getByRole('dialog', {
			name: '暗号化QRコード（拡大表示）',
		});
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByRole('img', { name: '暗号化QRコード（拡大表示）' }),
		).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(dialog).not.toBeVisible();
	});
});
