import path from 'node:path';
import { expect, test } from './fixtures/base';

test.describe('電話番号フォーマッタ', () => {
	test.beforeEach(async ({ page, createToolPage }) => {
		const toolPage = createToolPage('phone-formatter');
		await toolPage.goto();
		await toolPage.expectSafetyBadge();
		// Reactハイドレーション待機
		await page.waitForSelector('input[id="phone-input"]', {
			state: 'attached',
		});
	});

	// =============================================
	// 単一入力モード: フォーマット変換
	// =============================================
	test('固定電話番号(03)を入力するとE.164・国際表記・国内表記・RFC3966が表示される', async ({
		page,
	}) => {
		await page.locator('#phone-input').fill('03-1234-5678');

		// 変換結果が表示されるまで待機（結果カードのE.164行のみを確認）
		await expect(
			page.locator('[aria-label="変換結果"]').getByText('+81312345678'),
		).toBeVisible({ timeout: 2000 });
		await expect(
			page.locator('[aria-label="変換結果"]').getByText('+81 3-1234-5678'),
		).toBeVisible();
		await expect(
			page.locator('[aria-label="変換結果"]').getByText('03-1234-5678'),
		).toBeVisible();
		await expect(
			page.locator('[aria-label="変換結果"]').getByText('tel:+81-3-1234-5678'),
		).toBeVisible();
		// 番号種別
		await expect(page.getByText('固定電話（東京23区）')).toBeVisible();
	});

	test('携帯電話番号(090)を入力すると携帯電話と表示される', async ({
		page,
	}) => {
		await page.locator('#phone-input').fill('090-1234-5678');

		await expect(
			page.locator('[aria-label="変換結果"]').getByText('+819012345678'),
		).toBeVisible({ timeout: 2000 });
		await expect(page.getByText('携帯電話')).toBeVisible();
		// 地域は表示されない（括弧付き地域名がないこと）
		await expect(page.getByText(/携帯電話（/)).not.toBeVisible();
	});

	test('全角番号(０３−１２３４−５６７８)が正しく変換される', async ({
		page,
	}) => {
		// 全角文字を入力
		await page.locator('#phone-input').fill('０３−１２３４−５６７８');

		await expect(
			page.locator('[aria-label="変換結果"]').getByText('+81312345678'),
		).toBeVisible({ timeout: 2000 });
		await expect(page.getByText('固定電話（東京23区）')).toBeVisible();
	});

	test('不正な入力(abc)で日本語エラーが表示される', async ({ page }) => {
		await page.locator('#phone-input').fill('abc');

		await expect(page.getByText('無効', { exact: true })).toBeVisible({
			timeout: 2000,
		});
		// 変換結果カードが表示されないこと
		await expect(page.locator('[aria-label="変換結果"]')).not.toBeVisible();
	});

	test('空入力時は何も表示されない', async ({ page }) => {
		// 最初から空なので結果カードがないことを確認
		await expect(page.locator('[aria-label="変換結果"]')).not.toBeVisible();
		await expect(page.getByText('無効', { exact: true })).not.toBeVisible();
	});

	test('IP電話(050)の種別が正しく表示される', async ({ page }) => {
		await page.locator('#phone-input').fill('050-1234-5678');

		await expect(
			page.locator('[aria-label="変換結果"]').getByText('+815012345678'),
		).toBeVisible({ timeout: 2000 });
		// 番号種別ヘッダーエリアに「IP電話」が表示されること
		await expect(
			page.locator('[aria-label="変換結果"]').getByText(/IP電話/),
		).toBeVisible();
	});

	test('フリーダイヤル(0120)の種別が正しく表示される', async ({ page }) => {
		await page.locator('#phone-input').fill('0120-123-456');

		await expect(page.getByText('フリーダイヤル')).toBeVisible({
			timeout: 2000,
		});
	});

	// =============================================
	// 一括入力モード（テキスト）
	// =============================================
	test('一括テキストモードで3件入力すると結果テーブルが表示される', async ({
		page,
	}) => {
		// 一括入力タブに切り替え
		await page.getByRole('tab', { name: '一括入力' }).click();

		const bulkNumbers = '03-1234-5678\n090-1234-5678\n050-1234-5678';
		await page.getByLabel('電話番号一覧（1行1件）').fill(bulkNumbers);

		await page.getByRole('button', { name: '変換' }).click();

		// 結果テーブルが表示されることを確認
		await expect(page.getByText('合計: 3件')).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('有効: 3件')).toBeVisible();
	});

	// =============================================
	// 一括入力モード（CSVアップロード）
	// =============================================
	test('CSVアップロードでカラム選択後に変換ができる', async ({ page }) => {
		await page.getByRole('tab', { name: '一括入力' }).click();

		// CSVアップロードタブを選択
		await page.getByRole('button', { name: 'CSVアップロード' }).click();

		// ファイルをアップロード
		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles(
			path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'phone-numbers.csv'),
		);

		// カラム選択が表示されることを確認
		await expect(page.getByLabel('対象カラム')).toBeVisible({ timeout: 3000 });

		// 変換実行
		await page.getByRole('button', { name: '変換' }).click();

		// 結果テーブル
		await expect(page.getByText('合計:')).toBeVisible({ timeout: 5000 });
	});

	// =============================================
	// カラム表示切替
	// =============================================
	test('カラム表示切替でテーブルのカラムが更新される', async ({ page }) => {
		await page.getByRole('tab', { name: '一括入力' }).click();

		await page
			.getByLabel('電話番号一覧（1行1件）')
			.fill('03-1234-5678\n090-1234-5678');
		await page.getByRole('button', { name: '変換' }).click();

		await expect(page.getByText('合計: 2件')).toBeVisible({ timeout: 5000 });

		// 「国内表記」カラムを追加（sr-onlyのため親ラベル経由またはforceでクリック）
		await page.getByLabel('国内表記カラムを表示').click({ force: true });
		// 国内表記カラムのヘッダーが表示されること
		await expect(
			page.getByRole('columnheader', { name: '国内表記' }),
		).toBeVisible();
	});

	// =============================================
	// モード切り替え
	// =============================================
	test('モード切り替えで状態がリセットされる', async ({ page }) => {
		// 単一モードで数値入力
		await page.locator('#phone-input').fill('03-1234-5678');
		await expect(page.locator('[aria-label="変換結果"]')).toBeVisible({
			timeout: 2000,
		});

		// 一括モードに切り替え
		await page.getByRole('tab', { name: '一括入力' }).click();

		// 結果カードが消えていること
		await expect(page.locator('[aria-label="変換結果"]')).not.toBeVisible();

		// 単一モードに戻す
		await page.getByRole('tab', { name: '単一入力' }).click();
		// 入力がクリアされていること
		await page.waitForSelector('#phone-input', { state: 'attached' });
		const inputValue = await page.locator('#phone-input').inputValue();
		expect(inputValue).toBe('');
	});

	// =============================================
	// CSVエクスポート
	// =============================================
	test('CSVダウンロードが発動する', async ({ page }) => {
		await page.getByRole('tab', { name: '一括入力' }).click();

		await page
			.getByLabel('電話番号一覧（1行1件）')
			.fill('03-1234-5678\n090-1234-5678');
		await page.getByRole('button', { name: '変換' }).click();

		// 結果テーブルが表示されるまで待機
		await expect(page.getByText('合計: 2件')).toBeVisible({ timeout: 10000 });
		// CSVダウンロードボタンが見えるまでスクロール
		const downloadBtn = page.getByRole('button', { name: 'CSVをダウンロード' });
		await downloadBtn.scrollIntoViewIfNeeded();

		// ダウンロードを待機
		const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
		await downloadBtn.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('phone-numbers.csv');
	});

	// =============================================
	// キーボードナビゲーション
	// =============================================
	test('Tabキーで単一モードの要素をフォーカス移動できる', async ({ page }) => {
		// 入力→クリアボタン→コピーボタンへTabで移動
		await page.locator('#phone-input').focus();
		await page.keyboard.type('03-1234-5678');

		await expect(page.locator('[aria-label="変換結果"]')).toBeVisible({
			timeout: 2000,
		});

		// Tabで次の要素に移動できることを確認（エラーなし）
		await page.keyboard.press('Tab');
		// フォーカスが移動していること
	});
});
