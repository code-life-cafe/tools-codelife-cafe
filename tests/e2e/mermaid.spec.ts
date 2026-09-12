import { expect, test } from './fixtures/base';

test.describe('Mermaidプレビュー・修復 Tool', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('mermaid');
		await toolPage.goto();
		await toolPage.expectTitle('Mermaidプレビュー・自動修復');
		await toolPage.expectSafetyBadge();
	});

	test('デフォルトコードでSVGダイアグラムが描画されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('mermaid');
		await toolPage.goto();

		// SVG要素が表示されるまで待機
		const svg = page.locator('div svg');
		await expect(svg.first()).toBeVisible({ timeout: 10000 });
	});

	test('AIコードフェンス混入・全角記号が自動修復されて描画されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('mermaid');
		await toolPage.goto();

		const textarea = page.locator('textarea');
		await textarea.fill(
			'```mermaid\nflowchart TD\n  A［申請入力］ ーー＞ B［課長承認］\n```',
		);

		// 自動修復バナーが表示されること
		await expect(
			page.getByText('AI構文・日本語全角記号エラーを自動修復しました'),
		).toBeVisible({ timeout: 10000 });

		// SVGが正常に描画されていること
		const svg = page.locator('div svg');
		await expect(svg.first()).toBeVisible();
	});

	test('SVG保存・PNG保存ボタンが有効であること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('mermaid');
		await toolPage.goto();

		const svgBtn = page.getByRole('button', { name: 'SVG保存' });
		const pngBtn = page.getByRole('button', { name: 'PNG保存' });

		await expect(svgBtn).toBeEnabled({ timeout: 10000 });
		await expect(pngBtn).toBeEnabled();
	});
});
