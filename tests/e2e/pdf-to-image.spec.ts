import fs from 'node:fs';
import { expect, test } from './fixtures/base';
import {
	blankPdf,
	ENCRYPTED_PDF,
	fixturePath,
	isBlue,
	isRed,
	ROTATED_EXPECTATIONS,
	rawPixels,
	readDownload,
	recordRequests,
	storageSnapshot,
} from './helpers/pdf-expansion';

type Page = import('@playwright/test').Page;

const fileInput = (page: Page) => page.locator('input[type="file"]');

async function upload(page: Page, name: string, pages: number) {
	await fileInput(page).setInputFiles(fixturePath(name));
	await expect(page.getByTestId('pdf-to-image-info')).toContainText(
		`全${pages}ページ`,
	);
}

async function downloadImage(page: Page, fileName: string) {
	const downloadPromise = page.waitForEvent('download');
	await page
		.getByRole('button', { name: `${fileName} をダウンロード` })
		.click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe(fileName);
	return readDownload(download);
}

test.describe('PDF→JPG/PNG変換', () => {
	test.beforeEach(async ({ createToolPage }) => {
		await createToolPage('pdf-to-image').goto();
	});

	test('ページ表示とSafetyBadge・プライバシー注記', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('pdf-to-image');
		await toolPage.expectTitle('PDF→JPG/PNG変換');
		await toolPage.expectSafetyBadge();
		await expect(
			page.getByText('PDFはサーバーに送信されません', { exact: false }).first(),
		).toBeVisible();
	});

	test('JPG: 全ページを連番で変換し、横向きページは横長・白背景・日本語が描画される', async ({
		page,
		baseURL,
	}) => {
		const recorder = recordRequests(page);
		await upload(page, 'text-ja.pdf', 3);
		await expect(page.getByLabel('変換するページ')).toHaveValue('1-3');
		await page.getByRole('button', { name: '画像に変換' }).click();
		const results = page.getByTestId('pdf-to-image-results');
		await expect(results).toContainText('3枚の画像を作成しました');
		for (const name of [
			'text-ja_p01.jpg',
			'text-ja_p02.jpg',
			'text-ja_p03.jpg',
		]) {
			await expect(results.getByText(name, { exact: true })).toBeVisible();
		}
		await expect(page.getByTestId('pdf-to-image-preview')).toBeVisible();

		// 2ページ目は 842×595pt の横向き。既定の144dpiで 1684×1190px
		const image = await downloadImage(page, 'text-ja_p02.jpg');
		expect(image.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
		const pixels = await rawPixels(image);
		expect([pixels.width, pixels.height]).toEqual([1684, 1190]);
		// 余白は白（JPGは白背景）
		const [r, g, b] = pixels.at(1600, 1100);
		expect(Math.min(r, g, b)).toBeGreaterThan(245);
		// 日本語テキスト行（左上 50pt, 上から約56〜80pt）に描画された暗い画素がある
		let dark = 0;
		for (let y = 112; y < 168; y += 2) {
			for (let x = 100; x < 676; x += 2) {
				const [pr, pg, pb] = pixels.at(x, y);
				if (pr + pg + pb < 300) dark++;
			}
		}
		expect(dark).toBeGreaterThan(50);

		recorder.assertNoLeak(baseURL ?? '', ['text-ja', '%PDF']);
		const storage = await storageSnapshot(page);
		expect(storage.url).not.toContain('text-ja');
		expect(JSON.stringify(storage.local)).not.toContain('text-ja');
		expect(JSON.stringify(storage.local)).not.toContain('1-3');
	});

	test('PNG: 回転ページを見たままの向きで出力し、背景を透過する', async ({
		page,
	}) => {
		await upload(page, 'rotated.pdf', 4);
		await page.getByRole('radio', { name: 'PNG' }).click();
		await page.getByRole('radio', { name: '72dpi' }).click();
		// PNGではJPEG品質の選択を表示しない
		await expect(page.locator('#pdf-to-image-quality-label')).toHaveCount(0);
		await page.getByRole('button', { name: '画像に変換' }).click();
		await expect(page.getByTestId('pdf-to-image-results')).toContainText(
			'4枚の画像を作成しました',
		);

		for (const [index, expected] of ROTATED_EXPECTATIONS.entries()) {
			const image = await downloadImage(page, `rotated_p0${index + 1}.png`);
			expect(image.subarray(1, 4).toString()).toBe('PNG');
			const pixels = await rawPixels(image);
			expect([pixels.width, pixels.height]).toEqual([...expected.size]);
			expect(
				isRed(pixels.at(expected.red[0], expected.red[1])),
				`${expected.rotate}度: 赤`,
			).toBe(true);
			expect(
				isBlue(pixels.at(expected.blue[0], expected.blue[1])),
				`${expected.rotate}度: 青`,
			).toBe(true);
			// 何も描かれていない中央は透明
			const center = pixels.at(
				Math.floor(expected.size[0] / 2),
				Math.floor(expected.size[1] / 2),
			);
			expect(center[3]).toBe(0);
		}
	});

	test('ページ範囲: 不正な指定は日本語エラーで実行できず、重複・逆順は昇順の連番になる', async ({
		page,
	}) => {
		await upload(page, 'text-ja.pdf', 3);
		const range = page.getByLabel('変換するページ');
		const run = page.getByRole('button', { name: '画像に変換' });
		await range.fill('0');
		await expect(page.getByTestId('pdf-to-image-range-errors')).toContainText(
			'1以上で指定してください',
		);
		await expect(run).toBeDisabled();
		await range.fill('4');
		await expect(page.getByTestId('pdf-to-image-range-errors')).toContainText(
			'このPDFは全3ページです',
		);
		await expect(run).toBeDisabled();
		await range.fill('');
		await expect(
			page.getByText('変換するページを入力してください'),
		).toBeVisible();
		await expect(run).toBeDisabled();

		await range.fill('3,１、3');
		await run.click();
		const results = page.getByTestId('pdf-to-image-results');
		await expect(results).toContainText('2枚の画像を作成しました');
		await expect(results.getByRole('listitem')).toHaveText([
			/text-ja_p01\.jpg/,
			/text-ja_p03\.jpg/,
		]);
	});

	test('16メガピクセルを超える出力は日本語エラーで止め、解像度を下げると変換できる', async ({
		page,
	}) => {
		await fileInput(page).setInputFiles({
			name: 'poster.pdf',
			mimeType: 'application/pdf',
			buffer: await blankPdf(1, [2001, 2001]),
		});
		await expect(page.getByTestId('pdf-to-image-info')).toContainText(
			'全1ページ',
		);
		await page.getByRole('button', { name: '画像に変換' }).click();
		await expect(page.getByRole('alert')).toContainText('16メガピクセル');
		await expect(page.getByTestId('pdf-to-image-results')).toHaveCount(0);

		await page.getByRole('radio', { name: '96dpi' }).click();
		await page.getByRole('button', { name: '画像に変換' }).click();
		await expect(page.getByTestId('pdf-to-image-results')).toContainText(
			'2668×2668px',
		);
	});

	test('暗号化・破損・空・ページ数超過のPDFを日本語で拒否する', async ({
		page,
	}) => {
		const alert = page.getByRole('alert');
		await fileInput(page).setInputFiles(ENCRYPTED_PDF);
		await expect(alert).toContainText('パスワード付きPDFには対応していません');
		await fileInput(page).setInputFiles({
			name: 'broken.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.from('%PDF-1.7\nこれはPDFではありません'),
		});
		await expect(alert).toContainText('PDFを読み込めませんでした');
		await fileInput(page).setInputFiles({
			name: 'empty.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.alloc(0),
		});
		await expect(alert).toContainText('ファイルが空です');
		await fileInput(page).setInputFiles({
			name: 'pages101.pdf',
			mimeType: 'application/pdf',
			buffer: await blankPdf(101),
		});
		await expect(alert).toContainText('全101ページ');
		await expect(page.getByTestId('pdf-to-image-info')).toHaveCount(0);
	});

	test('変換中にキャンセルでき、結果を表示しない', async ({ page }) => {
		await fileInput(page).setInputFiles({
			name: 'many.pdf',
			mimeType: 'application/pdf',
			buffer: await blankPdf(60, [1400, 1400]),
		});
		await expect(page.getByTestId('pdf-to-image-info')).toContainText(
			'全60ページ',
		);
		await page.getByRole('radio', { name: 'PNG' }).click();
		await page.getByRole('button', { name: '画像に変換' }).click();
		await expect(page.getByText(/変換中…/)).toBeVisible();
		await page.getByRole('button', { name: 'キャンセル' }).click();
		await expect(page.getByText('変換をキャンセルしました')).toBeVisible();
		await expect(page.getByTestId('pdf-to-image-results')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: '画像に変換' }),
		).toBeEnabled();
	});

	test('新しいファイルを選ぶと前の結果・プレビューを表示しない', async ({
		page,
	}) => {
		await upload(page, 'text-ja.pdf', 3);
		await page.getByRole('button', { name: '画像に変換' }).click();
		await expect(page.getByTestId('pdf-to-image-results')).toBeVisible();
		await upload(page, 'rotated.pdf', 4);
		await expect(page.getByTestId('pdf-to-image-results')).toHaveCount(0);
		await expect(page.getByTestId('pdf-to-image-preview')).toHaveCount(0);
		await expect(page.getByLabel('変換するページ')).toHaveValue('1-4');
	});

	test('設定（形式・dpi）は保持し、ページ範囲は保持しない', async ({
		page,
	}) => {
		await upload(page, 'text-ja.pdf', 3);
		await page.getByRole('radio', { name: 'PNG' }).click();
		await page.getByRole('radio', { name: '96dpi' }).click();
		await page.getByLabel('変換するページ').fill('2');
		const storage = await storageSnapshot(page);
		expect(
			JSON.parse(storage.local['tool_settings_pdf-to-image'] ?? '{}'),
		).toEqual({
			format: 'png',
			dpi: 96,
			jpegQuality: 85,
		});
		// 再訪問（ハイドレーション完了まで待つ goto を使う）
		await page.goto('/pdf-to-image');
		await upload(page, 'text-ja.pdf', 3);
		await expect(page.getByRole('radio', { name: 'PNG' })).toBeChecked();
		await expect(page.getByRole('radio', { name: '96dpi' })).toBeChecked();
		await expect(page.getByLabel('変換するページ')).toHaveValue('1-3');
	});

	test('キーボードだけで形式を切り替えて変換・保存できる', async ({ page }) => {
		await upload(page, 'rotated.pdf', 4);
		const range = page.getByLabel('変換するページ');
		await range.focus();
		await range.fill('2');
		await page.getByRole('radio', { name: 'JPG' }).focus();
		await page.keyboard.press('ArrowRight');
		// 矢印キーでのフォーカス移動（roving focus）は非同期のため、移動を待ってから選択する
		const png = page.getByRole('radio', { name: 'PNG' });
		await expect(png).toBeFocused();
		await page.keyboard.press('Space');
		await expect(png).toBeChecked();
		await page.getByRole('button', { name: '画像に変換' }).focus();
		await page.keyboard.press('Enter');
		const save = page.getByRole('button', {
			name: 'rotated_p02.png をダウンロード',
		});
		await expect(save).toBeVisible();
		await save.focus();
		const downloadPromise = page.waitForEvent('download');
		await page.keyboard.press('Enter');
		expect((await downloadPromise).suggestedFilename()).toBe('rotated_p02.png');
	});

	test('375px / 1440px でレスポンシブ表示される', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await upload(page, 'text-ja.pdf', 3);
		await page.getByRole('button', { name: '画像に変換' }).click();
		await expect(page.getByTestId('pdf-to-image-results')).toBeVisible();
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth,
		);
		expect(overflow).toBe(false);
		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByTestId('pdf-to-image-preview')).toBeVisible();
	});
});

