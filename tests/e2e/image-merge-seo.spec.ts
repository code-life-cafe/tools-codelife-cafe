import { expect, test } from './fixtures/base';

test.describe('/image-merge/ のSEOメタデータ・コンテンツ', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('image-merge');
		await toolPage.goto();
	});

	test('<title> が「画像結合」で始まる', async ({ page }) => {
		const title = await page.title();
		expect(title.startsWith('画像結合')).toBe(true);
	});

	test('meta description は80〜120字で「画像結合」を含む', async ({ page }) => {
		const description = await page
			.locator('meta[name="description"]')
			.getAttribute('content');
		expect(description).not.toBeNull();
		const length = description?.length ?? 0;
		expect(length).toBeGreaterThanOrEqual(80);
		expect(length).toBeLessThanOrEqual(120);
		expect(description).toContain('画像結合');
	});

	test('H1 は「画像結合」', async ({ page }) => {
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'画像結合',
		);
	});

	test('使い方・手順に縦・横・グリッドの説明がある', async ({ page }) => {
		const howto = page.locator('section[aria-labelledby="howto-heading"]');
		await expect(howto).toContainText('縦に連結');
		await expect(howto).toContainText('横に連結');
		await expect(howto).toContainText('グリッド');
	});

	test('FAQに枚数上限・出力形式・スマホ対応・画質の項目がある', async ({
		page,
	}) => {
		const faq = page.locator('section[aria-labelledby="faq-heading"]');
		await expect(faq).toContainText('30枚');
		await expect(faq).toContainText('出力形式');
		await expect(faq).toContainText('スマホ');
		await expect(faq).toContainText('画質');
	});

	test('関連ツールに画像圧縮・画像変換・画像編集へのリンクがある', async ({
		page,
	}) => {
		const related = page.locator(
			'section[aria-labelledby="related-tools-heading"]',
		);
		await expect(related.locator('a[href="/image-compress/"]')).toHaveCount(1);
		await expect(related.locator('a[href="/image-convert/"]')).toHaveCount(1);
		await expect(related.locator('a[href="/image-edit/"]')).toHaveCount(1);
	});
});
