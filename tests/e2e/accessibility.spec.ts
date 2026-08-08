import { expect, test } from './fixtures/base';

test.describe('Accessibility: skip link', () => {
	test('スキップリンクがTabキー1回目で出現し本文へ移動できる', async ({
		page,
	}) => {
		await page.goto('/');

		// ページ読み込み直後、最初のTabでスキップリンクにフォーカスが当たる
		await page.keyboard.press('Tab');
		const skipLink = page.getByRole('link', { name: '本文へスキップ' });
		await expect(skipLink).toBeFocused();
		await expect(skipLink).toHaveAttribute('href', '#main');

		// Enterで本文（#main）へ移動できる
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/#main$/);
		await expect(page.locator('main#main')).toBeVisible();
	});
});

test.describe('Accessibility: search modal dialog, reduced motion', () => {
	// 検索モーダルはデスクトップサイズでのみ操作可能なため、モバイルテストはスキップ
	test.skip(
		({ isMobile }) => isMobile,
		'Search modal is only operable on desktop',
	);

	test('検索モーダルがdialogロールとaria-modalを持つ', async ({ page }) => {
		await page.goto('/');
		await page.waitForTimeout(1000);
		await page.keyboard.press('Control+k');

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible({ timeout: 5000 });
		await expect(dialog).toHaveAttribute('aria-modal', 'true');

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toHaveAttribute('aria-label', 'ツールを検索');
	});

	test('検索モーダルを開くとフォーカスがトラップされ、閉じるとトリガーへ復帰する', async ({
		page,
	}) => {
		await page.goto('/');
		await page.waitForTimeout(1000);

		const searchTrigger = page.locator('#search-trigger');
		await searchTrigger.focus();
		await searchTrigger.click();

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });
		await expect(searchInput).toBeFocused();

		// モーダル内でTabを押しても、フォーカスは入力欄内にとどまる（背後の要素へ抜けない）
		await page.keyboard.press('Tab');
		await expect(searchInput).toBeFocused();

		// Escで閉じると、元のトリガー要素にフォーカスが戻る
		await page.keyboard.press('Escape');
		await expect(searchInput).not.toBeVisible();
		await expect(searchTrigger).toBeFocused();
	});

	test('検索モーダル表示中は背景のスクロールがロックされる', async ({
		page,
	}) => {
		await page.goto('/');
		await page.waitForTimeout(1000);
		await page.keyboard.press('Control+k');

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });

		await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

		await page.keyboard.press('Escape');
		await expect(searchInput).not.toBeVisible();
		await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
	});

	test('検索結果がlistbox/option/aria-selectedで表現される', async ({
		page,
	}) => {
		await page.goto('/');
		await page.waitForTimeout(1000);
		await page.keyboard.press('Control+k');

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });
		await searchInput.fill('csv');

		const listbox = page.getByRole('listbox', { name: '検索結果' });
		await expect(listbox).toBeVisible();

		const options = page.getByRole('option');
		await expect(options.first()).toHaveAttribute('aria-selected', 'true');

		// ArrowDownでaria-activedescendantと選択状態のoptionが連動する
		await page.keyboard.press('ArrowDown');
		await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
		await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');

		const activeDescendant = await searchInput.getAttribute(
			'aria-activedescendant',
		);
		const secondOptionId = await options.nth(1).getAttribute('id');
		expect(activeDescendant).toBe(secondOptionId);
	});

	test('OSのreduced-motion設定でアニメーションが実質停止する', async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/');
		await page.waitForTimeout(1000);
		await page.keyboard.press('Control+k');

		const searchInput = page.getByPlaceholder(/ツールを検索/i);
		await expect(searchInput).toBeVisible({ timeout: 5000 });

		const dialog = page.getByRole('dialog');
		// ブラウザは "0.01ms" を "1e-05s" のように ms/s いずれの単位でも正規化して
		// 返しうるため、表記ではなく実際の秒数(0.00001s = 10μs以下)へ揃えて判定する。
		const durationsInSeconds = await dialog.evaluate((el) => {
			const toSeconds = (value: string) =>
				value.endsWith('ms')
					? Number.parseFloat(value) / 1000
					: Number.parseFloat(value);
			const style = window.getComputedStyle(el);
			return {
				animationDuration: toSeconds(style.animationDuration),
				transitionDuration: toSeconds(style.transitionDuration),
			};
		});

		expect(durationsInSeconds.animationDuration).toBeLessThanOrEqual(0.00001);
		expect(durationsInSeconds.transitionDuration).toBeLessThanOrEqual(0.00001);
	});
});
