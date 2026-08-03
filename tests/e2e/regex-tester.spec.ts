import { expect, test } from './fixtures/base';

test.describe('Regex Tester Tool', () => {
	test('should load the page correctly', async ({ createToolPage }) => {
		const toolPage = createToolPage('regex-tester');
		await toolPage.goto();
		await toolPage.expectTitle('正規表現テスター | CODE:LIFE Tools');
		await toolPage.expectSafetyBadge();
	});

	test('should display regex matches and handle pattern changes', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('regex-tester');
		await toolPage.goto();

		// 1. Verify default match count (2 matches for \d{3}-\d{4} on default text)
		const matchCount = page.locator('.text-4xl.font-bold');
		await expect(matchCount).toHaveText('2');

		// 2. Change pattern to \d+
		const patternInput = page.locator('input').first();
		await patternInput.fill('\\d+');

		// 3. Verify match count updates to 4 (100, 0001, 530, 0001)
		await expect(matchCount).toHaveText('4');
	});

	test('replace output textarea allows vertical resize with min/max height on desktop', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('regex-tester');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		// 置換結果欄は行番号ガターを持たないため、textarea本体が引き続き縦リサイズを担う
		const textarea = page.locator('#regex-replace-output-textarea');
		const style = await textarea.evaluate((el) => {
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

	test('test string frame (wrapper) allows vertical resize with min/max height on desktop', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('regex-tester');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		// 高さの責務は入力外枠（data-resize="vertical"）に一本化されている
		const inputFrame = page.locator('#regex-line-numbers').locator('xpath=..');
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
		const textareaResize = await page
			.locator('#regex-test-string-textarea')
			.evaluate((el) => getComputedStyle(el).resize);
		expect(textareaResize).toBe('none');
	});

	test('test string and replace textareas disable resize on mobile viewport', async ({
		page,
		createToolPage,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const toolPage = createToolPage('regex-tester');
		await toolPage.goto();

		const testStringFrame = page
			.locator('#regex-line-numbers')
			.locator('xpath=..');
		expect(
			await testStringFrame.evaluate((el) => getComputedStyle(el).resize),
		).toBe('none');

		const replaceResize = await page
			.locator('#regex-replace-output-textarea')
			.evaluate((el) => getComputedStyle(el).resize);
		expect(replaceResize).toBe('none');
	});

	test('test string textarea keeps a fixed height on mobile even with long content', async ({
		page,
		createToolPage,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const toolPage = createToolPage('regex-tester');
		await toolPage.goto();

		const textarea = page.locator('#regex-test-string-textarea');
		const heightBefore = await textarea.evaluate((el) => el.clientHeight);

		await textarea.fill(
			Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n'),
		);

		const heightAfter = await textarea.evaluate((el) => el.clientHeight);
		expect(heightAfter).toBe(heightBefore);
	});

	test('test string frame, gutter, and textarea heights stay in sync as line count grows', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('regex-tester');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		const inputFrame = page.locator('#regex-line-numbers').locator('xpath=..');
		const gutter = page.locator('#regex-line-numbers');
		const textarea = page.locator('#regex-test-string-textarea');

		// ブラウザのボーダー計算・サブピクセル丸めによる数px程度の誤差は許容する
		const HEIGHT_TOLERANCE_PX = 3;

		const initialFrameBox = await inputFrame.boundingBox();
		expect(initialFrameBox).not.toBeNull();
		const initialFrameHeight = initialFrameBox?.height ?? Number.NaN;

		for (const lineCount of [8, 30, 100]) {
			await textarea.fill(
				Array.from({ length: lineCount }, (_, i) => `line ${i}`).join('\n'),
			);

			const frameBox = await inputFrame.boundingBox();
			const gutterBox = await gutter.boundingBox();
			const textareaBox = await textarea.boundingBox();
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

	test('long lines do not wrap, keeping line numbers aligned with text lines', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('regex-tester');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		const textarea = page.locator('#regex-test-string-textarea');
		const overlay = page.locator('#highlight-overlay');
		const gutter = page.locator('#regex-line-numbers');

		const longLine = 'a'.repeat(300);
		await textarea.fill(`${longLine}\nline2`);

		// 折り返しが無効化されている（whitespace: pre）
		expect(
			await textarea.evaluate((el) => getComputedStyle(el).whiteSpace),
		).toBe('pre');
		expect(
			await overlay.evaluate((el) => getComputedStyle(el).whiteSpace),
		).toBe('pre');

		// 折り返されず横スクロールになるため、scrollWidth が可視幅を超える
		const scrollWidth = await textarea.evaluate((el) => el.scrollWidth);
		const clientWidth = await textarea.evaluate((el) => el.clientWidth);
		expect(scrollWidth).toBeGreaterThan(clientWidth);

		// 改行が1個のみなので行番号は1・2の2行分しか生成されない
		await expect(gutter.locator('div', { hasText: /^2$/ })).toHaveCount(1);
	});

	test('horizontal scroll of the textarea stays synced with the highlight overlay', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('regex-tester');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		const textarea = page.locator('#regex-test-string-textarea');
		const overlay = page.locator('#highlight-overlay');

		await textarea.fill('b'.repeat(300));
		await textarea.evaluate((el) => {
			el.scrollLeft = 50;
			el.dispatchEvent(new Event('scroll', { bubbles: true }));
		});

		await expect(async () => {
			const overlayScrollLeft = await overlay.evaluate((el) => el.scrollLeft);
			expect(overlayScrollLeft).toBe(50);
		}).toPass();
	});

	test('horizontal scroll stays aligned with the overlay at the far-right edge even when a vertical scrollbar is present', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('regex-tester');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		const textarea = page.locator('#regex-test-string-textarea');
		const overlay = page.locator('#highlight-overlay');

		// 縦スクロールバーが出るのに十分な行数、かつ横スクロールも発生する長さの行を用意する
		await textarea.fill(
			Array.from({ length: 30 }, (_, i) => `${i}: ${'c'.repeat(300)}`).join(
				'\n',
			),
		);

		// scrollbar-gutter: stable により、縦スクロールバーの有無に関わらず
		// テキストエリアとオーバーレイの実効表示幅（clientWidth）はほぼ一致する。
		// textarea（フォームコントロール）とoverlay（div）はブラウザ内部の
		// サブピクセル丸めが異なるため、数px程度の差は許容する。
		const PIXEL_TOLERANCE_PX = 20;
		const [textareaClientWidth, overlayClientWidth] = await Promise.all([
			textarea.evaluate((el) => el.clientWidth),
			overlay.evaluate((el) => el.clientWidth),
		]);
		expect(
			Math.abs(textareaClientWidth - overlayClientWidth),
		).toBeLessThanOrEqual(PIXEL_TOLERANCE_PX);

		// テキストエリアを横方向の最右端まで移動する
		await textarea.evaluate((el) => {
			el.scrollLeft = el.scrollWidth;
			el.dispatchEvent(new Event('scroll', { bubbles: true }));
		});

		// 検証すべきなのはピクセル完全一致ではなく「テキストエリアが末尾まで
		// スクロールされたら、オーバーレイも自身の末尾付近まで到達し、
		// コンテンツ末尾が大きく見切れない」ことなので、オーバーレイ側が
		// 自身の最大スクロール位置の近傍にあるかを許容誤差付きで見る。
		// evaluate() はブラウザ内で独立実行されるため、外側の定数は
		// 使わずNode側で比較する。
		await expect(async () => {
			const [textareaEndGap, overlayScrollLeft, overlayMaxScrollLeft] =
				await Promise.all([
					textarea.evaluate(
						(el) => el.scrollWidth - (el.scrollLeft + el.clientWidth),
					),
					overlay.evaluate((el) => el.scrollLeft),
					overlay.evaluate((el) => el.scrollWidth - el.clientWidth),
				]);
			expect(textareaEndGap).toBeLessThanOrEqual(PIXEL_TOLERANCE_PX);
			expect(
				Math.abs(overlayScrollLeft - overlayMaxScrollLeft),
			).toBeLessThanOrEqual(PIXEL_TOLERANCE_PX);
		}).toPass();
	});
});
