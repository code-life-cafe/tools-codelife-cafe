import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/base';

// JsonCsvPage.tsx の SAMPLE_JSON をデフォルトオプションで変換した期待CSV。
// 実際の出力（ダウンロード）は CRLF だが、textarea の value は DOM 仕様で LF に正規化される
const SAMPLE_EXPECTED_CSV = [
	'name,age,contact.email,contact.tel,tags.0,tags.1',
	'山田太郎,30,taro@example.com,03-1234-5678,営業,リーダー',
	'鈴木花子,25,hanako@example.com,06-9876-5432,開発,',
].join('\n');

test.describe('JSON-CSV Converter Tool', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();
		await toolPage.expectTitle('JSON ↔ CSV 相互変換ツール');
		await toolPage.expectSafetyBadge();
	});

	test('サンプルJSON → CSV 変換結果が期待値と一致すること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page.getByRole('button', { name: 'サンプルデータ' }).click();
		await expect(page.getByLabel('CSV出力')).toHaveValue(SAMPLE_EXPECTED_CSV);
		await expect(page.getByText('2行を変換しました')).toBeVisible();
	});

	test('ネストJSON + フラット化ONでドット記法ヘッダーになること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page
			.getByLabel('JSON入力')
			.fill('[{"user":{"name":"太郎"},"items":["a","b"]}]');
		await expect(page.getByLabel('CSV出力')).toHaveValue(
			'user.name,items.0,items.1\n太郎,a,b',
		);

		// フラット化OFFではネストがJSON文字列セルになる
		await page
			.getByRole('switch', { name: 'ネストを展開（ドット記法）' })
			.click();
		await expect(page.getByLabel('CSV出力')).toHaveValue(
			/\{""name"":""太郎""\}/,
		);
	});

	test('CSV → JSON 変換（型推論ON/OFF）', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page.getByRole('tab', { name: 'CSV → JSON' }).click();
		await page
			.getByLabel('CSV入力')
			.fill('name,age,active,zip\n太郎,30,true,007');

		// 型推論ON: 数値・真偽値に変換、先頭ゼロは文字列のまま
		const output = page.getByLabel('JSON出力');
		await expect(output).toHaveValue(/"age": 30/);
		await expect(output).toHaveValue(/"active": true/);
		await expect(output).toHaveValue(/"zip": "007"/);

		// 型推論OFF: すべて文字列
		await page.getByRole('switch', { name: '型推論' }).click();
		await expect(output).toHaveValue(/"age": "30"/);
		await expect(output).toHaveValue(/"active": "true"/);
	});

	test('不正JSONで日本語エラーが表示されクラッシュしないこと', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page.getByLabel('JSON入力').fill('{"a": }');
		await expect(page.getByTestId('json-csv-error')).toContainText(
			'JSONの構文エラー',
		);

		// 修正すると復帰する
		await page.getByLabel('JSON入力').fill('{"a": 1}');
		await expect(page.getByLabel('CSV出力')).toHaveValue('a\n1');
	});

	test('クォート未閉じCSVで行番号付きエラーが表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page.getByRole('tab', { name: 'CSV → JSON' }).click();
		await page.getByLabel('CSV入力').fill('a,b\n1,"未閉じ');
		await expect(page.getByTestId('json-csv-error')).toContainText('行目');
		await expect(page.getByTestId('json-csv-error')).toContainText('引用符');
	});

	test('CSVダウンロード: BOM ON で先頭3バイトが EF BB BF', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page.getByRole('button', { name: 'サンプルデータ' }).click();
		await expect(page.getByLabel('CSV出力')).toHaveValue(SAMPLE_EXPECTED_CSV);

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'ダウンロード' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('converted.csv');

		const savePath = path.join(os.tmpdir(), `json-csv-bom-${Date.now()}.csv`);
		await download.saveAs(savePath);
		const bytes = fs.readFileSync(savePath);
		expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		fs.unlinkSync(savePath);
	});

	test('CSVダウンロード: BOM OFF では先頭にBOMが付かないこと', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page.getByRole('button', { name: 'サンプルデータ' }).click();
		await expect(page.getByLabel('CSV出力')).toHaveValue(SAMPLE_EXPECTED_CSV);
		await page.getByRole('switch', { name: 'BOM付きUTF-8' }).click();

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'ダウンロード' }).click();
		const download = await downloadPromise;

		const savePath = path.join(os.tmpdir(), `json-csv-nobom-${Date.now()}.csv`);
		await download.saveAs(savePath);
		const bytes = fs.readFileSync(savePath);
		expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
		fs.unlinkSync(savePath);
	});

	test('JSONダウンロード: ファイル名が converted.json になること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page.getByRole('tab', { name: 'CSV → JSON' }).click();
		await page.getByRole('button', { name: 'サンプルデータ' }).click();
		await expect(page.getByLabel('JSON出力')).toHaveValue(/山田太郎/);

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'ダウンロード' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('converted.json');
	});

	test('コピーが動作すること', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page.getByRole('button', { name: 'サンプルデータ' }).click();
		await expect(page.getByLabel('CSV出力')).toHaveValue(SAMPLE_EXPECTED_CSV);
		await page.getByRole('button', { name: 'コピー', exact: true }).click();
		// コピー後は aria-label が「コピーしました」に変わる
		await expect(
			page.getByRole('button', { name: 'コピーしました' }),
		).toBeVisible();
	});

	test('レスポンシブ表示（375px / 1440px）', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByLabel('JSON入力')).toBeVisible();
		await expect(page.getByLabel('CSV出力')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByLabel('JSON入力')).toBeVisible();
		await expect(page.getByLabel('CSV出力')).toBeVisible();
	});
});
