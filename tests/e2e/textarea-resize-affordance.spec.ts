import { expect, test } from './fixtures/base';

const GRIP_SELECTOR = '[data-slot="textarea-resize-handle"]';
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.describe('textareaのリサイズ視覚ヒント（グリップ）', () => {
	test('resize="vertical"のtextareaはデスクトップでグリップが常時表示される', async ({
		createToolPage,
		page,
	}) => {
		await page.setViewportSize(DESKTOP_VIEWPORT);
		const toolPage = createToolPage('sql-formatter');
		await toolPage.goto();

		const textarea = page.locator('textarea[data-resize="vertical"]').first();
		await expect(textarea).toHaveCount(1);

		const grip = page.locator(GRIP_SELECTOR).first();
		await expect(grip).toBeVisible();
	});

	test('resize="vertical"のtextareaはモバイル幅ではグリップが非表示になる', async ({
		createToolPage,
		page,
	}) => {
		await page.setViewportSize(MOBILE_VIEWPORT);
		const toolPage = createToolPage('sql-formatter');
		await toolPage.goto();

		const grip = page.locator(GRIP_SELECTOR).first();
		await expect(grip).toBeHidden();
	});

	test('resizeプロパティを指定しないtextareaにはグリップが描画されない', async ({
		createToolPage,
		page,
	}) => {
		await page.setViewportSize(DESKTOP_VIEWPORT);
		const toolPage = createToolPage('char-count');
		await toolPage.goto();

		await expect(page.locator(GRIP_SELECTOR)).toHaveCount(0);
	});

	test('グリップ付近からドラッグすると従来どおり縦方向にリサイズできる', async ({
		createToolPage,
		page,
	}) => {
		await page.setViewportSize(DESKTOP_VIEWPORT);
		const toolPage = createToolPage('text-diff');
		await toolPage.goto();

		const textarea = page.locator('#text-diff-textarea-a');
		const before = await textarea.evaluate((el) => el.getBoundingClientRect());

		const box = await textarea.boundingBox();
		if (!box) throw new Error('textarea bounding box not found');

		// ネイティブのリサイズグリップは右下角の数px四方にあるため、その付近からドラッグする
		const startX = box.x + box.width - 3;
		const startY = box.y + box.height - 3;

		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(startX, startY + 120, { steps: 10 });
		await page.mouse.up();

		const after = await textarea.evaluate((el) => el.getBoundingClientRect());
		expect(after.height).toBeGreaterThan(before.height);
	});

	test.describe('resize-y直書きから共通Textareaへ移行した箇所でもグリップが表示される', () => {
		test('URLエンコーダー', async ({ createToolPage, page }) => {
			await page.setViewportSize(DESKTOP_VIEWPORT);
			const toolPage = createToolPage('url-encoder');
			await toolPage.goto();

			await expect(page.locator(GRIP_SELECTOR).first()).toBeVisible();
		});

		test('Markdownプレビュー', async ({ createToolPage, page }) => {
			await page.setViewportSize(DESKTOP_VIEWPORT);
			const toolPage = createToolPage('markdown');
			await toolPage.goto();

			await expect(page.locator(GRIP_SELECTOR).first()).toBeVisible();
		});

		test('暗号化ツール（入力・出力）', async ({ createToolPage, page }) => {
			await page.setViewportSize(DESKTOP_VIEWPORT);
			const toolPage = createToolPage('cipher');
			await toolPage.goto();

			await expect(page.locator(GRIP_SELECTOR)).toHaveCount(2);
		});

		test('電話番号一括入力', async ({ createToolPage, page }) => {
			await page.setViewportSize(DESKTOP_VIEWPORT);
			const toolPage = createToolPage('phone-formatter');
			await toolPage.goto();
			await page.getByRole('tab', { name: '一括入力' }).click();

			await expect(page.locator(GRIP_SELECTOR).first()).toBeVisible();
		});
	});

	test('TextDiffの2つのtextareaはラッパー導入後も高さが揃う（レイアウト回帰なし）', async ({
		createToolPage,
		page,
	}) => {
		await page.setViewportSize(DESKTOP_VIEWPORT);
		const toolPage = createToolPage('text-diff');
		await toolPage.goto();

		const boxA = await page.locator('#text-diff-textarea-a').boundingBox();
		const boxB = await page.locator('#text-diff-textarea-b').boundingBox();
		expect(boxA).not.toBeNull();
		expect(boxB).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: 直前でnullチェック済み
		expect(boxA!.height).toBe(boxB!.height);
	});
});
