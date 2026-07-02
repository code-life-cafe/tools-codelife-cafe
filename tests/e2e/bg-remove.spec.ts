import { expect, test } from './fixtures/base';

test.describe('背景削除ツール', () => {
	test.beforeEach(async ({ page }) => {
		// AIモデルのダウンロードリクエストをブロック（Worker含む: context.route でWorkerリクエストも捕捉）
		const context = page.context();
		await context.route('**/*.onnx*', (route) => route.abort());
		await context.route('**/*huggingface*', (route) => route.abort());
		await context.route('**/*hf.co*', (route) => route.abort());
		await context.route('**/*models.tools.codelife*', (route) => route.abort());
		// React Island のハイドレーション完了後にアサートできるよう domcontentloaded で待機
		await page.goto('/bg-remove', { waitUntil: 'domcontentloaded' });
		// ドロップゾーンが表示されるまで待つ（Reactハイドレーション完了の目印）
		await expect(page.getByText('画像をドラッグ＆ドロップ')).toBeVisible({
			timeout: 10000,
		});
	});

	test('ページが正常に読み込まれ、ドロップゾーンが表示される', async ({
		page,
	}) => {
		await expect(page.locator('h1').first()).toContainText('背景削除');
		await expect(page.getByText('画像をドラッグ＆ドロップ')).toBeVisible();
	});

	test('モード切替UIが表示され、デフォルトで高精度モードになっている', async ({
		page,
	}) => {
		const modeSwitch = page.getByRole('switch');
		await expect(modeSwitch).toBeVisible();
		await expect(modeSwitch).toBeChecked(); // デフォルトで高精度モード (checked = true)

		const modeLabel = page.locator('label[for="mode-switch"]');
		await expect(modeLabel).toContainText('高精度モード');
		await expect(
			page.getByText('BEN2（極めて高精度・アニメ対応）≈ 209MB'),
		).toBeVisible();

		// スイッチをOFFにして高速モードに切り替え
		await modeSwitch.click();
		await expect(modeLabel).toContainText('高速モード');
		await expect(
			page.getByText('MODNet（人物特化・高速）≈ 25.9MB'),
		).toBeVisible();
	});

	test('セキュリティバッジが表示される', async ({ page }) => {
		await expect(
			page.getByRole('button', { name: /セキュリティ情報を表示/ }),
		).toBeVisible();
	});
});
