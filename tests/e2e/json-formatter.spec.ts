import { expect, test } from './fixtures/base';

test.describe('JSON Formatter', () => {
	test('loads page and shows format UI', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();

		// Verify key UI elements are present
		await expect(page.getByRole('textbox').first()).toBeVisible();
		await expect(page.getByRole('button', { name: /整形/ })).toBeVisible();
	});

	test('should format valid JSON and show error for invalid JSON', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();

		// 1. Input valid JSON
		const inputArea = page.getByRole('textbox').first();
		await inputArea.fill('{"a":1,"b":"hello"}');

		// Verify output is formatted (should contain newline and indentation)
		const outputContainer = page.locator('pre');
		await expect(outputContainer).toContainText('"a": 1');
		await expect(outputContainer).toContainText('"b": "hello"');

		// 2. Input invalid JSON
		await inputArea.fill('{"a":1');

		// Verify error banner is visible
		const errorBanner = page.locator('.bg-destructive\\/10');
		await expect(errorBanner).toBeVisible();
		await expect(errorBanner).toContainText('エラー');
	});

	test('空欄で整形・圧縮を実行すると入力を促す案内を表示し、入力すると消える', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();

		const inputArea = page.locator('#json-input-textarea');
		// プレースホルダーは例であることが分かる表記にする
		await expect(inputArea).toHaveAttribute('placeholder', /^例: /);
		await expect(inputArea).toHaveValue('');

		const notice = page
			.getByRole('status')
			.filter({ hasText: 'JSONを入力してください' });
		await expect(notice).toHaveCount(0);

		await page.getByRole('button', { name: '整形' }).click();
		await expect(notice).toBeVisible();
		await expect(notice).toContainText('プレースホルダー');
		// エラー扱いにはしない
		await expect(page.locator('.bg-destructive\\/10')).toHaveCount(0);

		// 空白だけの入力も空欄として扱う
		await inputArea.fill('   ');
		await expect(notice).toHaveCount(0);
		await page.getByRole('button', { name: '圧縮' }).click();
		await expect(notice).toBeVisible();

		await inputArea.fill('{"a":1}');
		await expect(notice).toHaveCount(0);
		await page.getByRole('button', { name: '整形' }).click();
		await expect(notice).toHaveCount(0);
		await expect(page.locator('pre')).toContainText('"a": 1');
	});

	test('input frame (wrapper) allows vertical resize with min/max height on desktop', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		// 高さの責務は入力外枠（data-resize="vertical"）に一本化されている
		const inputFrame = page
			.locator('#json-input-line-numbers')
			.locator('xpath=..');
		const style = await inputFrame.evaluate((el) => {
			const computed = getComputedStyle(el);
			return {
				resize: computed.resize,
				minHeight: computed.minHeight,
				maxHeight: computed.maxHeight,
			};
		});

		expect(style.resize).toBe('vertical');
		expect(style.minHeight).toBe('240px');
		// 80dvh はビューポート高さ 900px の80% = 720px
		expect(style.maxHeight).toBe('720px');

		// textarea本体は二重の高さ責務を持たないよう、自身の縦リサイズは無効化されている
		const inputArea = page.locator('#json-input-textarea');
		const textareaResize = await inputArea.evaluate(
			(el) => getComputedStyle(el).resize,
		);
		expect(textareaResize).toBe('none');
	});

	test('input frame disables resize on mobile viewport', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await page.setViewportSize({ width: 390, height: 844 });
		await toolPage.goto();

		const inputFrame = page
			.locator('#json-input-line-numbers')
			.locator('xpath=..');
		const resize = await inputFrame.evaluate(
			(el) => getComputedStyle(el).resize,
		);
		expect(resize).toBe('none');
	});

	test('input frame, gutter, and textarea heights stay in sync as line count grows', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		const inputFrame = page
			.locator('#json-input-line-numbers')
			.locator('xpath=..');
		const gutter = page.locator('#json-input-line-numbers');
		const inputArea = page.locator('#json-input-textarea');

		// ブラウザのボーダー計算・サブピクセル丸めによる数px程度の誤差は許容する
		const HEIGHT_TOLERANCE_PX = 3;

		const initialFrameBox = await inputFrame.boundingBox();
		expect(initialFrameBox).not.toBeNull();
		const initialFrameHeight = initialFrameBox?.height ?? Number.NaN;

		for (const lineCount of [10, 30, 100]) {
			await inputArea.fill(
				Array.from({ length: lineCount }, (_, i) => `line ${i}`).join('\n'),
			);

			const frameBox = await inputFrame.boundingBox();
			const gutterBox = await gutter.boundingBox();
			const textareaBox = await inputArea.boundingBox();
			expect(frameBox).not.toBeNull();
			expect(gutterBox).not.toBeNull();
			expect(textareaBox).not.toBeNull();

			const frameHeight = frameBox?.height ?? Number.NaN;
			const gutterHeight = gutterBox?.height ?? Number.NaN;
			const textareaHeight = textareaBox?.height ?? Number.NaN;

			expect(Math.abs(frameHeight - gutterHeight)).toBeLessThanOrEqual(
				HEIGHT_TOLERANCE_PX,
			);
			expect(Math.abs(frameHeight - textareaHeight)).toBeLessThanOrEqual(
				HEIGHT_TOLERANCE_PX,
			);

			// 行数が増えても外枠は自動拡張せず、初期高さ付近を維持する（内部スクロールになる）
			expect(Math.abs(frameHeight - initialFrameHeight)).toBeLessThanOrEqual(
				HEIGHT_TOLERANCE_PX,
			);
		}
	});

	test('scrolling the textarea keeps the line-number gutter in sync', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		const inputArea = page.locator('#json-input-textarea');
		await inputArea.fill(
			Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'),
		);

		await inputArea.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await expect(async () => {
			const [textareaScrollTop, gutterScrollTop] = await page.evaluate(() => {
				const textarea = document.getElementById(
					'json-input-textarea',
				) as HTMLTextAreaElement;
				const gutter = document.getElementById('json-input-line-numbers');
				return [textarea?.scrollTop, gutter?.scrollTop];
			});
			expect(gutterScrollTop).toBe(textareaScrollTop);
		}).toPass();
	});

	test('output placeholder textarea allows vertical resize with min/max height on desktop', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		// 未入力状態では読み取り専用のプレースホルダーtextareaが出力欄として表示される
		const outputArea = page.getByPlaceholder('整形結果がここに表示されます...');
		const style = await outputArea.evaluate((el) => {
			const computed = getComputedStyle(el);
			return {
				resize: computed.resize,
				minHeight: computed.minHeight,
				maxHeight: computed.maxHeight,
			};
		});

		expect(style.resize).toBe('vertical');
		expect(style.minHeight).toBe('240px');
		// 80dvh はビューポート高さ 900px の80% = 720px
		expect(style.maxHeight).toBe('720px');
	});

	test('output placeholder textarea disables resize on mobile viewport', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await page.setViewportSize({ width: 390, height: 844 });
		await toolPage.goto();

		const outputArea = page.getByPlaceholder('整形結果がここに表示されます...');
		const resize = await outputArea.evaluate(
			(el) => getComputedStyle(el).resize,
		);
		expect(resize).toBe('none');
	});
});
