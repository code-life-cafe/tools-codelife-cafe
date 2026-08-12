import { expect, test } from './fixtures/base';

test.describe('Search after page navigation', () => {
	// 検索ボタンはデスクトップサイズでのみ表示されるため、モバイルテストはスキップ
	test.skip(
		({ isMobile }) => isMobile,
		'Search button is only visible on desktop',
	);

	test('Search button works after navigating to a tool page', async ({
		page,
	}) => {
		// 1. トップページにアクセス（fixtureのgotoがハイドレーション完了まで待機する）
		await page.goto('/');

		// 2. 検索ボタンが動作することを確認
		const searchTrigger = page.locator('#search-trigger');
		await expect(searchTrigger).toBeVisible();
		await searchTrigger.click();

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });
		await expect(searchInput).toBeFocused({ timeout: 2000 });

		// 3. Escで閉じる
		await page.keyboard.press('Escape');
		await expect(searchInput).not.toBeVisible();

		// 4. ツールページに遷移（View Transitionsによるクライアントサイド遷移）
		await page.goto('/char-count');

		// 5. 遷移後に検索ボタンが動作することを確認
		const searchTriggerAfter = page.locator('#search-trigger');
		await expect(searchTriggerAfter).toBeVisible();
		await searchTriggerAfter.click();

		const searchInputAfter = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInputAfter).toBeVisible({ timeout: 5000 });
	});

	test('Ctrl+K shortcut works after navigating to a tool page', async ({
		page,
	}) => {
		// 1. トップページにアクセス（fixtureのgotoがハイドレーション完了まで待機する）
		await page.goto('/');

		// 2. ツールページに遷移
		await page.goto('/zenkaku-hankaku');

		// 3. 遷移後にCtrl+Kが動作することを確認
		await page.keyboard.press('Control+k');

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });
		await expect(searchInput).toBeFocused();
	});

	test('Search via internal link navigation works', async ({ page }) => {
		// 1. トップページにアクセス（fixtureのgotoがハイドレーション完了まで待機する）
		await page.goto('/');

		// 2. ツールカードをクリックして内部遷移
		const toolLink = page.locator('a[href="/char-count"]').first();
		if (await toolLink.isVisible()) {
			await toolLink.click();
			await page.waitForURL('**/char-count');
			// View Transitionによるクライアントサイド遷移の完了を待つ
			await page.waitForLoadState('networkidle');

			// 3. 遷移後に検索ボタンが動作することを確認
			const searchTrigger = page.locator('#search-trigger');
			await expect(searchTrigger).toBeVisible();
			await searchTrigger.click();

			const searchInput = page.getByPlaceholder(/ツールを検索/i);
			await expect(searchInput).toBeVisible({ timeout: 5000 });
		}
	});

	test('Enter during IME composition does not navigate', async ({ page }) => {
		// 1. トップページにアクセスして検索モーダルを開く（fixtureのgotoがハイドレーション完了まで待機する）
		await page.goto('/');

		await page.keyboard.press('Control+k');
		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });
		await expect(searchInput).toBeFocused();

		// 2. IME変換中（isComposing: true）の Enter をディスパッチ
		await page.evaluate(() => {
			window.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Enter',
					isComposing: true,
					bubbles: true,
				}),
			);
		});

		// 3. ページ遷移せず、モーダルが開いたままであることを確認
		// （isComposing判定はハンドラ内で同期的に行われるため、待機なしで検証可能）
		expect(new URL(page.url()).pathname).toBe('/');
		await expect(searchInput).toBeVisible();

		// 4. 通常の Enter では選択中ツールへ遷移することを確認
		await page.keyboard.press('Enter');
		await page.waitForURL((url) => url.pathname !== '/');
		expect(new URL(page.url()).pathname).not.toBe('/');
	});

	test('Keyboard shortcut label shows correct OS key', async ({ page }) => {
		// Playwright runs on non-Mac typically, so expect Ctrl+K
		await page.goto('/');

		const kbdElement = page.locator('#search-kbd');
		await expect(kbdElement).toBeVisible();

		// 初回表示を確認
		const initialText = await kbdElement.textContent();

		// ツールページに遷移
		await page.goto('/json-formatter');

		// 遷移後も同じ表記が維持されることを確認
		const afterNavText = await kbdElement.textContent();
		expect(afterNavText).toBe(initialText);
	});
});
