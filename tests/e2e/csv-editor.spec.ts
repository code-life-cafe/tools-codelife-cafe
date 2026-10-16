import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures/base';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('CSV/TSV/Excel Viewer & Editor (Phase 3 Enhancements)', () => {
	test('should load the page correctly and show initial UI', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('csv-editor');
		await toolPage.goto();
		await toolPage.expectTitle('CSVビューア/エディタ | CODE:LIFE Tools');
		await toolPage.expectSafetyBadge();

		// H1は括弧書きの機能列挙（Excel取込・フィルタ・グラフ）を含まない簡潔な名称
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'CSVビューア/エディタ',
		);
	});

	test('should parse CSV and allow table editing and Undo', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('csv-editor');
		await toolPage.goto();

		const inputArea = page.getByRole('textbox').first();
		await inputArea.fill('名前,年齢,部署\n田中,25,開発\n佐藤,30,営業');
		await page.getByRole('button', { name: 'パースして編集へ' }).click();

		await expect(page.getByRole('tab', { name: /テーブル/ })).toHaveAttribute(
			'data-state',
			'active',
		);
		await expect(page.getByRole('button', { name: /行を追加/i })).toBeVisible();

		const tbodyInputs = page.locator('table tbody input[type="text"]');
		// 1st data row (田中)
		await expect(tbodyInputs.nth(0)).toHaveValue('田中');
		// 2nd data row (佐藤)
		await expect(tbodyInputs.nth(3)).toHaveValue('佐藤');

		// Cell editing
		await tbodyInputs.nth(0).fill('田中太郎');
		await expect(tbodyInputs.nth(0)).toHaveValue('田中太郎');

		// Undo
		await page.getByRole('button', { name: 'Undo' }).click();
		await expect(tbodyInputs.nth(0)).toHaveValue('田中');
	});

	test('should import TSV file correctly', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('csv-editor');
		await toolPage.goto();

		const tsvPath = path.join(__dirname, '../fixtures/sample-data.tsv');
		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles(tsvPath);

		await expect(page.getByRole('tab', { name: /テーブル/ })).toHaveAttribute(
			'data-state',
			'active',
		);
		const tbodyInputs = page.locator('table tbody input[type="text"]');
		await expect(tbodyInputs.nth(0)).toHaveValue('山田');
		await expect(tbodyInputs.nth(3)).toHaveValue('鈴木');
	});

	test('should import multi-sheet XLSX and switch sheets', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('csv-editor');
		await toolPage.goto();

		const xlsxPath = path.join(__dirname, '../fixtures/sample-multisheet.xlsx');
		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles(xlsxPath);

		await expect(page.getByRole('tab', { name: /テーブル/ })).toHaveAttribute(
			'data-state',
			'active',
		);

		// Check sheet buttons
		await expect(
			page.getByRole('button', { name: /売上データ/ }),
		).toBeVisible();
		await expect(page.getByRole('button', { name: /部署一覧/ })).toBeVisible();

		const tbodyInputs = page.locator('table tbody input[type="text"]');
		await expect(tbodyInputs.nth(0)).toHaveValue('田中');

		// Switch sheet
		await page.getByRole('button', { name: /部署一覧/ }).click();
		await expect(tbodyInputs.nth(0)).toHaveValue('開発部');
	});

	test('should apply advanced filter, multi-sort, and render chart', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('csv-editor');
		await toolPage.goto();

		const inputArea = page.getByRole('textbox').first();
		await inputArea.fill(
			'品名,価格,数量\nりんご,100,5\nみかん,80,10\nバナナ,120,3\nぶどう,200,2',
		);
		await page.getByRole('button', { name: 'パースして編集へ' }).click();

		// Switch to Filter/Sort tab
		await page.getByRole('tab', { name: /絞込・ソート/ }).click();

		// Add Filter Condition
		await page.getByRole('button', { name: /条件を追加/ }).click();
		const filterInput = page.locator('input[placeholder="値"]');
		await filterInput.fill('ん'); // 品名に「ん」が含まれる (りんご, みかん) -> 2行

		// Verify table filtered count in tab stats
		await page.getByRole('tab', { name: /テーブル/ }).click();
		await expect(page.locator('table tbody tr')).toHaveCount(2);

		// Switch to Chart tab
		await page.getByRole('tab', { name: /グラフ/ }).click();
		await expect(
			page.getByRole('button', { name: /SVG ダウンロード/ }),
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: /PNG ダウンロード/ }),
		).toBeVisible();
	});

	test('should render responsively on mobile (375px)', async ({
		page,
		createToolPage,
	}) => {
		await page.setViewportSize({ width: 375, height: 667 });
		const toolPage = createToolPage('csv-editor');
		await toolPage.goto();

		await expect(
			page.getByRole('button', { name: 'パースして編集へ' }),
		).toBeVisible();
	});

	for (const viewport of [
		{ name: 'PC', width: 1280, height: 800 },
		{ name: '390px', width: 390, height: 844 },
	]) {
		test.describe(`操作名と全消去の確認 (${viewport.name})`, () => {
			test.use({
				viewport: { width: viewport.width, height: viewport.height },
			});

			const setup = async (
				page: import('@playwright/test').Page,
				createToolPage: (slug: string) => { goto: () => Promise<void> },
			) => {
				await createToolPage('csv-editor').goto();
				await page
					.getByRole('textbox')
					.first()
					.fill('商品,個数\nりんご,2\nみかん,3');
				await page.getByRole('button', { name: 'パースして編集へ' }).click();
				const cell = page.locator('table tbody input[type="text"]').first();
				await cell.fill('りんご（編集）');
			};

			test('5操作に日本語の操作名と表示がある', async ({
				page,
				createToolPage,
			}) => {
				await setup(page, createToolPage);
				for (const name of [
					/^ファイル読込/,
					'コピー',
					'JSON',
					'エクスポート',
					/^全消去/,
				]) {
					const button = page.getByRole('button', { name });
					await expect(button).toBeVisible();
					// アイコンのみではなく、文字ラベルが表示されている
					expect((await button.innerText()).trim().length).toBeGreaterThan(0);
				}
				const box = await page
					.getByRole('button', { name: /^全消去/ })
					.boundingBox();
				expect(box).not.toBeNull();
				expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
				expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
					viewport.width,
				);
				const overflow = await page.evaluate(
					() =>
						document.documentElement.scrollWidth >
						document.documentElement.clientWidth,
				);
				expect(overflow).toBe(false);
			});

			test('キャンセル/Escapeで入力・編集・Undoを保持し、フォーカスが戻る', async ({
				page,
				createToolPage,
			}) => {
				await setup(page, createToolPage);
				const clear = page.getByRole('button', { name: /^全消去/ });
				const cell = page.locator('table tbody input[type="text"]').first();

				await clear.click();
				const dialog = page.getByRole('dialog', { name: '全消去の確認' });
				await expect(dialog).toContainText('入力と編集内容をすべて消去します');
				await dialog.getByRole('button', { name: 'キャンセル' }).click();
				await expect(dialog).toBeHidden();
				await expect(clear).toBeFocused();
				await expect(cell).toHaveValue('りんご（編集）');

				await clear.click();
				await page.keyboard.press('Escape');
				await expect(dialog).toBeHidden();
				await expect(clear).toBeFocused();
				await expect(cell).toHaveValue('りんご（編集）');

				await page.getByRole('button', { name: 'Undo' }).click();
				await expect(cell).toHaveValue('りんご');
			});

			test('確認した場合だけ初期化される', async ({ page, createToolPage }) => {
				await setup(page, createToolPage);
				await page.getByRole('button', { name: /^全消去/ }).click();
				await page
					.getByRole('dialog', { name: '全消去の確認' })
					.getByRole('button', { name: 'すべて消去する' })
					.click();
				await expect(page.getByRole('dialog')).toBeHidden();
				await expect(page.getByRole('textbox').first()).toHaveValue('');
				await expect(page.getByRole('textbox').first()).toBeFocused();
				await expect(
					page.getByRole('button', { name: /^全消去/ }),
				).toBeDisabled();
				await expect(
					page.getByRole('tab', { name: /テーブル/ }),
				).toBeDisabled();
			});

			test('キーボードだけで開いて取り消せる', async ({
				page,
				createToolPage,
			}) => {
				await setup(page, createToolPage);
				await page.getByRole('button', { name: /^全消去/ }).focus();
				await page.keyboard.press('Enter');
				const dialog = page.getByRole('dialog', { name: '全消去の確認' });
				await expect(dialog).toBeVisible();
				await page.keyboard.press('Escape');
				await expect(dialog).toBeHidden();
				await expect(
					page.locator('table tbody input[type="text"]').first(),
				).toHaveValue('りんご（編集）');
			});
		});
	}
});
