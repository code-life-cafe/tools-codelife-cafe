import { expect, test } from './fixtures/base';

test.describe('URL Encoder Tool', () => {
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
		await page.getByRole('tab', { name: 'フルURL (encodeURI)' }).click();
		await expect(outputArea).toHaveValue(
			'https://example.com/%E6%A4%9C%E7%B4%A2?q=%E6%9D%B1%E4%BA%AC%20%E5%A4%A9%E6%B0%97',
		);
	});
});
