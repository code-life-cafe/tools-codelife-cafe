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

	test('修復ONでもラベル内の「→」が改変されず描画されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('mermaid');
		await toolPage.goto();

		const textarea = page.locator('textarea');
		await textarea.fill('flowchart TD\nA[東京→大阪] --> B[完了]');

		// モバイル幅ではプレビュータブへ切り替える
		const previewTab = page.getByRole('tab', { name: /プレビュー/ });
		if (await previewTab.isVisible()) {
			await previewTab.click();
		}

		// ラベル本文はそのまま描画され、正常な図に対する自動修復バナーは出ない
		const svg = page
			.getByRole('img', { name: /Mermaidダイアグラムのプレビュー/ })
			.locator('svg')
			.first();
		await expect(svg).toBeVisible({ timeout: 10000 });
		await expect(svg).toContainText('東京→大阪');
		await expect(svg).not.toContainText('東京-->大阪');
		await expect(
			page.getByText('AI構文・日本語全角記号エラーを自動修復しました'),
		).toHaveCount(0);
	});

	test('構文位置の「→」は修復され、ラベル内の「→」は保持されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('mermaid');
		await toolPage.goto();

		const textarea = page.locator('textarea');
		await textarea.fill('flowchart TD\nA[東京→大阪] → B[完了]');

		await expect(
			page.getByText('AI構文・日本語全角記号エラーを自動修復しました'),
		).toBeVisible({ timeout: 10000 });

		// モバイル幅ではプレビュータブへ切り替える
		const previewTab = page.getByRole('tab', { name: /プレビュー/ });
		if (await previewTab.isVisible()) {
			await previewTab.click();
		}
		const svg = page
			.getByRole('img', { name: /Mermaidダイアグラムのプレビュー/ })
			.locator('svg')
			.first();
		await expect(svg).toContainText('東京→大阪');
		await expect(svg).toContainText('完了');
	});

	test('sequenceのcentral・half-arrow・複数文でも修復後の日本語本文を保持する', async ({
		page,
		createToolPage,
	}) => {
		for (const message of [
			'Alice->>()John: 東京→大阪',
			'Alice()->>John: 東京→大阪',
			'Alice()->>()John: 東京→大阪',
			'Alice-|/John: 東京→大阪',
			'Alice->>John: 東京→大阪; John → Alice: 大阪→東京',
		]) {
			await createToolPage('mermaid').goto();
			await page
				.locator('textarea')
				.fill('```mermaid\nsequenceDiagram\n' + message + '\n```');
			const previewTab = page.getByRole('tab', { name: /プレビュー/ });
			if (await previewTab.isVisible()) await previewTab.click();
			const svg = page
				.getByRole('img', { name: /Mermaidダイアグラムのプレビュー/ })
				.locator('svg')
				.first();
			await expect(svg).toContainText('東京→大阪', { timeout: 10000 });
			await expect(svg).not.toContainText('東京-->大阪');
			if (message.includes(';')) await expect(svg).toContainText('大阪→東京');
		}
	});

	test('asymmetricノードの本文も自動修復後に保持される', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('mermaid').goto();
		await page
			.locator('textarea')
			.fill('```mermaid\nflowchart TD\nA>東京→大阪] --> B\n```');
		const previewTab = page.getByRole('tab', { name: /プレビュー/ });
		if (await previewTab.isVisible()) await previewTab.click();
		const svg = page
			.getByRole('img', { name: /Mermaidダイアグラムのプレビュー/ })
			.locator('svg')
			.first();
		await expect(svg).toContainText('東京→大阪', { timeout: 10000 });
		await expect(svg).not.toContainText('東京-->大阪');
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
