import { expect, test } from './fixtures/base';

test.describe('Personal Info Masking Tool', () => {
	test('should load the page correctly', async ({ createToolPage }) => {
		const toolPage = createToolPage('masking');
		await toolPage.goto();
		await toolPage.expectTitle('個人情報マスキング | CODE:LIFE Tools');
		await toolPage.expectSafetyBadge();
	});

	test('should mask personal information automatically', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('masking');
		await toolPage.goto();

		// 1. Fill personal info in the input textbox
		const textareas = page.getByRole('textbox');
		await textareas
			.first()
			.fill(
				'私のメールは test@example.com です。電話番号は 090-1234-5678 です。',
			);

		// 2. Check if output textbox contains masked values
		await expect(textareas.last()).toContainText('***');
		await expect(textareas.last()).not.toContainText('test@example.com');
		await expect(textareas.last()).not.toContainText('090-1234-5678');
	});

	test('input and output textareas allow vertical resize with min/max height on desktop', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('masking');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		for (const id of ['#masking-input-textarea', '#masking-output-textarea']) {
			const textarea = page.locator(id);
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
		}
	});

	test('input and output textareas disable resize on mobile viewport', async ({
		page,
		createToolPage,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const toolPage = createToolPage('masking');
		await toolPage.goto();

		for (const id of ['#masking-input-textarea', '#masking-output-textarea']) {
			const resize = await page
				.locator(id)
				.evaluate((el) => getComputedStyle(el).resize);
			expect(resize).toBe('none');
		}
	});

	test('input textarea keeps a fixed height on mobile even with long content', async ({
		page,
		createToolPage,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const toolPage = createToolPage('masking');
		await toolPage.goto();

		const textarea = page.locator('#masking-input-textarea');
		const heightBefore = await textarea.evaluate((el) => el.clientHeight);

		await textarea.fill(
			Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n'),
		);

		const heightAfter = await textarea.evaluate((el) => el.clientHeight);
		expect(heightAfter).toBe(heightBefore);
	});
});

test.describe('Personal Info Masking Tool - FAQとUIの整合', () => {
	test('FAQの記号の説明が実際のマスク文字の選択肢と一致する', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('masking');
		await toolPage.goto();

		// 実UIの選択肢は * と ● の2つだけ
		await page.getByRole('combobox').first().click();
		const options = page.getByRole('option');
		await expect(options).toHaveCount(2);
		await expect(options.nth(0)).toContainText('*');
		await expect(options.nth(1)).toContainText('●');
		await page.keyboard.press('Escape');

		// 対象のFAQ回答が2択と任意文字列の指定不可を明示する
		const faqAnswer = page
			.locator('section[aria-labelledby="faq-heading"] dl > div')
			.filter({
				has: page.locator('dt', {
					hasText: 'マスキングに使用する記号を変更できますか？',
				}),
			})
			.locator('dd');
		await expect(faqAnswer).toHaveCount(1);
		await expect(faqAnswer).toHaveText(
			'はい。「マスク文字」の設定から * （アスタリスク）と ●（黒丸）のいずれかを選べます。それ以外の記号や [MASK] のような任意の文字列は、現在は指定できません。',
		);
	});
});
