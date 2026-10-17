import { expect, test } from './fixtures/base';

test.describe('twitter:image', () => {
	test('トップページの twitter:image は og:image と一致しサイト共通画像の絶対URLを指す', async ({
		page,
	}) => {
		await page.goto('/');
		const ogImage = page.locator('meta[property="og:image"]');
		const twitterImage = page.locator('meta[name="twitter:image"]');
		await expect(twitterImage).toHaveAttribute(
			'content',
			'https://tools.codelife.cafe/og-image.png',
		);
		const twitterImageContent = await twitterImage.getAttribute('content');
		expect(twitterImageContent).not.toBeNull();
		await expect(ogImage).toHaveAttribute(
			'content',
			twitterImageContent as string,
		);
	});

	test('/hash/ の twitter:image はツール別OG画像で og:image と一致する', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('hash');
		await toolPage.goto();
		const ogImage = page.locator('meta[property="og:image"]');
		const twitterImage = page.locator('meta[name="twitter:image"]');
		await expect(twitterImage).toHaveAttribute(
			'content',
			'https://tools.codelife.cafe/og/hash.png',
		);
		const twitterImageContent = await twitterImage.getAttribute('content');
		expect(twitterImageContent).not.toBeNull();
		await expect(ogImage).toHaveAttribute(
			'content',
			twitterImageContent as string,
		);
	});
});

test.describe('meta description の字数', () => {
	for (const path of ['/', '/zipcode/', '/tax/']) {
		test(`${path} の meta description は80字以上120字以下`, async ({
			page,
		}) => {
			await page.goto(path);
			const description = await page
				.locator('meta[name="description"]')
				.getAttribute('content');
			expect(description).not.toBeNull();
			const length = description?.length ?? 0;
			expect(length).toBeGreaterThanOrEqual(80);
			expect(length).toBeLessThanOrEqual(120);
		});
	}
});

test.describe('EXIF / 画像メタデータ削除 の相互リンク', () => {
	test('/exif/ の関連ツールに /image-metadata/ へのリンクがある', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('exif');
		await toolPage.goto();
		const related = page.locator(
			'section[aria-labelledby="related-tools-heading"]',
		);
		await expect(related.locator('a[href="/image-metadata/"]')).toHaveCount(1);
	});

	test('/image-metadata/ の関連ツールに /exif/ へのリンクがある', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('image-metadata');
		await toolPage.goto();
		const related = page.locator(
			'section[aria-labelledby="related-tools-heading"]',
		);
		await expect(related.locator('a[href="/exif/"]')).toHaveCount(1);
	});
});
