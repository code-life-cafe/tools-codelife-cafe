import path from 'node:path';
import { expect, test } from './fixtures/base';

test.describe('CSV文字化け修復ツール', () => {
	test.beforeEach(async ({ page, createToolPage }) => {
		const toolPage = createToolPage('csv-fixer');
		await toolPage.goto();
		await toolPage.expectSafetyBadge();
		// Reactのハイドレーションを待機（input[type="file"]はマウント後にのみレンダリングされるため）
		await page.waitForSelector('input[type="file"]', { state: 'attached' });
	});

	test('Shift_JISファイルが正しく検出・変換されること', async ({ page }) => {
		// Check elements exist
		await expect(
			page.getByRole('button', { name: /CSVファイルを選択またはドラッグ/ }),
		).toBeVisible();

		// Setup file to upload
		await page
			.locator('input[type="file"]')
			.setInputFiles(
				path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'shift_jis.csv'),
			);

		// Wait for detection and preview
		await expect(page.getByText('現在のエンコーディング')).toBeVisible();
		await expect(page.getByText('Shift_JIS').first()).toBeVisible();

		// Check preview data (should decode properly without mojibake)
		await expect(page.getByRole('cell', { name: '山田太郎' })).toBeVisible();

		// Verify Output settings defaults
		const _outputEncodingSelect = page.getByRole('combobox', {
			name: '出力エンコーディング',
		});
		await expect(page.getByText('UTF-8 (推奨)')).toBeVisible();

		// Start download
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: '変換してダウンロード' }).click();
		const download = await downloadPromise;

		expect(download.suggestedFilename()).toBe('shift_jis_converted.csv');
	});

	test('無効なファイルフォーマットが拒否されること', async ({ page }) => {
		await page
			.locator('input[type="file"]')
			.setInputFiles(
				path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'invalid.xlsx'),
			);

		// Check error message
		await expect(
			page.getByText('CSV、TSV、TXTファイルのみ対応しています。'),
		).toBeVisible();
	});

	test('即時変換モードが動作すること', async ({ page, context: _context }) => {
		// Enable instant mode
		await page.getByRole('switch', { name: '即時変換モード' }).click();

		// Setup download listener BEFORE file upload
		const downloadPromise = page.waitForEvent('download');

		// Upload file
		await page
			.locator('input[type="file"]')
			.setInputFiles(
				path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'shift_jis.csv'),
			);

		// Should download automatically
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('shift_jis_converted.csv');

		// UI should show 'done' state
		await expect(
			page.getByRole('button', { name: 'ダウンロード完了' }),
		).toBeVisible();
	});
	test('EUC-JPファイルが正しく検出され、警告が出ないこと', async ({ page }) => {
		// Choose file
		await page
			.locator('input[type="file"]')
			.setInputFiles(
				path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'euc_jp.csv'),
			);

		// Verify the file was detected as EUC-JP
		await expect(page.getByText('現在のエンコーディング')).toBeVisible();
		await expect(page.getByText('EUC-JP').first()).toBeVisible();

		// Verify NOT showing low confidence alert
		await expect(
			page.getByText('エンコーディングの自動検出の信頼度が低いです'),
		).not.toBeVisible();
	});

	test('UTF-8ファイル（BOMあり）が正しく検出・変換されること', async ({
		page,
	}) => {
		await page
			.locator('input[type="file"]')
			.setInputFiles(
				path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'utf8_bom.csv'),
			);

		await expect(page.getByText('現在のエンコーディング')).toBeVisible();
		await expect(page.getByText('UTF-8').first()).toBeVisible();

		await expect(
			page.getByLabel('BOM (バイトオーダーマーク) を付与する'),
		).toBeChecked();

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: '変換してダウンロード' }).click();
		const download = await downloadPromise;

		expect(download.suggestedFilename()).toBe('utf8_bom_converted.csv');
	});

	test('手動でエンコーディングを変更するとプレビューが更新されること', async ({
		page,
	}) => {
		await page
			.locator('input[type="file"]')
			.setInputFiles(
				path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'utf8_no_bom.csv'),
			);
		await expect(page.getByText('UTF-8').first()).toBeVisible();
		await expect(page.getByRole('cell', { name: '山田太郎' })).toBeVisible();

		await page.locator('button[role="combobox"]').first().click();
		await page.getByRole('option', { name: 'Shift_JIS' }).click();

		await expect(
			page.getByRole('cell', { name: '山田太郎' }),
		).not.toBeVisible();
	});

	test('即時モードONで低信頼度の場合は自動ダウンロードが発火せずフォールバックされること', async ({
		page,
	}) => {
		await page.getByRole('switch', { name: '即時変換モード' }).click();

		let downloadCount = 0;
		page.on('download', () => downloadCount++);

		await page
			.locator('input[type="file"]')
			.setInputFiles(
				path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'small.csv'),
			);

		await expect(
			page.getByText('エンコーディングの自動検出の信頼度が低いです'),
		).toBeVisible();

		await page.waitForTimeout(1000);
		expect(downloadCount).toBe(0);

		await expect(
			page.getByRole('button', { name: '変換してダウンロード' }),
		).toBeVisible();
	});
});
