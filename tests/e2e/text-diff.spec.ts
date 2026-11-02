import { expect, test } from './fixtures/base';

test.describe('Text Diff', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const page = createToolPage('text-diff');
		await page.goto();
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

	test('変更前・変更後の可視ラベルが各欄に関連付く', async ({ page }) => {
		for (const viewport of [
			{ width: 1280, height: 900 },
			{ width: 390, height: 844 },
		]) {
			await page.setViewportSize(viewport);

			const before = page.getByRole('textbox', {
				name: 'テキストA（変更前）',
				exact: true,
			});
			const after = page.getByRole('textbox', {
				name: 'テキストB（変更後）',
				exact: true,
			});
			await expect(before).toHaveId('text-diff-textarea-a');
			await expect(after).toHaveId('text-diff-textarea-b');
			await expect(before).toBeVisible();
			await expect(after).toBeVisible();

			const beforeBox = await before.boundingBox();
			const afterBox = await after.boundingBox();
			expect(beforeBox).not.toBeNull();
			expect(afterBox).not.toBeNull();
			if (beforeBox && afterBox) {
				expect(beforeBox.height).toBeGreaterThan(100);
				expect(afterBox.height).toBeGreaterThan(100);
				if (viewport.width >= 640) {
					expect(Math.abs(beforeBox.y - afterBox.y)).toBeLessThan(8);
				} else {
					expect(afterBox.y).toBeGreaterThan(beforeBox.y + beforeBox.height);
				}
			}

			await page.locator('label[for="text-diff-textarea-a"]').click();
			await expect(before).toBeFocused();
			await page.keyboard.press('Tab');
			await expect(after).toBeFocused();
			await page.keyboard.press('Shift+Tab');
			await expect(before).toBeFocused();
			await before.pressSequentially('キーボード前');
			await expect(before).toHaveValue('キーボード前');

			await page.locator('label[for="text-diff-textarea-b"]').click();
			await expect(after).toBeFocused();
			await after.pressSequentially('キーボード後');
			await expect(after).toHaveValue('キーボード後');

			const clears = page.getByRole('button', { name: 'クリア', exact: true });
			await clears.nth(0).click();
			await clears.nth(1).click();
			await expect(before).toHaveValue('');
			await expect(after).toHaveValue('');
			await expect(page.getByText('差分統計')).toHaveCount(0);
		}
	});

	test('日本語差分・同一内容・空入力・クリア・モードとファイルdropを維持する', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		const before = page.locator('#text-diff-textarea-a');
		const after = page.locator('#text-diff-textarea-b');

		await expect(page.getByText('差分統計')).toHaveCount(0);

		await before.fill('あいう');
		await expect(page.getByText(/削除:\s*1行\s*\(4文字\)/)).toBeVisible();
		await expect(page.getByText(/追加:\s*0行\s*\(0文字\)/)).toBeVisible();

		await before.fill('りんご\nみかん');
		await after.fill('りんご\nぶどう');
		await expect(page.getByText(/追加:\s*1行\s*\(4文字\)/)).toBeVisible();
		await expect(page.getByText(/削除:\s*1行\s*\(4文字\)/)).toBeVisible();
		await expect(page.getByText('差分結果')).toBeVisible();
		await expect(page.getByText('- みかん')).toBeVisible();
		await expect(page.getByText('+ ぶどう')).toBeVisible();

		await before.fill('こんにちは');
		await after.fill('こんにちは');
		await expect(page.getByText(/追加:\s*0行\s*\(0文字\)/)).toBeVisible();
		await expect(page.getByText(/削除:\s*0行\s*\(0文字\)/)).toBeVisible();

		await page.getByRole('tab', { name: '文字単位' }).click();
		await before.fill('あいう');
		await after.fill('あえう');
		await expect(page.getByText(/追加:\s*1行\s*\(1文字\)/)).toBeVisible();
		await expect(page.getByText(/削除:\s*1行\s*\(1文字\)/)).toBeVisible();

		await page.getByRole('tab', { name: '行単位' }).click();
		await before.fill('りんご\nみかん');
		await after.fill('りんご\nぶどう');
		await page.getByRole('tab', { name: 'Unified' }).click();
		await expect(page.getByText('- みかん')).toBeVisible();
		await page.getByRole('tab', { name: 'Split' }).click();
		await expect(page.getByText('- みかん')).toBeVisible();
		await expect(page.getByText('+ ぶどう')).toBeVisible();

		const clears = page.getByRole('button', { name: 'クリア', exact: true });
		await clears.nth(0).click();
		await expect(before).toHaveValue('');
		await expect(after).toHaveValue('りんご\nぶどう');
		await expect(page.getByText(/追加:\s*2行\s*\(8文字\)/)).toBeVisible();
		await expect(page.getByText(/削除:\s*0行\s*\(0文字\)/)).toBeVisible();
		await clears.nth(1).click();
		await expect(after).toHaveValue('');
		await expect(page.getByText('差分統計')).toHaveCount(0);

		await before.evaluate((el) => {
			const transfer = new DataTransfer();
			transfer.items.add(
				new File(['ドロップ甲'], 'a.txt', { type: 'text/plain' }),
			);
			el.dispatchEvent(
				new DragEvent('drop', {
					bubbles: true,
					cancelable: true,
					dataTransfer: transfer,
				}),
			);
		});
		await expect(before).toHaveValue('ドロップ甲');
		await after.evaluate((el) => {
			const transfer = new DataTransfer();
			transfer.items.add(
				new File(['ドロップ乙'], 'b.txt', { type: 'text/plain' }),
			);
			el.dispatchEvent(
				new DragEvent('drop', {
					bubbles: true,
					cancelable: true,
					dataTransfer: transfer,
				}),
			);
		});
		await expect(after).toHaveValue('ドロップ乙');
		await expect(page.getByText(/追加:\s*1行/)).toBeVisible();
		await expect(page.getByText(/削除:\s*1行/)).toBeVisible();

		await page.setViewportSize({ width: 390, height: 844 });
		await before.fill('猫');
		await after.fill('犬');
		await expect(before).toBeVisible();
		await expect(after).toBeVisible();
		await expect(page.getByText(/追加:\s*1行/)).toBeVisible();
		await expect(page.getByText(/削除:\s*1行/)).toBeVisible();
		await clears.nth(0).click();
		await clears.nth(1).click();
		await expect(before).toHaveValue('');
		await expect(after).toHaveValue('');
		await expect(page.getByText('差分統計')).toHaveCount(0);
	});
});
