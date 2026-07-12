import type { Page } from '@playwright/test';
import {
	buildConversionTable,
	DEFAULT_TABLE_RANGE_YEARS,
	formatTableForCopy,
} from '../../src/lib/tools/wareki-converter';
import { expect, test } from './fixtures/base';

/**
 * 早見表の行は PC（table）とモバイル（card）で別DOM構造になっているため、
 * data-year属性と :visible で現在のビューポートに表示されている行だけを取得する。
 */
function rowByYear(page: Page, year: number) {
	return page.locator(
		`[data-testid="wareki-row"][data-year="${year}"]:visible`,
	);
}

test.describe('Wareki Converter Tool', () => {
	test('should load the page correctly', async ({ createToolPage }) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();
		await toolPage.expectTitle('和暦↔西暦・年齢変換 | CODE:LIFE Tools');
		await toolPage.expectSafetyBadge();
	});

	test('should convert seireki to wareki and vice versa', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		// 1. Convert Seireki to Wareki (default)
		const seirekiInput = page.locator('input[type="number"]');
		await seirekiInput.fill('2000');

		// Verify output (平成12年) in the result table
		await expect(rowByYear(page, 2000)).toContainText('平成12年');

		// 2. Switch direction to Wareki -> Seireki
		await page.getByRole('switch').click();

		// Set Wareki input to 令和2年
		const warekiInput = page.locator('input[type="text"]');
		await warekiInput.fill('令和2年');

		// Verify output (2020年、基準年としてハイライトされる行)
		const row2020 = rowByYear(page, 2020);
		await expect(row2020).toContainText('2020年');
		await expect(row2020.getByText('基準年', { exact: true })).toBeVisible();
	});

	test('should show a multi-year lookup table centered on the input year', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		const seirekiInput = page.locator('input[type="number"]');
		await seirekiInput.fill('2009');

		// 初期表示は入力年±5年（計11行）
		for (const year of [2004, 2006, 2009, 2012, 2014]) {
			await expect(rowByYear(page, year)).toBeVisible();
		}
		await expect(rowByYear(page, 2003)).toHaveCount(0);
		await expect(rowByYear(page, 2015)).toHaveCount(0);
	});

	test('should change the displayed row count when the range is changed', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		const seirekiInput = page.locator('input[type="number"]');
		await seirekiInput.fill('2020');

		await page.getByRole('tab', { name: '±3年' }).click();
		await expect(rowByYear(page, 2017)).toBeVisible();
		await expect(rowByYear(page, 2013)).toHaveCount(0);

		await page.getByRole('tab', { name: '±10年' }).click();
		await expect(rowByYear(page, 2013)).toBeVisible();
		await expect(rowByYear(page, 2010)).toBeVisible();
	});

	test('should show pre-Meiji era results with a caveat notice', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		await page.getByRole('switch').click();
		const warekiInput = page.locator('input[type="text"]');
		await warekiInput.fill('慶応3年');

		await expect(rowByYear(page, 1867)).toContainText('1867年');
		await expect(
			page.getByText(
				'年単位の対応候補です。旧暦月日を新暦月日に変換した結果ではありません。',
				{ exact: true },
			),
		).toBeVisible();
	});

	test('should show multiple era candidates for a era-change year', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		const seirekiInput = page.locator('input[type="number"]');
		await seirekiInput.fill('1868');

		const row1868 = rowByYear(page, 1868);
		await expect(row1868).toContainText('慶応4年');
		await expect(row1868).toContainText('明治元年');
	});

	test('should show multiple era candidates for the 平成→令和 transition year', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		const seirekiInput = page.locator('input[type="number"]');
		await seirekiInput.fill('2019');

		const row2019 = rowByYear(page, 2019);
		await expect(row2019).toContainText('平成31年');
		await expect(row2019).toContainText('令和元年');
	});

	test('should display "対応元号なし" for years before the supported range', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		const seirekiInput = page.locator('input[type="number"]');
		await seirekiInput.fill('1844');

		await expect(rowByYear(page, 1843)).toContainText('対応元号なし');
	});

	test('should copy the exact multi-year table text matching the on-screen display', async ({
		page,
		context,
		createToolPage,
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);

		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		// 1868年は改元年（慶応4年/明治元年が併存）で、旧暦注意も表示される境界ケース
		const seirekiInput = page.locator('input[type="number"]');
		await seirekiInput.fill('1868');

		const row1868 = rowByYear(page, 1868);
		await expect(row1868).toContainText('慶応4年');
		await expect(row1868).toContainText('明治元年');

		await page.getByRole('button', { name: 'コピー' }).click();
		await expect(
			page.getByRole('button', { name: 'コピーしました' }),
		).toBeVisible();

		const clipboardText = await page.evaluate(() =>
			navigator.clipboard.readText(),
		);

		// 年齢範囲はテスト実行日に依存するため、画面表示と同じロジックで期待値を組み立てる
		const table = buildConversionTable(
			1868,
			new Date(),
			DEFAULT_TABLE_RANGE_YEARS,
		);
		expect(clipboardText).toBe(formatTableForCopy(table));
	});

	test('should reject a non-existent date', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		const seirekiInput = page.locator('input[type="number"]');
		await seirekiInput.fill('2023');
		await page.getByRole('combobox', { name: '月（任意）' }).click();
		await page.getByRole('option', { name: '2月', exact: true }).click();
		await page.getByRole('combobox', { name: '日（任意）' }).click();
		await page.getByRole('option', { name: '31日', exact: true }).click();

		await expect(
			page.getByText(
				'存在しない日付です。月・日の入力内容を確認してください。',
			),
		).toBeVisible();
	});

	test('should reject a wareki/date combination outside the era boundary', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wareki-converter');
		await toolPage.goto();

		await page.getByRole('switch').click();
		const warekiInput = page.locator('input[type="text"]');
		await warekiInput.fill('平成元年');

		await page.getByRole('combobox', { name: '月（任意）' }).click();
		await page.getByRole('option', { name: '1月', exact: true }).click();
		await page.getByRole('combobox', { name: '日（任意）' }).click();
		await page.getByRole('option', { name: '1日', exact: true }).click();

		await expect(
			page.getByText('指定した和暦と月日の組み合わせが一致しません'),
		).toBeVisible();
	});
});
