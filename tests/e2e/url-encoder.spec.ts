import { expect, test } from './fixtures/base';

test.describe('URL Encoder Tool', () => {
	for (const width of [375, 768, 1280]) {
		test(`keeps modes within the viewport at ${width}px`, async ({
			page,
			createToolPage,
		}, testInfo) => {
			await page.setViewportSize({ width, height: 900 });
			await createToolPage('url-encoder').goto();
			const assertLayout = async (stage: string) => {
				const layout = await page.evaluate(() => ({
					viewport: document.documentElement.clientWidth,
					scrollWidth: document.documentElement.scrollWidth,
					tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => {
						const { left, right, top } = tab.getBoundingClientRect();
						return {
							left,
							right,
							top,
							scrollWidth: tab.scrollWidth,
							clientWidth: tab.clientWidth,
						};
					}),
				}));
				await testInfo.attach(stage, {
					body: JSON.stringify(layout),
					contentType: 'application/json',
				});
				expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
				for (const tab of layout.tabs) {
					expect(tab.left).toBeGreaterThanOrEqual(0);
					expect(tab.right).toBeLessThanOrEqual(layout.viewport);
					expect(tab.scrollWidth).toBeLessThanOrEqual(tab.clientWidth + 1);
				}
				expect(layout.tabs).toHaveLength(2);
				expect(layout.tabs[0].top).toBe(layout.tabs[1].top);
				expect(layout.tabs[0].right).toBeLessThanOrEqual(layout.tabs[1].left);
				await expect(page.getByRole('tablist')).toHaveAttribute(
					'aria-orientation',
					'horizontal',
				);
			};
			await assertLayout('empty');
			await page.reload();
			await expect(
				page.locator('astro-island[ssr][client="load"]'),
			).toHaveCount(0);
			await assertLayout('reloaded');
			const input = page.getByRole('textbox').first();
			const output = page.getByRole('textbox').nth(1);
			await page.getByRole('switch').click();
			await input.fill('https://example.com/東京?q=天気');
			await expect(output).toHaveValue(
				'https%3A%2F%2Fexample.com%2F%E6%9D%B1%E4%BA%AC%3Fq%3D%E5%A4%A9%E6%B0%97',
			);
			const componentTab = page.getByRole('tab', {
				name: 'コンポーネント (encodeURIComponent)',
			});
			const fullTab = page.getByRole('tab', { name: 'フルURL (encodeURI)' });
			await componentTab.focus();
			await componentTab.press('ArrowRight');
			await expect(fullTab).toBeFocused();
			await expect(fullTab).toHaveAttribute('aria-selected', 'true');
			await expect(output).toHaveValue(
				'https://example.com/%E6%9D%B1%E4%BA%AC?q=%E5%A4%A9%E6%B0%97',
			);
			await assertLayout('full-url');
			await fullTab.press('ArrowLeft');
			await expect(componentTab).toBeFocused();
			await expect(componentTab).toHaveAttribute('aria-selected', 'true');
			await expect(output).toHaveValue(
				'https%3A%2F%2Fexample.com%2F%E6%9D%B1%E4%BA%AC%3Fq%3D%E5%A4%A9%E6%B0%97',
			);
			await assertLayout('component');
			await testInfo.attach('layout', {
				body: await page.screenshot(),
				contentType: 'image/png',
			});
		});
	}
	test('should load the page correctly', async ({ createToolPage }) => {
		const toolPage = createToolPage('url-encoder');
		await toolPage.goto();
		await toolPage.expectTitle('URLエンコード / デコード | CODE:LIFE Tools');
		await toolPage.expectSafetyBadge();
	});

	test('should encode and decode values correctly', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('url-encoder');
		await toolPage.goto();

		// textareas: first is input, second is output
		const inputArea = page.getByRole('textbox').first();
		const outputArea = page.getByRole('textbox').nth(1);

		// 1. test component mode decoding (default)
		await inputArea.fill(
			'https%3A%2F%2Fexample.com%2F%E6%A4%9C%E7%B4%A2%3Fq%3D%E6%9D%B1%E4%BA%AC%20%E5%A4%A9%E6%B0%97',
		);
		await expect(outputArea).toHaveValue(
			'https://example.com/検索?q=東京 天気',
		);

		// test space handled via '+'
		await inputArea.fill('%E6%9D%B1%E4%BA%AC+%E5%A4%A9%E6%B0%97');
		await expect(outputArea).toHaveValue('東京 天気');

		// 2. switch direction to encode
		await page.getByRole('switch').click();

		// test component mode encoding
		await inputArea.fill('https://example.com/検索?q=東京 天気');
		await expect(outputArea).toHaveValue(
			'https%3A%2F%2Fexample.com%2F%E6%A4%9C%E7%B4%A2%3Fq%3D%E6%9D%B1%E4%BA%AC%20%E5%A4%A9%E6%B0%97',
		);

		// test full url mode encoding
		await page.getByRole('tab', { name: 'フルURL (encodeURI)' }).press('Enter');
		await expect(outputArea).toHaveValue(
			'https://example.com/%E6%A4%9C%E7%B4%A2?q=%E6%9D%B1%E4%BA%AC%20%E5%A4%A9%E6%B0%97',
		);
	});
});
