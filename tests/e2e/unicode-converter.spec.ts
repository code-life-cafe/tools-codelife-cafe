import { expect, test } from './fixtures/base';

test.describe('Unicode Converter Tool', () => {
	test('should load the page correctly', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('unicode-converter');
		await toolPage.goto();
		await expect(page).toHaveTitle(
			'ユニコード変換｜\\uXXXXエスケープを日本語にデコード・相互変換 | CODE:LIFE Tools',
		);
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

		const modeSwitch = page.getByRole('switch', { name: '変換モード切替' });
		await expect(modeSwitch).toHaveCount(1);
		await expect(modeSwitch).toHaveAttribute('aria-checked', 'false');
		// アクセシブル名は状態（モード）が変わっても不変。方向は説明として別に公開する
		await expect(modeSwitch).toHaveAccessibleName('変換モード切替');
		await expect(modeSwitch).toHaveAccessibleDescription(
			'テキスト → ユニコード',
		);

		// 可視ラベルのクリックで切り替わる。名前は変わらず、説明だけが更新される
		await page.getByText('変換モード切替', { exact: true }).click();
		await expect(modeSwitch).toHaveAttribute('aria-checked', 'true');
		await expect(modeSwitch).toHaveAccessibleName('変換モード切替');
		await expect(modeSwitch).toHaveAccessibleDescription(
			'ユニコード → テキスト',
		);

		// キーボードのTabだけでスイッチへ到達し（直接focus()に頼らない）、Spaceで戻してもフォーカスが維持される
		await page.locator('body').click({ position: { x: 1, y: 1 } });
		let reached = false;
		for (let i = 0; i < 60 && !reached; i++) {
			await page.keyboard.press('Tab');
			reached = await modeSwitch.evaluate(
				(el) => el === document.activeElement,
			);
		}
		expect(reached).toBe(true);
		await expect(modeSwitch).toBeFocused();
		await page.keyboard.press('Space');
		await expect(modeSwitch).toHaveAttribute('aria-checked', 'false');
		await expect(modeSwitch).toBeFocused();

		// Shift+Tabで離れてTabで戻っても到達できる
		await page.keyboard.press('Shift+Tab');
		await expect(modeSwitch).not.toBeFocused();
		await page.keyboard.press('Tab');
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

		const modeSwitch = page.getByRole('switch', { name: '変換モード切替' });
		await modeSwitch.click();
		await expect(modeSwitch).toHaveAttribute('aria-checked', 'true');
		await toolPage.fillInput('\\u{110000}');
		await toolPage.expectOutputContains('デコードに失敗しました');
		await toolPage.fillInput('\\u{1F600}\\u65e5');
		await toolPage.expectOutputContains('😀日');
	});

	for (const width of [320, 375]) {
		test(`モード切替の行は${width}pxで横にはみ出さない`, async ({
			page,
			createToolPage,
		}) => {
			await page.setViewportSize({ width, height: 800 });
			const toolPage = createToolPage('unicode-converter');
			await toolPage.goto();

			const row = page.locator('#unicode-mode-switch').locator('..');
			const sizes = await row.evaluate((el) => ({
				client: el.clientWidth,
				scroll: el.scrollWidth,
				doc: document.documentElement.scrollWidth,
				win: window.innerWidth,
			}));
			expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
			expect(sizes.doc).toBeLessThanOrEqual(sizes.win);
			await expect(page.locator('#unicode-mode-switch')).toBeVisible();
		});
	}

	for (const viewport of [
		{ width: 1280, height: 900 },
		{ width: 390, height: 844 },
	]) {
		test(`入力・結果欄は可視ラベルで識別・フォーカスできる (${viewport.width}px)`, async ({
			page,
			createToolPage,
		}) => {
			await page.setViewportSize(viewport);
			const toolPage = createToolPage('unicode-converter');
			await toolPage.goto();

			const inputName = '入力 (プレーンテキスト)';
			const decodeInputName = '入力 (ユニコード(\\uXXXX))';
			const input = page.getByRole('textbox', { name: inputName, exact: true });
			const output = page.getByRole('textbox', {
				name: '変換結果',
				exact: true,
			});

			// encode: 名前で一意に識別でき、結果欄はreadOnly
			await expect(input).toHaveCount(1);
			await expect(output).toHaveCount(1);
			await expect(output).toHaveAttribute('readonly', '');
			await expect(input).not.toHaveAttribute('readonly', '');

			// 可視ラベルのクリックで対応欄にフォーカスする
			await page.getByText(inputName, { exact: true }).click();
			await expect(input).toBeFocused();
			await page.getByText('変換結果', { exact: true }).click();
			await expect(output).toBeFocused();

			// キーボードで名前付き入力に入力でき、「日本語」がencodeされる
			await input.focus();
			await page.keyboard.type('日本語');
			await expect(output).toHaveValue('\\u65e5\\u672c\\u8a9e');

			// 方向切替（キーボード）で入力欄の名前が更新される
			const modeSwitch = page.getByRole('switch', { name: '変換モード切替' });
			await modeSwitch.focus();
			await page.keyboard.press('Space');
			await expect(modeSwitch).toHaveAttribute('aria-checked', 'true');
			const decodeInput = page.getByRole('textbox', {
				name: decodeInputName,
				exact: true,
			});
			await expect(decodeInput).toHaveCount(1);
			await expect(input).toHaveCount(0);
			await expect(output).toHaveCount(1);

			// decode: 既存のencode結果をデコードして「日本語」に戻る
			await page.getByText(decodeInputName, { exact: true }).click();
			await expect(decodeInput).toBeFocused();
			await decodeInput.fill('\\u65e5\\u672c\\u8a9e');
			await expect(output).toHaveValue('日本語');

			// 不正Unicodeは既存どおりエラーを表示し、結果欄はreadOnlyのまま
			await decodeInput.fill('\\u{110000}');
			await expect(output).toHaveValue(/デコードに失敗しました/);
			await expect(output).toHaveAttribute('readonly', '');

			// 空入力は結果も空
			await decodeInput.fill('');
			await expect(output).toHaveValue('');

			// クリアは入力を空にする
			await decodeInput.fill('\\u3042');
			await expect(output).toHaveValue('あ');
			await page.getByRole('button', { name: 'クリア' }).click();
			await expect(decodeInput).toHaveValue('');
			await expect(output).toHaveValue('');
		});
	}
});
