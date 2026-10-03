import { expect, test } from './fixtures/base';

test.describe('Dummy Data Generator Tool', () => {
	test('should load the page correctly', async ({ createToolPage }) => {
		const toolPage = createToolPage('dummy-data');
		await toolPage.goto();
		await toolPage.expectTitle('ダミーデータ生成（日本語） | CODE:LIFE Tools');
		await toolPage.expectSafetyBadge();
	});

	test('should generate dummy data and switch formats', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('dummy-data');
		await toolPage.goto();

		// 1. Check if the default preview data is generated in JSON
		const previewContainer = page.locator('pre');
		await expect(previewContainer).toBeVisible();
		await expect(previewContainer).toContainText('"name"');

		// 2. Change count to 5
		const countInput = page.locator('input[type="number"]');
		await countInput.fill('5');

		// 3. Switch format to CSV
		await page.getByRole('tab', { name: 'CSV' }).click();

		// 4. Verify output changes to CSV layout (Japanese header, no JSON quoting)
		await expect(previewContainer).toContainText('氏名');
		await expect(previewContainer).not.toContainText('"name"');
	});
	test('TSV出力の1行目も日本語ラベルになる', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('dummy-data');
		await toolPage.goto();

		const previewContainer = page.locator('pre');
		await expect(previewContainer).toBeVisible();

		await page.getByRole('tab', { name: 'TSV' }).click();

		await expect(previewContainer).toContainText('氏名');
		await expect(previewContainer).not.toContainText('"name"');
		const headerLine = (await previewContainer.textContent())
			?.split('\n')[0]
			?.trim();
		expect(headerLine).not.toContain('name');
	});

	test('形式切替(JSON→CSV→TSV→JSON)ではレコードが再生成されない', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('dummy-data');
		await toolPage.goto();

		const previewContainer = page.locator('pre');
		await expect(previewContainer).toBeVisible();
		await expect(previewContainer).toContainText('"name"');
		const jsonBefore = await previewContainer.textContent();
		const emails = [
			...(jsonBefore ?? '').matchAll(/[a-z]+\.[a-z]+@[a-z.]+/g),
		].map((m) => m[0]);
		expect(emails.length).toBeGreaterThan(0);

		await page.getByRole('tab', { name: 'CSV' }).click();
		await expect(previewContainer).toContainText('氏名');
		const csvText = await previewContainer.textContent();
		for (const email of emails) {
			expect(csvText).toContain(email);
		}

		await page.getByRole('tab', { name: 'TSV' }).click();
		await expect(previewContainer).toContainText('氏名');
		const tsvText = await previewContainer.textContent();
		for (const email of emails) {
			expect(tsvText).toContain(email);
		}

		await page.getByRole('tab', { name: 'JSON' }).click();
		await expect(previewContainer).toContainText('"name"');
		const jsonAfter = await previewContainer.textContent();
		expect(jsonAfter).toEqual(jsonBefore);
	});

	test('同一設定の再生成クリックで出力が変わる', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('dummy-data');
		await toolPage.goto();

		const previewContainer = page.locator('pre');
		await expect(previewContainer).toBeVisible();
		const before = await previewContainer.textContent();

		await page.getByRole('button', { name: '再生成' }).click();
		await expect
			.poll(async () => previewContainer.textContent())
			.not.toEqual(before);
	});
});