// 遅いファイル読み込みの途中で空ファイルへ再選択した場合のstale状態を再現する。
test('読み込み中の空PDFへの再選択で読み込み表示を終了し、次のPDFを処理できる', async ({
	page,
	createToolPage,
}) => {
	await page.addInitScript(() => {
		const read = File.prototype.arrayBuffer;
		File.prototype.arrayBuffer = async function () {
			if (this.name === 'slow.pdf')
				await new Promise((resolve) => setTimeout(resolve, 500));
			return read.call(this);
		};
	});
	await createToolPage('pdf-to-image').goto();
	await page.locator('input[type="file"]').setInputFiles({
		name: 'slow.pdf',
		mimeType: 'application/pdf',
		buffer: fs.readFileSync(fixturePath('text-ja.pdf')),
	});
	await expect(
		page.getByText('PDFを読み込み中…', { exact: true }),
	).toBeVisible();
	await page.locator('input[type="file"]').setInputFiles({
		name: 'empty.pdf',
		mimeType: 'application/pdf',
		buffer: Buffer.alloc(0),
	});
	await expect(page.getByRole('alert')).toContainText('空');
	await expect(page.getByText('PDFを読み込み中…', { exact: true })).toHaveCount(
		0,
	);
	await page
		.locator('input[type="file"]')
		.setInputFiles(fixturePath('text-ja.pdf'));
	await expect(page.getByTestId('pdf-to-image-info')).toContainText(
		'全3ページ',
	);
});
