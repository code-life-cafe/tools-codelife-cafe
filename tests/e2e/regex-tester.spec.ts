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

	test('test string and replace textareas allow vertical resize with min/max height on desktop', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('regex-tester');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		for (const id of [
			'#regex-test-string-textarea',
			'#regex-replace-output-textarea',
		]) {
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

	test('test string and replace textareas disable resize on mobile viewport', async ({
		page,
		createToolPage,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const toolPage = createToolPage('regex-tester');
		await toolPage.goto();

		for (const id of [
			'#regex-test-string-textarea',
			'#regex-replace-output-textarea',
		]) {
			const resize = await page
				.locator(id)
				.evaluate((el) => getComputedStyle(el).resize);
			expect(resize).toBe('none');
		}
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
});
