import { expect, test } from './fixtures/base.ts';

test.describe('Text Diff', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const page = createToolPage('text-diff');
		await page.goto();
	});

	test('文字単位の1行をUnified / Splitで維持し、変更文字だけ強調する', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.locator('#text-diff-textarea-a').fill('abc');
		await page.locator('#text-diff-textarea-b').fill('axc');
		await page.getByRole('tab', { name: '文字単位', exact: true }).click();
		const unified = page.getByTestId('diff-unified');
		await expect(unified.locator(':scope > div')).toHaveCount(2);
		await expect(unified.getByTestId('line-a')).toHaveText(['1', '']);
		await expect(unified.getByTestId('line-b')).toHaveText(['', '1']);
		await expect(unified.locator('del')).toHaveText('b');
		await expect(unified.locator('ins')).toHaveText('x');
		await expect(unified.getByTestId('line-content')).toHaveText([
			'- abc',
			'+ axc',
		]);

		await page.getByRole('tab', { name: 'Split', exact: true }).click();
		const left = page.getByTestId('diff-left');
		const right = page.getByTestId('diff-right');
		await expect(left.locator(':scope > div')).toHaveCount(1);
		await expect(right.locator(':scope > div')).toHaveCount(1);
		await expect(left.getByTestId('line-a')).toHaveText('1');
		await expect(right.getByTestId('line-b')).toHaveText('1');
		await expect(left.locator('del')).toHaveText('b');
		await expect(right.locator('ins')).toHaveText('x');
		await expect(left.getByTestId('line-content')).toHaveText('- abc');
		await expect(right.getByTestId('line-content')).toHaveText('+ axc');
	});

	test('文字単位のコピーは断片でなく元の行を出力する', async ({ page }) => {
		await page.evaluate(() => {
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: {
					writeText: async (text: string) => {
						document.documentElement.dataset.copiedDiff = text;
					},
				},
			});
		});
		await page.locator('#text-diff-textarea-a').fill('abc\n共通\n');
		await page.locator('#text-diff-textarea-b').fill('axc\n共通\n');
		await page.getByRole('tab', { name: '文字単位', exact: true }).click();
		await page.getByRole('button', { name: 'コピー', exact: true }).click();
		await expect(page.locator('html')).toHaveAttribute(
			'data-copied-diff',
			'- abc\n+ axc\n  共通',
		);
	});

	test('computes diff correctly', async ({ page }) => {
		const textboxes = page.getByRole('textbox');
		await textboxes.first().fill('hello\nworld');
		await textboxes.nth(1).fill('hello\nplaywright');

		// Check if diff summary appears
		await expect(page.getByText(/差分統計/i)).toBeVisible();
		await expect(page.getByText(/追加:\s*1行/)).toBeVisible();
		await expect(page.getByText(/削除:\s*1行/)).toBeVisible();
	});

	test('空行の追加・削除が行数に反映されること', async ({ page }) => {
		const textboxes = page.getByRole('textbox');
		await textboxes.first().fill('a\n');
		await textboxes.nth(1).fill('a\n\n\n');

		await expect(page.getByText(/追加:\s*2行/)).toBeVisible();
		await expect(page.getByText(/削除:\s*0行/)).toBeVisible();

		await textboxes.first().fill('a\n\n\n');
		await textboxes.nth(1).fill('a\n');

		await expect(page.getByText(/追加:\s*0行/)).toBeVisible();
		await expect(page.getByText(/削除:\s*2行/)).toBeVisible();
	});

	test('both textareas allow vertical resize with min/max height on desktop', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });

		for (const id of ['#text-diff-textarea-a', '#text-diff-textarea-b']) {
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

	test('both textareas disable resize on mobile viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });

		for (const id of ['#text-diff-textarea-a', '#text-diff-textarea-b']) {
			const resize = await page
				.locator(id)
				.evaluate((el) => getComputedStyle(el).resize);
			expect(resize).toBe('none');
		}
	});

	test('split view keeps left/right rows aligned when only one side changes', async ({
		page,
	}) => {
		// Split表示の切替タブは `hidden sm:block` でモバイル幅では非表示のため、デスクトップ幅に固定する
		await page.setViewportSize({ width: 1280, height: 900 });

		const textboxes = page.getByRole('textbox');
		await textboxes.first().fill('line1\nline2\nline3');
		await textboxes.nth(1).fill('line1\nNEW\nline2\nline3');

		await page.getByRole('tab', { name: 'Split' }).click();

		const columns = page.locator('.grid.grid-cols-2 > div');
		const leftRows = columns.nth(0).locator('.w-full.min-w-max > div');
		const rightRows = columns.nth(1).locator('.w-full.min-w-max > div');

		// 追加行の分だけ、右側だけでなく左側にもスペーサー行が挿入され行数が揃うこと
		await expect(leftRows).toHaveCount(4);
		await expect(rightRows).toHaveCount(4);

		// インデックス1: 右のみ "NEW" が追加され、左はスペーサー（空行）
		await expect(rightRows.nth(1)).toContainText('NEW');
		await expect(leftRows.nth(1)).not.toContainText('NEW');
		await expect(leftRows.nth(1)).not.toContainText('line');

		// インデックス2・3: 共通行が左右で同じ縦位置に揃っていること（回帰: #295）
		await expect(leftRows.nth(2)).toContainText('line2');
		await expect(rightRows.nth(2)).toContainText('line2');
		await expect(leftRows.nth(3)).toContainText('line3');
		await expect(rightRows.nth(3)).toContainText('line3');
	});
});
