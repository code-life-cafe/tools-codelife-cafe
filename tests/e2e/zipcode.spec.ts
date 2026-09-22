import fs from 'node:fs';
import { expect, test } from './fixtures/base';

test.describe('郵便番号→住所変換', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('zipcode');
		await toolPage.goto();
	});

	test('ページ表示とSafetyBadge・プライバシー注記', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('zipcode');
		await toolPage.expectTitle('郵便番号から住所変換');
		await toolPage.expectSafetyBadge();
		await expect(
			page
				.getByText('入力された郵便番号は外部に送信されません', { exact: false })
				.first(),
		).toBeVisible();
	});

	test('単発検索: ハイフン有無・全角で同じ住所が表示される', async ({
		page,
	}) => {
		const input = page.getByRole('textbox', { name: '検索する郵便番号' });

		await input.fill('100-0001');
		await expect(page.getByText('東京都千代田区千代田')).toBeVisible();

		await input.fill('');
		await input.fill('1000001');
		await expect(page.getByText('東京都千代田区千代田')).toBeVisible();

		await input.fill('');
		await input.fill('１０００００１'); // 全角
		await expect(page.getByText('東京都千代田区千代田')).toBeVisible();
	});

	test('単発検索: 存在しない郵便番号は該当なしメッセージ', async ({ page }) => {
		await page
			.getByRole('textbox', { name: '検索する郵便番号' })
			.fill('9999999');
		await expect(page.getByText('該当する住所が見つかりません')).toBeVisible();
	});

	test('単発検索: 複数町域該当で候補件数が表示される', async ({ page }) => {
		// 4520961 = 愛知県清須市春日（多数の町域）
		await page
			.getByRole('textbox', { name: '検索する郵便番号' })
			.fill('452-0961');
		await expect(page.getByText(/件の町域があります/)).toBeVisible();
	});

	test('一括変換: 正常/形式エラー/該当なしが混在して変換される', async ({
		page,
	}) => {
		await page.getByRole('tab', { name: '一括変換' }).click();
		const textarea = page.getByRole('textbox', {
			name: '一括変換する郵便番号',
		});
		await textarea.fill('100-0001\nabc\n9999999\n0600000');
		await page.getByRole('button', { name: '住所に変換' }).click();

		// 結果テーブルに各ケースが現れる（使い方欄の説明文と区別するため cell で限定）
		await expect(
			page.getByRole('cell', { name: '千代田', exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole('cell', { name: '形式エラー', exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole('cell', { name: '該当なし', exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole('cell', { name: '札幌市中央区' }),
		).toBeVisible();
	});

	test('一括変換: CSVダウンロードがBOM付きUTF-8で出力される', async ({
		page,
	}) => {
		await page.getByRole('tab', { name: '一括変換' }).click();
		await page
			.getByRole('textbox', { name: '一括変換する郵便番号' })
			.fill('100-0001\n0600000');
		await page.getByRole('button', { name: '住所に変換' }).click();
		await expect(
			page.getByRole('cell', { name: '千代田', exact: true }),
		).toBeVisible();

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: /CSVダウンロード/ }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('zipcode_converted.csv');

		const buf = fs.readFileSync(await download.path());
		// BOM 先頭3バイト EF BB BF
		expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf]);
	});

	test('一括変換: 変換後に入力を変更すると旧結果とCSVが失効し、再変換で新入力の結果になる', async ({
		page,
	}) => {
		await page.getByRole('tab', { name: '一括変換' }).click();
		const textarea = page.getByRole('textbox', {
			name: '一括変換する郵便番号',
		});
		await textarea.fill('100-0001\nabc\n9999999\n0600000');
		await page.getByRole('button', { name: '住所に変換' }).click();
		await expect(
			page.getByRole('cell', { name: '千代田', exact: true }),
		).toBeVisible();
		await expect(page.getByText('4 行中 2 件を変換しました。')).toBeVisible();

		// 入力を1行に差し替える → 旧結果とCSVダウンロードが失効する
		await textarea.fill('530-0001');
		await expect(
			page.getByText('入力が変更されました。再変換してください。'),
		).toBeVisible();
		await expect(
			page.getByRole('cell', { name: '千代田', exact: true }),
		).not.toBeVisible();
		await expect(
			page.getByRole('button', { name: /CSVダウンロード/ }),
		).not.toBeVisible();

		// 再変換すると新しい入力に対応する結果だけが表示・出力される
		await page.getByRole('button', { name: '住所に変換' }).click();
		await expect(
			page.getByText('入力が変更されました。再変換してください。'),
		).not.toBeVisible();
		await expect(
			page.getByRole('cell', { name: '大阪市北区', exact: true }),
		).toBeVisible();

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: /CSVダウンロード/ }).click();
		const download = await downloadPromise;
		const buf = fs.readFileSync(await download.path());
		const csvText = buf.toString('utf-8');
		expect(csvText).toContain('530-0001');
		expect(csvText).not.toContain('千代田');

		// 入力の空欄化でも同様に失効する
		await textarea.fill('');
		await expect(
			page.getByText('入力が変更されました。再変換してください。'),
		).toBeVisible();
	});

	test('375px / 1440px でレスポンシブ表示される', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByRole('tab', { name: '単発検索' })).toBeVisible();
		await page
			.getByRole('textbox', { name: '検索する郵便番号' })
			.fill('100-0001');
		await expect(page.getByText('東京都千代田区千代田')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByRole('tab', { name: '一括変換' })).toBeVisible();
	});
});
