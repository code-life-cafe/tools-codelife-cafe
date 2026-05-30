import { expect, test } from './fixtures/base';

test.describe('背景削除ツール', () => {
	test('ページが正常に読み込まれ、ドロップゾーンが表示される', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('bg-remove');
		await toolPage.goto();

		// h1 タイトル確認
		await expect(page.locator('h1').first()).toContainText('背景削除');

		// ドロップゾーンが表示される
		await expect(page.getByText('画像をドラッグ＆ドロップ')).toBeVisible();
	});

	test('モード切替UIが表示され、デフォルトで高精度モードになっている', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('bg-remove');
		await toolPage.goto();

		// モード切替スイッチが存在する
		const modeSwitch = page.getByRole('switch');
		await expect(modeSwitch).toBeVisible();
		await expect(modeSwitch).toBeChecked(); // デフォルトで高精度モード (checked = true)

		// デフォルトで高精度モードの表示
		const modeLabel = page.locator('label[for="mode-switch"]');
		await expect(modeLabel).toContainText('✨ 高精度モード');
		await expect(
			page.getByText('BEN2（極めて高精度・アニメ対応）≈ 209MB'),
		).toBeVisible();

		// スイッチをOFFにして高速モードに切り替え
		await modeSwitch.click();
		await expect(modeLabel).toContainText('⚡ 高速モード');
		await expect(
			page.getByText('MODNet（人物特化・高速）≈ 25.9MB'),
		).toBeVisible();
	});

	test('セキュリティバッジが表示される', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('bg-remove');
		await toolPage.goto();

		// SafetyBadge の確認
		await expect(
			page.getByRole('button', { name: /セキュリティ情報を表示/ }),
		).toBeVisible();
	});

	test('使い方セクションが開閉できる', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('bg-remove');
		await toolPage.goto();

		const usageDetails = page.getByText('使い方・ユースケース');
		await expect(usageDetails).toBeVisible();

		// details を開く
		await usageDetails.click();
		await expect(page.getByText('商品写真の背景を透過にしたい')).toBeVisible();
	});
});
