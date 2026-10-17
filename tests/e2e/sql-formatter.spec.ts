import { expect, test } from './fixtures/base';

test.describe('SQL Formatter Tool', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('sql-formatter');
		await toolPage.goto();
	});

	test('should load the page correctly', async ({ page }) => {
		await expect(page).toHaveTitle('SQL整形・フォーマッター | CODE:LIFE Tools');
		await expect(
			page.getByRole('heading', { name: 'SQL整形・フォーマッター' }),
		).toBeVisible();
	});

	test('should format SQL with default options (2 spaces, uppercase)', async ({
		page,
	}) => {
		const input = 'select id, name from users where status = 1';
		await page.locator('textarea').fill(input);

		await expect(page.locator('.shimmer code')).toContainText(
			'SELECT\n  id,\n  name\nFROM\n  users\nWHERE\n  status = 1',
		);
	});

	test('should disable uppercase when toggled off', async ({ page }) => {
		const input = 'select id from test';
		await page.locator('textarea').fill(input);

		// wait for format
		await expect(page.locator('.shimmer code')).toContainText(
			'SELECT\n  id\nFROM\n  test',
		);

		// Toggle uppercase off
		await page.getByLabel('大文字化').click();

		await expect(page.locator('.shimmer code')).toContainText(
			'select\n  id\nfrom\n  test',
		);
	});

	test('should compress SQL to a single line', async ({ page }) => {
		const input = 'SELECT\n  id,\n  name\nFROM\n  users\nWHERE\n  status = 1;';
		await page.locator('textarea').fill(input);

		// wait for format
		await expect(page.locator('.shimmer code')).toContainText('SELECT');

		// Toggle compress on
		await page.getByLabel('圧縮 (1行化)').click();

		// Inner text of compressed should be single line
		await expect(page.locator('.shimmer code')).toContainText(
			'SELECT id, name FROM users WHERE status = 1;',
		);
	});

	test('should handle different dialects and indents', async ({ page }) => {
		await page
			.locator('textarea')
			.fill('SELECT * FROM users LIMIT 10 OFFSET 0');
		await expect(page.locator('.shimmer code')).toContainText(
			'SELECT\n  *\nFROM\n  users',
		);

		// Change dialect to PostgreSQL
		await page.getByRole('combobox').first().click();
		await page.getByRole('option', { name: 'PostgreSQL' }).click();

		// Change indent to Tabs
		await page.getByRole('combobox').nth(1).click();
		await page.getByRole('option', { name: 'Tabs' }).click();

		await expect(page.locator('.shimmer code')).toContainText(
			'SELECT\n\t*\nFROM\n\tusers',
		);
	});

	test('should clear the input when clear button is clicked', async ({
		page,
	}) => {
		await page.locator('textarea').fill('SELECT * FROM users');
		await expect(page.locator('.shimmer code')).toBeVisible();

		// Click clear
		await page.getByRole('button', { name: 'クリア' }).click();

		// Check if textarea is empty
		await expect(page.locator('textarea')).toBeEmpty();

		// Check if output is back to placeholder text
		await expect(
			page.getByText('左側（または上）にSQLを入力すると'),
		).toBeVisible();
	});

	test('input frame (wrapper) allows vertical resize with min/max height on desktop', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });

		// 高さの責務は入力外枠（data-resize="vertical"）に一本化されている
		const inputFrame = page.locator('#line-numbers').locator('xpath=..');
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
		const inputArea = page.locator('textarea');
		const textareaResize = await inputArea.evaluate(
			(el) => getComputedStyle(el).resize,
		);
		expect(textareaResize).toBe('none');
	});

	test('input frame disables resize on mobile viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });

		const inputFrame = page.locator('#line-numbers').locator('xpath=..');
		const resize = await inputFrame.evaluate(
			(el) => getComputedStyle(el).resize,
		);
		expect(resize).toBe('none');
	});

	test('input frame, gutter, and textarea heights stay in sync as line count grows', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });

		const inputFrame = page.locator('#line-numbers').locator('xpath=..');
		const gutter = page.locator('#line-numbers');
		const inputArea = page.locator('textarea');

		// ブラウザのボーダー計算・サブピクセル丸めによる数px程度の誤差は許容する
		const HEIGHT_TOLERANCE_PX = 3;

		const initialFrameBox = await inputFrame.boundingBox();
		expect(initialFrameBox).not.toBeNull();
		const initialFrameHeight = initialFrameBox?.height ?? Number.NaN;

		for (const lineCount of [10, 30, 100]) {
			await inputArea.fill(
				Array.from({ length: lineCount }, (_, i) => `-- line ${i}`).join('\n'),
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

	test('restores full-size layout from a shared settings URL', async ({
		page,
		context,
		browser,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);

		const container = page.locator('#tool-layout-container');
		await expect(container).not.toHaveClass(/max-w-full/);

		// Enable full-size mode and copy the share URL
		await page.getByRole('button', { name: 'フルサイズ' }).click();
		await expect(container).toHaveClass(/max-w-full/);

		await page.getByRole('button', { name: '設定を共有' }).click();
		const shareUrl = await page.evaluate(() => navigator.clipboard.readText());

		// localStorage を共有しない完全に新しいコンテキストで開き、
		// フルサイズ状態が URL のみから復元されることを検証する
		const freshContext = await browser.newContext({
			viewport: { width: 1280, height: 900 },
		});
		const newPage = await freshContext.newPage();
		await newPage.goto(shareUrl);
		await expect(newPage.locator('#tool-layout-container')).toHaveClass(
			/max-w-full/,
		);
		await freshContext.close();
	});

	test('keeps standard-width layout from a shared settings URL', async ({
		page,
		context,
		browser,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);

		// フルサイズを有効化せずに共有 URL を生成する（isExpanded: false）
		await page.getByRole('button', { name: '設定を共有' }).click();
		const shareUrl = await page.evaluate(() => navigator.clipboard.readText());

		const freshContext = await browser.newContext({
			viewport: { width: 1280, height: 900 },
		});
		const newPage = await freshContext.newPage();
		await newPage.goto(shareUrl);
		const newContainer = newPage.locator('#tool-layout-container');
		await expect(newContainer).not.toHaveClass(/max-w-full/);
		await expect(newContainer).toHaveClass(/max-w-\[800px\]/);
		await expect(newContainer).toHaveClass(/xl:max-w-5xl/);
		await freshContext.close();
	});
});

