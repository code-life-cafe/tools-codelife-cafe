import { expect, test } from './fixtures/base';

test('AI表データプロンプト生成ツールが表データからプロンプトを生成できること', async ({
	page,
	createToolPage,
}) => {
	const toolPage = createToolPage('ai-spreadsheet-prompt');
	await toolPage.goto();

	await toolPage.expectSafetyBadge();
	await toolPage.expectTitle('AI表データプロンプト生成');

	await page
		.locator('#spreadsheetInput')
		.fill('名前,売上\n商品A,1000\n商品B,2500');

	const output = page.locator('#promptOutput');
	await expect(output).toContainText('以下の表データを分析');
	await expect(output).toContainText('| 名前 | 売上 |');
	await expect(output).toContainText('| 商品B | 2500 |');
	await expect(page.getByText('検出結果: 3行 / 2列')).toBeVisible();
});
