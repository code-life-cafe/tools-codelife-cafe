import { expect, test } from './fixtures/base';

test.describe('ランダム並べ替え・グループ分けツール', () => {
	test('項目やグループ数を変更したら古い結果をコピー・保存できない', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('random-sort').goto();
		await page.getByLabel('項目（1行に1項目）').fill('A\nB\nC');
		await page.getByRole('button', { name: '並べ替える', exact: true }).click();
		await expect(page.getByTestId('random-sort-result')).toBeVisible();
		await page.getByLabel('項目（1行に1項目）').fill('変更済み');
		await expect(page.getByTestId('random-sort-result')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: '結果をコピー', exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'テキスト保存', exact: true }),
		).toHaveCount(0);
		await page.getByLabel('項目（1行に1項目）').fill('A\nB\nC');
		await page
			.getByRole('button', { name: 'グループに分ける', exact: true })
			.click();
		await expect(page.getByTestId('random-sort-result')).toBeVisible();
		await page.getByLabel('グループ数').fill('3');
		await expect(page.getByTestId('random-sort-result')).toHaveCount(0);
	});
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('random-sort');
		await toolPage.goto();
		await toolPage.expectTitle('ランダム並べ替え・グループ分け');
		await toolPage.expectSafetyBadge();
	});

	test('並べ替えても全項目（重複含む）が保持されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('random-sort');
		await toolPage.goto();
		await page.getByLabel('項目（1行に1項目）').fill('A\nB\n\nA\nC\n   \n D ');
		await page.getByRole('button', { name: '並べ替える' }).click();

		const items = page.getByTestId('random-sort-result').locator('li');
		await expect(items).toHaveCount(5);
		const texts = (await items.allTextContents()).sort();
		expect(texts).toEqual(['A', 'A', 'B', 'C', ' D '].sort());
		await expect(page.getByText('2行の空行を除外しました')).toBeVisible();
	});

	test('グループ分けは人数差が最大1で、不正なグループ数はエラーになること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('random-sort');
		await toolPage.goto();
		await page.getByLabel('項目（1行に1項目）').fill('1\n2\n3\n4\n5');
		await page.getByLabel('グループ数').fill('2');
		await page.getByRole('button', { name: 'グループに分ける' }).click();

		const groups = page.getByTestId('random-sort-result').locator('h3');
		await expect(groups).toHaveCount(2);
		await expect(groups.nth(0)).toContainText('3件');
		await expect(groups.nth(1)).toContainText('2件');

		await page.getByLabel('グループ数').fill('6');
		await page.getByRole('button', { name: 'グループに分ける' }).click();
		await expect(page.getByRole('alert')).toContainText('項目数');
		await expect(page.getByTestId('random-sort-result')).toHaveCount(0);

		await page.getByLabel('グループ数').fill('0');
		await page.getByRole('button', { name: 'グループに分ける' }).click();
		await expect(page.getByRole('alert')).toContainText('1以上');
	});

	test('空入力・上限超過でエラー表示、クリアで入力と結果が消えること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('random-sort');
		await toolPage.goto();
		await page.getByRole('button', { name: '並べ替える' }).click();
		await expect(page.getByRole('alert')).toContainText('項目がありません');

		await page.getByLabel('項目（1行に1項目）').fill('a\nb');
		await page.getByRole('button', { name: '並べ替える' }).click();
		await expect(page.getByTestId('random-sort-result')).toBeVisible();
		await page.getByRole('button', { name: 'クリア' }).click();
		await expect(page.getByLabel('項目（1行に1項目）')).toHaveValue('');
		await expect(page.getByTestId('random-sort-result')).toHaveCount(0);

		await page.getByLabel('項目（1行に1項目）').evaluate((element) => {
			// 大量行はネイティブsetterとinputイベントで投入し、Reactの入力処理を検証する。
			const setter = Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				'value',
			)?.set;
			if (!setter) throw new Error('textareaのsetterがありません');
			setter.call(element, 'x\n'.repeat(10_001));
			element.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.getByRole('button', { name: '並べ替える' }).click();
		await expect(page.getByRole('alert')).toContainText('項目が多すぎます');
	});

	test('テキスト保存でき、本文がlocalStorageに保存されないこと', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('random-sort');
		await toolPage.goto();
		await page.getByLabel('項目（1行に1項目）').fill('秘密A\n秘密B');
		await page.getByRole('button', { name: '並べ替える' }).click();

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'テキスト保存' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('random-sorted.txt');

		const stored = await page.evaluate(
			() =>
				JSON.stringify({ ...localStorage }) +
				JSON.stringify({ ...sessionStorage }),
		);
		expect(stored).not.toContain('秘密');
	});
});
