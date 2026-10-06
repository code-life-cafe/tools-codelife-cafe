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

	test('JSON → CSV: 安全整数範囲外の整数を画面表示・ダウンロードとも桁落ちさせないこと', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page
			.getByLabel('JSON入力')
			.fill('[{"id":9007199254740993,"code":"00123"}]');
		await expect(page.getByLabel('CSV出力')).toHaveValue(
			'id,code\n9007199254740993,00123',
		);

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'ダウンロード' }).click();
		const download = await downloadPromise;
		const savePath = path.join(
			os.tmpdir(),
			`json-csv-bigint-${Date.now()}.csv`,
		);
		await download.saveAs(savePath);
		const content = fs.readFileSync(savePath, 'utf-8');
		expect(content).toContain('9007199254740993');
		expect(content).not.toContain('9007199254740992');
		fs.unlinkSync(savePath);
	});

	test('CSV → JSON: 安全整数範囲外のIDを型推論ONでも文字列として保持すること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page.getByRole('tab', { name: 'CSV → JSON' }).click();
		await page.getByLabel('CSV入力').fill('id,code\n9007199254740993,00123');

		await expect(page.getByLabel('JSON出力')).toHaveValue(
			/"id": "9007199254740993"/,
		);
		await expect(page.getByLabel('JSON出力')).not.toHaveValue(
			/9007199254740992/,
		);
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

	test('ファイルドロップ時もaccept対象外の形式を拒否すること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		const dropzone = page.getByRole('button', { name: /ファイルから読み込み/ });
		const dataTransfer = await page.evaluateHandle(() => {
			const transfer = new DataTransfer();
			transfer.items.add(
				new File(['not a json csv text file'], 'sample.png', {
					type: 'image/png',
				}),
			);
			return transfer;
		});
		await dropzone.dispatchEvent('drop', { dataTransfer });

		await expect(page.getByTestId('json-csv-error')).toContainText(
			'対応していないファイル形式です',
		);
		await expect(page.getByLabel('JSON入力')).toHaveValue('');
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

	// 1,048,576文字以上の有効なJSON配列（先頭行にNEWDATAの目印を含む）
	const buildLargeJson = () =>
		`[{"id":"NEWDATA","v":"x"},${Array.from({ length: 30000 }, () => '{"id":"row","v":"abcdefghijklmnopqrstuvwxyz"}').join(',')}]`;

	test('手動モード: 小データ変換後に1MB以上を貼ると古い結果のコピー・保存が無効化され、再変換後は新しい結果だけが持ち出せること', async ({
		page,
		createToolPage,
	}) => {
		const largeJson = buildLargeJson();
		expect(largeJson.length).toBeGreaterThanOrEqual(1024 * 1024);

		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page.getByRole('button', { name: 'サンプルデータ' }).click();
		await expect(page.getByLabel('CSV出力')).toHaveValue(SAMPLE_EXPECTED_CSV);
		await expect(
			page.getByRole('button', { name: 'ダウンロード' }),
		).toBeVisible();

		await page.getByLabel('JSON入力').fill(largeJson);

		// 古い結果は表示・コピー・保存のいずれもできない
		await expect(page.getByTestId('json-csv-stale-notice')).toBeVisible();
		await expect(page.getByLabel('CSV出力')).toHaveValue('');
		await expect(
			page.getByRole('button', { name: 'ダウンロード' }),
		).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'コピー', exact: true }),
		).toHaveCount(0);

		// 手動変換後は新しい入力の結果だけが得られる
		await page.getByRole('button', { name: '変換', exact: true }).click();
		await expect(page.getByTestId('json-csv-stale-notice')).toHaveCount(0);
		await expect(page.getByLabel('CSV出力')).toHaveValue(/NEWDATA/);
		await expect(page.getByLabel('CSV出力')).not.toHaveValue(/山田太郎/);

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'ダウンロード' }).click();
		const download = await downloadPromise;
		const filePath = await download.path();
		const content = fs.readFileSync(filePath, 'utf-8');
		expect(content).toContain('NEWDATA');
		expect(content).not.toContain('山田太郎');
	});

	test('手動モード: 変換後に入力や変換設定を変えると再変換まで結果が無効化されること', async ({
		page,
		createToolPage,
	}) => {
		const largeJson = buildLargeJson();
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await page.getByLabel('JSON入力').fill(largeJson);
		await page.getByRole('button', { name: '変換', exact: true }).click();
		await expect(page.getByLabel('CSV出力')).toHaveValue(/NEWDATA/);
		await expect(
			page.getByRole('button', { name: 'ダウンロード' }),
		).toBeVisible();

		// 入力を1文字変更 → 失効
		await page.getByLabel('JSON入力').press('End');
		await page.getByLabel('JSON入力').pressSequentially(' ');
		await expect(page.getByTestId('json-csv-stale-notice')).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'ダウンロード' }),
		).toHaveCount(0);

		// 再変換で復帰 → 変換設定（ヘッダー行）を変更 → 再び失効
		await page.getByRole('button', { name: '変換', exact: true }).click();
		await expect(
			page.getByRole('button', { name: 'ダウンロード' }),
		).toBeVisible();
		await page
			.getByRole('switch', { name: /ヘッダー/ })
			.first()
			.click();
		await expect(page.getByTestId('json-csv-stale-notice')).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'ダウンロード' }),
		).toHaveCount(0);
	});

	// slow- で始まる名前のファイルは File.text() の完了を1.5秒遅らせる（読込完了順の逆転を再現する）
	const delaySlowFileReads = async (page: import('@playwright/test').Page) => {
		await page.addInitScript(() => {
			const original = File.prototype.text;
			File.prototype.text = function (this: File) {
				const delay = this.name.startsWith('slow-') ? 1500 : 0;
				return new Promise((resolve, reject) => {
					setTimeout(() => original.call(this).then(resolve, reject), delay);
				});
			};
		});
	};
	const dropFile = async (
		page: import('@playwright/test').Page,
		name: string,
		content: string,
	) => {
		const dataTransfer = await page.evaluateHandle(
			([fileName, body]) => {
				const transfer = new DataTransfer();
				transfer.items.add(
					new File([body], fileName, { type: 'application/json' }),
				);
				return transfer;
			},
			[name, content],
		);
		await page
			.getByRole('button', { name: /ファイルから読み込み/ })
			.dispatchEvent('drop', { dataTransfer });
	};

	test('ファイル読込中に入力を編集すると、遅れて完了した旧ファイルの結果で上書きされないこと', async ({
		page,
		createToolPage,
	}) => {
		await delaySlowFileReads(page);
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await dropFile(page, 'slow-a.json', '[{"id":"FILE_A"}]');
		await page.getByLabel('JSON入力').fill('[{"id":"TYPED_B"}]');
		await expect(page.getByLabel('CSV出力')).toHaveValue(/TYPED_B/);

		// 旧ファイルの読込完了を待っても、入力・出力は新しい入力のまま
		await page.waitForTimeout(2000);
		await expect(page.getByLabel('JSON入力')).toHaveValue('[{"id":"TYPED_B"}]');
		await expect(page.getByLabel('CSV出力')).toHaveValue(/TYPED_B/);
		await expect(page.getByLabel('CSV出力')).not.toHaveValue(/FILE_A/);
	});

	test('ファイルを続けて選択すると、読込完了順に関わらず最後に選んだファイルの結果だけが残ること', async ({
		page,
		createToolPage,
	}) => {
		await delaySlowFileReads(page);
		const toolPage = createToolPage('json-csv');
		await toolPage.goto();

		await dropFile(page, 'slow-a.json', '[{"id":"FILE_A"}]');
		await dropFile(page, 'fast-b.json', '[{"id":"FILE_B"}]');
		await expect(page.getByLabel('CSV出力')).toHaveValue(/FILE_B/);

		await page.waitForTimeout(2000);
		await expect(page.getByLabel('JSON入力')).toHaveValue('[{"id":"FILE_B"}]');
		await expect(page.getByLabel('CSV出力')).toHaveValue(/FILE_B/);
		await expect(page.getByLabel('CSV出力')).not.toHaveValue(/FILE_A/);
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
