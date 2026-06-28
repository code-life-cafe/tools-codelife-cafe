import { getCategoryId, toolCatalog } from '../../src/lib/tools/catalog';
import { expect, test } from './fixtures/base';

test.describe('Layout & Navigation', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
	});

	test('Header logo navigates to top', async ({ page }) => {
		// Navigate to a tool page first
		await page.goto('/char-count');

		// Click logo
		await page
			.getByRole('link', { name: /CODE:LIFE/i })
			.first()
			.click();

		// Verify we are back on top page
		await expect(page).toHaveURL(/\/$/);
	});

	test('Dark mode toggle works', async ({ page }) => {
		// Wait for React hydration before interacting with the toggle
		await page.waitForLoadState('networkidle');

		// The dark mode toggle is a button with aria-label 'ダークモードに切替'
		const toggleButton = page.getByRole('button', { name: /モードに切替/i });
		await expect(toggleButton).toBeVisible();

		// Click to switch to dark mode
		await toggleButton.click();

		// After clicking, the html element should have 'dark' class
		await expect(page.locator('html')).toHaveClass(/dark/);

		// The button's aria-label should now contain 'ライト'
		const lightToggle = page.getByRole('button', {
			name: /ライトモードに切替/i,
		});
		await expect(lightToggle).toBeVisible();
	});

	test('Cmd+K Search focuses search input', async ({ page }) => {
		// Wait for React SearchModal component to hydrate by checking for an interactive element
		await page.waitForTimeout(1000);

		// Press Ctrl+K
		await page.keyboard.press('Control+k');

		// Verify search modal/input is visible and focused
		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });
		await expect(searchInput).toBeFocused();
	});

	test('Breadcrumbs are displayed on tool pages', async ({ page }) => {
		await page.goto('/csv-editor');

		const nav = page.getByRole('navigation', { name: 'パンくずリスト' });
		await expect(nav).toBeVisible();

		// ホームリンク
		const homeLink = nav.getByRole('link', { name: 'ホーム' });
		await expect(homeLink).toBeVisible();
		await expect(homeLink).toHaveAttribute('href', '/');

		// カテゴリリンク（/?category=<英語ID> へのリンク。#108 のフィルタ形式と整合）
		const categoryLink = nav.getByRole('link', { name: 'データ処理' });
		await expect(categoryLink).toBeVisible();
		await expect(categoryLink).toHaveAttribute(
			'href',
			`/?category=${getCategoryId('データ処理')}`,
		);

		// 現在ページ（リンクなし、aria-current="page"）
		const current = nav.locator('[aria-current="page"]');
		await expect(current).toHaveText(/^CSVビューア\/エディタ/);
		await expect(
			nav.getByRole('link', { name: /^CSVビューア\/エディタ/ }),
		).toHaveCount(0);
	});

	test('BreadcrumbList JSON-LD is present and valid', async ({ page }) => {
		await page.goto('/csv-editor');

		const jsonLdTexts = await page
			.locator('script[type="application/ld+json"]')
			.allTextContents();
		const breadcrumb = jsonLdTexts
			.map((text) => JSON.parse(text))
			.find((schema) => schema['@type'] === 'BreadcrumbList');

		expect(breadcrumb).toBeTruthy();
		expect(breadcrumb['@context']).toBe('https://schema.org');
		expect(breadcrumb.itemListElement).toHaveLength(3);

		const [home, category, current] = breadcrumb.itemListElement;
		expect(home).toMatchObject({
			'@type': 'ListItem',
			position: 1,
			name: 'ホーム',
			item: 'https://tools.codelife.cafe/',
		});
		expect(category).toMatchObject({
			'@type': 'ListItem',
			position: 2,
			name: 'データ処理',
			item: `https://tools.codelife.cafe/?category=${getCategoryId('データ処理')}`,
		});
		expect(current).toMatchObject({
			'@type': 'ListItem',
			position: 3,
			name: 'CSVビューア/エディタ（Excel取込・フィルタ・グラフ）',
		});
		expect(current.item).toBeUndefined();
	});

	test('パンくずのカテゴリリンクからトップページのフィルタが適用される', async ({
		page,
	}) => {
		// csv-editor は「データ処理」カテゴリ
		const categoryName = 'データ処理';
		const categoryId = getCategoryId(categoryName);
		const categoryCount = toolCatalog.filter(
			(t) => t.category === categoryName,
		).length;

		await page.goto('/csv-editor');

		const nav = page.getByRole('navigation', { name: 'パンくずリスト' });
		await nav.getByRole('link', { name: categoryName }).click();

		// トップページに遷移し、?category=<英語ID> が付与される
		await expect(page).toHaveURL(new RegExp(`/\\?category=${categoryId}$`));

		// 該当カテゴリのカードのみ表示され、それ以外は非表示になる
		const visibleCards = page.locator('#tool-grid [data-category]:visible');
		await expect(visibleCards).toHaveCount(categoryCount);
		for (const card of await visibleCards.all()) {
			await expect(card).toHaveAttribute('data-category', categoryId);
		}

		// 対象カテゴリのフィルタチップがアクティブになる
		await expect(
			page
				.locator('#category-filter')
				.getByRole('button', { name: categoryName }),
		).toHaveAttribute('aria-pressed', 'true');
	});

	test('Footer links are present', async ({ page }) => {
		const footer = page.locator('footer');
		await expect(footer).toBeVisible();

		// Check for standard footer links
		await expect(
			footer.getByRole('link', { name: /プライバシーポリシー/i }),
		).toBeVisible();
		await expect(
			footer.getByRole('link', { name: /このサイトについて/i }),
		).toBeVisible();
	});
});
