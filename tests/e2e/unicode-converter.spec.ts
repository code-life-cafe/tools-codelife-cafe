import { expect, test } from './fixtures/base';

test.describe('Unicode Converter Tool', () => {
	test('should load the page correctly', async ({ createToolPage }) => {
		const toolPage = createToolPage('unicode-converter');
		await toolPage.goto();
		await toolPage.expectTitle('ユニコード変換 | CODE:LIFE Tools');
		await toolPage.expectSafetyBadge();
	});

	test('should convert text to unicode and vice versa', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unicode-converter');
		await toolPage.goto();

		// 1. Convert text to unicode (default)
		await toolPage.fillInput('あ');
		await toolPage.expectOutputContains('\\u3042');

		// 2. Switch to decode mode
		await page.getByRole('switch').click();
		await toolPage.fillInput('\\u3042');
		await toolPage.expectOutputContains('あ');
	});

	test('モード切替スイッチは日本語のアクセシブル名を持ち、ラベルクリック・Tab/Spaceで切り替えられる', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unicode-converter');
		await toolPage.goto();

		const modeSwitch = page.getByRole('switch', { name: /変換モード切替/ });
		await expect(modeSwitch).toHaveCount(1);
		await expect(modeSwitch).toHaveAttribute('aria-checked', 'false');
		// 可視ラベル（現在のモード名）もアクセシブル名に含まれる
		await expect(modeSwitch).toHaveAccessibleName(
			/変換モード切替.*テキスト → ユニコード/,
		);

		// 可視ラベルのクリックで切り替わる
		await page.getByText('テキスト → ユニコード', { exact: true }).click();
		await expect(modeSwitch).toHaveAttribute('aria-checked', 'true');
		await expect(modeSwitch).toHaveAccessibleName(
			/変換モード切替.*ユニコード → テキスト/,
		);

		// Tab移動 + Space で戻り、フォーカスが維持される
		await modeSwitch.focus();
		await expect(modeSwitch).toBeFocused();
		await page.keyboard.press('Space');
		await expect(modeSwitch).toHaveAttribute('aria-checked', 'false');
		await expect(modeSwitch).toBeFocused();

		// 切替後も変換は既存どおり（日😀A）
		await toolPage.fillInput('日😀A');
		await toolPage.expectOutputContains('\\u65e5\\ud83d\\ude00A');
	});

	test('モード切替スイッチは375pxでも操作でき、範囲外の入力は日本語エラーを表示する', async ({
		page,
		createToolPage,
	}) => {
		await page.setViewportSize({ width: 375, height: 800 });
		const toolPage = createToolPage('unicode-converter');
		await toolPage.goto();

		const modeSwitch = page.getByRole('switch', { name: /変換モード切替/ });
		await modeSwitch.click();
		await expect(modeSwitch).toHaveAttribute('aria-checked', 'true');
		await toolPage.fillInput('\\u{110000}');
		await toolPage.expectOutputContains('デコードに失敗しました');
		await toolPage.fillInput('\\u{1F600}\\u65e5');
		await toolPage.expectOutputContains('😀日');
	});
});
