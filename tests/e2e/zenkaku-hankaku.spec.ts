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
		const checkedColor = await toggle.evaluate(
			(el) => getComputedStyle(el).backgroundColor,
		);

		// 回帰: checked/uncheckedが同じ背景色で状態が視認できない不具合（#291）
		expect(checkedColor).not.toBe(uncheckedColor);
	});
});
