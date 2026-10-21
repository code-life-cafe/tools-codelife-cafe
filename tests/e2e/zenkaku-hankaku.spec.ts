import { expect, test } from './fixtures/base';

test.describe('Zenkaku Hankaku Converter', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const page = createToolPage('zenkaku-hankaku');
		await page.goto();
	});

	test('converts zenkaku to hankaku by default', async ({
		page: _page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('zenkaku-hankaku');
		await toolPage.fillInput('ＡＢＣ１２３アイウ');
		await toolPage.expectOutputContains('ABC123ｱｲｳ');
	});

	test('can clear input', async ({ page }) => {
		await page.getByRole('textbox').first().fill('test');
		await page.getByRole('button', { name: /クリア/ }).click();
		await expect(page.getByRole('textbox').first()).toHaveValue('');
	});

	test('direction switch has a visibly different background between checked and unchecked states', async ({
		page,
	}) => {
		const toggle = page.getByRole('switch');

		await expect(toggle).toHaveAttribute('data-state', 'unchecked');
		const uncheckedColor = await toggle.evaluate(
			(el) => getComputedStyle(el).backgroundColor,
		);

		await toggle.click();
		await expect(toggle).toHaveAttribute('data-state', 'checked');
		// 回帰: checked/uncheckedが同じ背景色で状態が視認できない不具合（#291）
		// data-state変更直後はCSSの色遷移が始まる前の場合があるため実際の色を待つ。
		await expect
			.poll(() => toggle.evaluate((el) => getComputedStyle(el).backgroundColor))
			.not.toBe(uncheckedColor);
	});

	test('4項目の既存デフォルトとスペースの連動を説明どおり維持する', async ({
		page,
	}) => {
		await expect(page.getByRole('checkbox')).toHaveCount(4);
		await page
			.getByLabel('入力テキスト')
			.fill('ＡＢＣ１２３　ガク！\t\nかな漢字');
		await expect(page.getByLabel('変換結果')).toHaveValue(
			'ABC123 ｶﾞｸ!\t\nかな漢字',
		);
		await expect(page.locator('#space-option-help')).toContainText(
			'「記号・スペース」と一緒',
		);
		await page
			.getByRole('checkbox', { name: '記号・スペース', exact: true })
			.uncheck();
		await expect(page.getByLabel('変換結果')).toHaveValue(
			'ABC123　ｶﾞｸ！\t\nかな漢字',
		);
	});

	test('英字と数字を別々に選べる', async ({ page }) => {
		await page.getByLabel('入力テキスト').fill('ＡＢ１２　カナ！');
		await page
			.getByRole('button', { name: '英数字を半角に', exact: true })
			.click();
		await page.getByRole('checkbox', { name: '数字', exact: true }).uncheck();
		await expect(page.getByLabel('変換結果')).toHaveValue('AB１２　カナ！');
		await page.getByRole('checkbox', { name: '英字', exact: true }).uncheck();
		await page.getByRole('checkbox', { name: '数字', exact: true }).check();
		await expect(page.getByLabel('変換結果')).toHaveValue('ＡＢ12　カナ！');
	});

	for (const example of [
		{
			preset: '英数字を半角に',
			input: '番号：ＡＢ１２３　カナ',
			output: '番号：AB123　カナ',
		},
		{
			preset: 'カナを全角に',
			input: 'ﾔﾏﾀﾞ ﾀﾛｳ ABC123',
			output: 'ヤマダ タロウ ABC123',
		},
		{
			preset: '4項目を半角に',
			input: 'ＡＢＣ１２３　ガク',
			output: 'ABC123 ｶﾞｸ',
		},
	]) {
		test(`${example.preset}: 掲載した日本語例と実出力が一致し入力を維持する`, async ({
			page,
		}) => {
			await page.getByLabel('入力テキスト').fill(example.input);
			await page
				.getByRole('button', { name: example.preset, exact: true })
				.click();
			await expect(page.getByLabel('入力テキスト')).toHaveValue(example.input);
			await expect(page.getByLabel('変換結果')).toHaveValue(example.output);
			await expect(
				page.getByText(`「${example.input}」→「${example.output}」`, {
					exact: false,
				}),
			).toBeVisible();
		});
	}

	test('用途設定から4項目のデフォルトへ戻せてキーボードで方向・記号を操作できる', async ({
		page,
	}) => {
		await page.getByLabel('入力テキスト').fill('ABC123 ｶﾞｸ');
		const kanaPreset = page.getByRole('button', {
			name: 'カナを全角に',
			exact: true,
		});
		await kanaPreset.focus();
		await kanaPreset.press('Enter');
		await expect(page.getByLabel('変換結果')).toHaveValue('ABC123 ガク');
		await page
			.getByRole('button', { name: '4項目を半角に', exact: true })
			.click();
		for (const checkbox of await page.getByRole('checkbox').all())
			await expect(checkbox).toBeChecked();
		const direction = page.getByRole('switch', {
			name: '半角から全角へ変換',
			exact: true,
		});
		await expect(direction).not.toBeChecked();
		await direction.focus();
		await direction.press('Space');
		await expect(direction).toBeChecked();
		await expect(page.getByLabel('変換結果')).toHaveValue('ＡＢＣ１２３　ガク');
		const symbols = page.getByRole('checkbox', {
			name: '記号・スペース',
			exact: true,
		});
		await symbols.focus();
		await symbols.press('Space');
		await expect(page.getByLabel('変換結果')).toHaveValue('ＡＢＣ１２３ ガク');
	});

	test('未使用の旧settingsクエリ・保存値を読み書きせず既存デフォルトを維持する', async ({
		page,
	}) => {
		const saved = JSON.stringify({
			katakana: false,
			alpha: false,
			numbers: false,
			symbols: false,
		});
		await page.evaluate(
			(value) => localStorage.setItem('tool_settings_zenkaku-hankaku', value),
			saved,
		);
		const encoded = Buffer.from(saved).toString('base64');
		await page.goto(`/zenkaku-hankaku?settings=${encodeURIComponent(encoded)}`);
		for (const checkbox of await page.getByRole('checkbox').all())
			await expect(checkbox).toBeChecked();
		await page.getByLabel('入力テキスト').fill('Ａ１　ガ');
		await expect(page.getByLabel('変換結果')).toHaveValue('A1 ｶﾞ');
		await page
			.getByRole('button', { name: '英数字を半角に', exact: true })
			.click();
		expect(
			await page.evaluate(() =>
				localStorage.getItem('tool_settings_zenkaku-hankaku'),
			),
		).toBe(saved);
		expect(new URL(page.url()).searchParams.get('settings')).toBe(encoded);
	});

	test('PC・スマホで操作エリアが横にはみ出さない', async ({
		page,
	}, testInfo) => {
		await page.getByLabel('入力テキスト').fill('番号：ＡＢ１２３　カナ');
		await page
			.getByRole('button', { name: '英数字を半角に', exact: true })
			.click();
		for (const width of [375, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			await expect(
				page.getByRole('button', { name: 'カナを全角に', exact: true }),
			).toBeVisible();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
			await page
				.locator('astro-island')
				.filter({ has: page.locator('#zenkaku-input') })
				.locator(':scope > div')
				.screenshot({ path: testInfo.outputPath(`zenkaku-ui-${width}.png`) });
		}
	});
});
