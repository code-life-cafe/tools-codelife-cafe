import { expect, test } from './fixtures/base';

test.describe('Search result ranking', () => {
	// 検索モーダルはデスクトップサイズでのみ操作可能なため、モバイルテストはスキップ
	test.skip(
		({ isMobile }) => isMobile,
		'Search modal is only operable on desktop',
	);

	test('「csv」検索でタイトルにCSVを含むツールが先頭グループに来る', async ({
		page,
	}) => {
		await page.goto('/');
		// React Island のハイドレーション完了を待ってから検索を開く
		await expect(page.locator('#search-trigger')).toBeVisible();
		await page.keyboard.press('Control+k');

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });
		await searchInput.fill('csv');

		const results = page.getByTestId('search-result');
		await expect(results.first()).toBeVisible();

		// タイトル前方一致の「CSVビューア/エディタ」が最優先で先頭に来る
		await expect(results.nth(0)).toContainText('CSVビューア/エディタ');
		await expect(results.nth(1)).toContainText('CSV文字化け修復');

		// 説明文・キーワードのみ一致の「ダミーデータ生成」はタイトル一致グループより後ろ
		const titles = await results.locator('span.font-medium').allTextContents();
		const dummyIndex = titles.indexOf('ダミーデータ生成');
		const csvEditorIndex = titles.indexOf('CSVビューア/エディタ');
		expect(dummyIndex).toBeGreaterThan(-1);
		expect(csvEditorIndex).toBe(0);

		// タイトルにCSVを含むツールはすべてダミーデータ生成より上位
		for (const [index, title] of titles.entries()) {
			if (title.toLowerCase().includes('csv')) {
				expect(index).toBeLessThan(dummyIndex);
			}
		}
	});

	test('ひらがな検索「かうんと」でカタカナタイトルのツールがヒットする', async ({
		page,
	}) => {
		await page.goto('/');
		// React Island のハイドレーション完了を待ってから検索を開く
		await expect(page.locator('#search-trigger')).toBeVisible();
		await page.keyboard.press('Control+k');

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });
		await searchInput.fill('かうんと');

		const results = page.getByTestId('search-result');
		await expect(results.first()).toBeVisible();
		await expect(results.first()).toContainText('文字数カウント');
	});

	test('全角クエリ「ＪＳＯＮ」「ＣＳＶ」で半角と同じ候補がヒットする', async ({
		page,
	}) => {
		await page.goto('/');
		// React Island のハイドレーション完了を待ってから検索を開く
		await expect(page.locator('#search-trigger')).toBeVisible();
		await page.keyboard.press('Control+k');

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });
		const results = page.getByTestId('search-result');

		await searchInput.fill('csv');
		await expect(results.first()).toBeVisible();
		const halfwidthTitles = await results
			.locator('span.font-medium')
			.allTextContents();

		await searchInput.fill('');
		await searchInput.fill('ＣＳＶ');
		await expect(results.first()).toBeVisible();
		const fullwidthTitles = await results
			.locator('span.font-medium')
			.allTextContents();
		expect(fullwidthTitles).toEqual(halfwidthTitles);

		await searchInput.fill('');
		await searchInput.fill('ＪＳＯＮ');
		const jsonResults = page.getByTestId('search-result');
		await expect(jsonResults.first()).toBeVisible();
		const jsonTitles = await jsonResults
			.locator('span.font-medium')
			.allTextContents();
		expect(jsonTitles).toContain('JSON ↔ CSV 変換');
	});

	test('半角カナ検索「ｶｳﾝﾄ」でカタカナタイトルのツールがヒットする', async ({
		page,
	}) => {
		await page.goto('/');
		// React Island のハイドレーション完了を待ってから検索を開く
		await expect(page.locator('#search-trigger')).toBeVisible();
		await page.keyboard.press('Control+k');

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });
		await searchInput.fill('ｶｳﾝﾄ');

		const results = page.getByTestId('search-result');
		await expect(results.first()).toBeVisible();
		await expect(results.first()).toContainText('文字数カウント');
	});

	test('複数語クエリ「json csv」でJSON↔CSV変換がヒットする（AND一致）', async ({
		page,
	}) => {
		await page.goto('/');
		// React Island のハイドレーション完了を待ってから検索を開く
		await expect(page.locator('#search-trigger')).toBeVisible();
		await page.keyboard.press('Control+k');

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });
		await searchInput.fill('json csv');

		const results = page.getByTestId('search-result');
		await expect(results.first()).toBeVisible();

		// 語が別々のキーワードに分かれているエントリもマッチする
		// （タイトルに "json csv" の連結文字列は含まれないが、
		//  キーワード ['JSON', 'CSV', ...] の両方にマッチするためヒットする）
		const titles = await results.locator('span.font-medium').allTextContents();
		expect(titles).toContain('JSON ↔ CSV 変換');
	});

	test('複数語クエリに無関係な語を足すとヒットしなくなる（AND一致）', async ({
		page,
	}) => {
		await page.goto('/');
		// React Island のハイドレーション完了を待ってから検索を開く
		await expect(page.locator('#search-trigger')).toBeVisible();
		await page.keyboard.press('Control+k');

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });

		// 「json csv」単体ではヒットすることを確認
		await searchInput.fill('json csv');
		const results = page.getByTestId('search-result');
		await expect(results.first()).toBeVisible();
		const hitTitles = await results
			.locator('span.font-medium')
			.allTextContents();
		expect(hitTitles).toContain('JSON ↔ CSV 変換');

		// 無関係な語を足すと、全語AND一致が必要なため結果が空になる
		await searchInput.fill('json csv 存在しないツールxyz');
		await expect(
			page.getByText('一致するツールが見つかりません。'),
		).toBeVisible();
	});

	test('全角スペース区切りの複数語クエリでもAND一致する', async ({ page }) => {
		await page.goto('/');
		// React Island のハイドレーション完了を待ってから検索を開く
		await expect(page.locator('#search-trigger')).toBeVisible();
		await page.keyboard.press('Control+k');

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });
		// 全角スペース区切り
		await searchInput.fill('json　csv');

		const results = page.getByTestId('search-result');
		await expect(results.first()).toBeVisible();
		const titles = await results.locator('span.font-medium').allTextContents();
		expect(titles).toContain('JSON ↔ CSV 変換');
	});

	test('一致しないクエリでは結果が空になる', async ({ page }) => {
		await page.goto('/');
		// React Island のハイドレーション完了を待ってから検索を開く
		await expect(page.locator('#search-trigger')).toBeVisible();
		await page.keyboard.press('Control+k');

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });
		await searchInput.fill('存在しないツールxyz');

		await expect(
			page.getByText('一致するツールが見つかりません。'),
		).toBeVisible();
	});
});
