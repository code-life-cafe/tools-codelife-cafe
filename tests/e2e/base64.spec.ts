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
	test('file tab: 先に選んだ遅いファイルの読込完了が後から選んだファイルの結果を上書きしない', async ({
		page,
		createToolPage,
	}) => {
		// 名前が slow- で始まるファイルは読込完了通知を遅らせ、完了順序を入れ替える
		await page.addInitScript(() => {
			const original = FileReader.prototype.readAsDataURL;
			FileReader.prototype.readAsDataURL = function (this: FileReader, blob) {
				const delay = blob instanceof File && blob.name.startsWith('slow-');
				if (!delay) return original.call(this, blob);
				const probe = new FileReader();
				probe.onload = () => {
					setTimeout(() => original.call(this, blob), 1500);
				};
				probe.readAsArrayBuffer(blob);
			};
		});
		const toolPage = createToolPage('base64');
		await toolPage.goto();
		await page.getByRole('tab', { name: 'ファイル変換' }).click();

		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles({
			name: 'slow-A.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('AAAAAA'),
		});
		await fileInput.setInputFiles({
			name: 'B.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('BBBBBB'),
		});

		const output = page.getByRole('textbox').last();
		await expect(output).toContainText('QkJCQkJC');
		await expect(page.getByText('B.txt')).toBeVisible();

		// Aの読込完了後も、B の結果が維持されること
		await page.waitForTimeout(2200);
		await expect(output).toContainText('QkJCQkJC');
		await expect(output).not.toContainText('QUFBQUFB');
		await expect(page.getByText('B.txt')).toBeVisible();
		await expect(page.getByText('slow-A.txt')).toHaveCount(0);
	});

	test('a11y: 入力・出力・モード切替が日本語のアクセシブルネームで識別できる', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('base64');
		await toolPage.goto();

		const dirSwitch = page.getByRole('switch', { name: 'テキスト → Base64' });
		const input = page.getByRole('textbox', {
			name: /^入力 \(プレーンテキスト\)/,
		});
		const output = page.getByRole('textbox', { name: '変換結果' });
		await expect(dirSwitch).toBeVisible();
		await expect(input).toBeVisible();
		await expect(output).toBeVisible();

		// ラベルクリックで対象にフォーカス / 切替
		await page.getByText('入力 (プレーンテキスト)').click();
		await expect(input).toBeFocused();
		await input.fill('こんにちは世界');
		await expect(output).toHaveValue('44GT44KT44Gr44Gh44Gv5LiW55WM');

		// キーボードでモード切替（名前は現在の方向に追従する）
		await dirSwitch.focus();
		await page.keyboard.press('Space');
		await expect(
			page.getByRole('switch', { name: 'Base64 → テキスト' }),
		).toBeChecked();
		await expect(
			page.getByRole('textbox', { name: /^入力 \(Base64\)/ }),
		).toBeVisible();

		// ファイルタブ
		await page.getByRole('tab', { name: 'ファイル変換' }).click();
		await expect(page.getByLabel('ファイル入力')).toHaveCount(1);
		const fileOutput = page.getByRole('textbox', { name: 'Base64 出力' });
		await expect(fileOutput).toBeVisible();
		await page.locator('input[type="file"]').setInputFiles({
			name: 'a.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('hi'),
		});
		await expect(fileOutput).toHaveValue('data:text/plain;base64,aGk=');
	});
});
