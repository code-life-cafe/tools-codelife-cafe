import { expect, test } from './fixtures/base';

test.describe('Base64 Converter Tool', () => {
	test('should load the page correctly', async ({ createToolPage }) => {
		const toolPage = createToolPage('base64');
		await toolPage.goto();
		await toolPage.expectTitle('Base64エンコード/デコード | CODE:LIFE Tools');
		await toolPage.expectSafetyBadge();
	});

	test('should encode and decode text correctly', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('base64');
		await toolPage.goto();

		// 1. Text encode (default)
		await toolPage.fillInput('こんにちは世界');
		await toolPage.expectOutputContains('44GT44KT44Gr44Gh44Gv5LiW55WM');

		// 2. Switch direction to decode
		await page.getByRole('switch').click();
		await toolPage.fillInput('44GT44KT44Gr44Gh44Gv5LiW55WM');
		await toolPage.expectOutputContains('こんにちは世界');

		// 3. Clear button
		await page.getByRole('button', { name: /クリア/ }).click();
		await expect(page.getByRole('textbox').first()).toHaveValue('');
	});

	test('file tab: toggling Data URI updates output immediately and the overlay does not block other controls', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('base64');
		await toolPage.goto();

		await page.getByRole('tab', { name: 'ファイル変換' }).click();

		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles({
			name: 'sample.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('hello'),
		});

		const output = page.getByRole('textbox').last();
		await expect(output).toContainText('data:text/plain;base64,');

		// トグルOFFで即座に生のBase64（Data URIプレフィックスなし）へ切り替わること
		await page
			.getByRole('checkbox', { name: /Data URI 形式を出力する/ })
			.click();
		await expect(output).not.toContainText('data:text/plain;base64,');
		await expect(output).toContainText('aGVsbG8=');

		// トグルONに戻すと再びData URI形式に戻ること
		await page
			.getByRole('checkbox', { name: /Data URI 形式を出力する/ })
			.click();
		await expect(output).toContainText('data:text/plain;base64,');

		// 回帰: 透明なファイル入力オーバーレイが画面全体のクリックを奪わないこと（#296）
		await page.getByRole('tab', { name: 'テキスト変換' }).click();
		await expect(
			page.getByRole('tab', { name: 'テキスト変換' }),
		).toHaveAttribute('data-state', 'active');
	});
});