test.describe('SQL Formatter Tool - レイアウト切替と出力欄リサイズ', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('sql-formatter');
		await toolPage.goto();
	});

	test('初期状態は左右レイアウトで、左右トグルが選択されている', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });

		const panels = page.locator('#sql-formatter-panels');
		await expect(panels).toHaveClass(/lg:grid-cols-2/);
		await expect(
			page.getByRole('radio', { name: '左右に並べて表示' }),
		).toHaveAttribute('aria-checked', 'true');
		await expect(
			page.getByRole('radio', { name: '上下に並べて表示' }),
		).toHaveAttribute('aria-checked', 'false');
	});

	test('上下レイアウトに切り替えると入力・出力が全幅で縦に並ぶ', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });

		await page.getByRole('radio', { name: '上下に並べて表示' }).click();
		await page.locator('textarea').fill('select id from users');
		await expect(page.locator('.shimmer code')).toBeVisible();

		const panels = page.locator('#sql-formatter-panels');
		await expect(panels).not.toHaveClass(/lg:grid-cols-2/);
		await expect(
			page.getByRole('radio', { name: '上下に並べて表示' }),
		).toHaveAttribute('aria-checked', 'true');

		const panelColumns = page.locator('#sql-formatter-panels > div');
		const inputColumnBox = await panelColumns.nth(0).boundingBox();
		const outputColumnBox = await panelColumns.nth(1).boundingBox();
		expect(inputColumnBox).not.toBeNull();
		expect(outputColumnBox).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: 直前でnullチェック済み
		const widthDiff = Math.abs(inputColumnBox!.width - outputColumnBox!.width);
		expect(widthDiff).toBeLessThan(2);

		// 左右レイアウトへ戻せる
		await page.getByRole('radio', { name: '左右に並べて表示' }).click();
		await expect(panels).toHaveClass(/lg:grid-cols-2/);
	});

	test('標準表示⇔フルサイズ表示を切り替えてもレイアウト選択が維持される', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });

		await page.getByRole('radio', { name: '上下に並べて表示' }).click();
		await page.getByRole('button', { name: 'フルサイズ' }).click();

		const panels = page.locator('#sql-formatter-panels');
		await expect(panels).not.toHaveClass(/lg:grid-cols-2/);
		await expect(
			page.getByRole('radio', { name: '上下に並べて表示' }),
		).toHaveAttribute('aria-checked', 'true');

		await page.getByRole('button', { name: '標準幅' }).click();
		await expect(panels).not.toHaveClass(/lg:grid-cols-2/);
		await expect(
			page.getByRole('radio', { name: '上下に並べて表示' }),
		).toHaveAttribute('aria-checked', 'true');
	});

	test('狭い画面ではレイアウト切替を表示せず、常に縦積みでページの横スクロールが発生しない', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });

		await expect(
			page.getByRole('radio', { name: '左右に並べて表示' }),
		).toBeHidden();

		await page
			.locator('textarea')
			.fill(
				'select a_very_long_column_name_that_could_overflow, another_long_identifier_name from a_table_with_a_long_name',
			);
		await expect(page.locator('.shimmer code')).toBeVisible();

		// 読み込みとフォントの準備が完了し、レイアウトが反映されてから計測する
		await page.waitForLoadState('load');
		await page.evaluate(async () => {
			await document.fonts.ready;
			await new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			});
		});

		// 数px程度の誤差はスクロールバー計算のブラウザ差異として許容する
		try {
			await expect
				.poll(
					() =>
						page.evaluate(
							() =>
								document.documentElement.scrollWidth -
								document.documentElement.clientWidth,
						),
					{
						timeout: 5000,
						intervals: [100, 250, 500],
						message: '狭い画面でページの横方向のはみ出しが5px以内になる',
					},
				)
				.toBeLessThanOrEqual(5);
		} catch (error) {
			try {
				const overflowingElements = await page.evaluate(() => {
					const { clientWidth, scrollWidth } = document.documentElement;
					return Array.from(document.querySelectorAll('*'))
						.map((element) => {
							const { width, right } = element.getBoundingClientRect();
							const id = element.id ? `#${CSS.escape(element.id)}` : '';
							const classes = Array.from(element.classList)
								.slice(0, 3)
								.map((name) => `.${CSS.escape(name)}`)
								.join('');
							return {
								selector: `${element.tagName.toLowerCase()}${id}${classes}`,
								width,
								right,
								clientWidth,
								scrollWidth,
							};
						})
						.filter(({ right }) => right > clientWidth)
						.sort((a, b) => b.right - a.right)
						.slice(0, 20);
				});
				console.log('横方向にはみ出している要素:', overflowingElements);
			} catch (diagnosticError) {
				console.log('はみ出し要素の診断に失敗:', diagnosticError);
			}
			throw error;
		}
	});

	test('不正なレイアウト設定値を共有URLから読み込んでも左右レイアウトへフォールバックする', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });

		const invalidSettingsUrl = await page.evaluate(() => {
			const encoded = btoa(
				unescape(encodeURIComponent(JSON.stringify({ layout: 'diagonal' }))),
			);
			const url = new URL(window.location.href);
			url.searchParams.set('settings', encoded);
			return url.toString();
		});

		await page.goto(invalidSettingsUrl);

		const panels = page.locator('#sql-formatter-panels');
		await expect(panels).toHaveClass(/lg:grid-cols-2/);
		await expect(
			page.getByRole('radio', { name: '左右に並べて表示' }),
		).toHaveAttribute('aria-checked', 'true');
	});

	test('出力欄はデスクトップで縦方向にリサイズでき、最小値・最大値の範囲を持つ', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });

		await page.locator('textarea').fill('select id from users');
		await expect(page.locator('.shimmer code')).toBeVisible();

		const outputBox = page.locator('.shimmer');
		const style = await outputBox.evaluate((el) => {
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

		await expect(
			page.locator('[data-slot="codeblock-resize-handle"]'),
		).toBeVisible();
	});

	test('出力欄はモバイル幅ではリサイズもグリップも無効になる', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });

		await page.locator('textarea').fill('select id from users');
		await expect(page.locator('.shimmer code')).toBeVisible();

		const resize = await page
			.locator('.shimmer')
			.evaluate((el) => getComputedStyle(el).resize);
		expect(resize).toBe('none');

		await expect(
			page.locator('[data-slot="codeblock-resize-handle"]'),
		).toBeHidden();
	});
});
