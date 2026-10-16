import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { expect, test } from './fixtures/base';
import {
	blankPdf,
	ENCRYPTED_PDF,
	extractText,
	fixturePath,
	isBlue,
	isRed,
	pageJpegs,
	pageSizes,
	ROTATED_EXPECTATIONS,
	rawPixels,
	readDownload,
	recordRequests,
	storageSnapshot,
} from './helpers/pdf-expansion';

const fileInput = (page: import('@playwright/test').Page) =>
	page.locator('input[type="file"]');

async function upload(
	page: import('@playwright/test').Page,
	name: string,
	pages: number,
) {
	await fileInput(page).setInputFiles(fixturePath(name));
	await expect(page.getByTestId('pdf-compress-info')).toContainText(
		`全${pages}ページ`,
	);
}

async function chooseRaster(
	page: import('@playwright/test').Page,
	dpi: string,
	quality: string,
) {
	await page.getByRole('radio', { name: /画像化して圧縮/ }).check();
	await page.getByRole('radio', { name: dpi, exact: true }).click();
	await page.getByRole('radio', { name: quality, exact: true }).click();
	await page.getByLabel(/画質が変わることを理解しました/).check();
}

test.describe('PDF圧縮', () => {
	test.beforeEach(async ({ createToolPage }) => {
		await createToolPage('pdf-compress').goto();
	});

	test('ページ表示とSafetyBadge・プライバシー注記', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('pdf-compress');
		await toolPage.expectTitle('PDF圧縮');
		await toolPage.expectSafetyBadge();
		await expect(
			page.getByText('PDFはサーバーに送信されません', { exact: false }).first(),
		).toBeVisible();
	});

	test('標準: 文字PDFが小さくなり、日本語テキスト・ページ寸法を保ったPDFを保存できる', async ({
		page,
		baseURL,
	}) => {
		const recorder = recordRequests(page);
		await upload(page, 'text-ja.pdf', 3);
		// PDF.js（Worker・CMap）による1ページ目のプレビューが描画される
		const inputPreview = page.getByTestId('pdf-compress-input-preview');
		await expect(inputPreview).toBeVisible();
		expect(
			await inputPreview.evaluate((img: HTMLImageElement) => img.naturalWidth),
		).toBeGreaterThan(0);

		await page.getByRole('button', { name: '圧縮する' }).click();
		const result = page.getByTestId('pdf-compress-result');
		await expect(result).toContainText('圧縮しました');
		await expect(result).toContainText('%削減');
		await expect(page.getByTestId('pdf-compress-result-preview')).toBeVisible();

		const downloadPromise = page.waitForEvent('download');
		await page
			.getByRole('button', { name: '圧縮したPDFをダウンロード' })
			.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('text-ja_compressed.pdf');
		const output = await readDownload(download);
		const original = fs.readFileSync(fixturePath('text-ja.pdf'));
		expect(output.length).toBeLessThan(original.length);
		expect(await pageSizes(output)).toEqual(await pageSizes(original));
		const texts = await extractText(output);
		expect(texts[0]).toContain('日本語テキストの抽出確認');
		expect(texts).toEqual(await extractText(original));

		// 入力・ファイル名を外部送信・保存しない
		recorder.assertNoLeak(baseURL ?? '', ['text-ja', '%PDF']);
		const storage = await storageSnapshot(page);
		expect(storage.url).not.toContain('text-ja');
		expect(JSON.stringify(storage.local)).not.toContain('text-ja');
		expect(
			JSON.parse(storage.local['tool_settings_pdf-compress'] ?? '{}'),
		).toEqual({ dpi: 96, jpegQuality: 70 });
	});

	test('縮まないPDFは「これ以上小さくできませんでした」と表示し、保存ボタンを出さない', async ({
		page,
	}) => {
		await upload(page, 'compact.pdf', 1);
		await page.getByRole('button', { name: '圧縮する' }).click();
		await expect(page.getByTestId('pdf-compress-result')).toContainText(
			'これ以上小さくできませんでした',
		);
		await expect(
			page.getByRole('button', { name: '圧縮したPDFをダウンロード' }),
		).toHaveCount(0);
	});

	test('画像化: 同意するまで実行できず、スキャンPDFを72dpiで小さくしページ寸法を保つ', async ({
		page,
	}) => {
		await upload(page, 'scan.pdf', 2);
		await page.getByRole('radio', { name: /画像化して圧縮/ }).check();
		await expect(
			page.getByText('画像化すると次の情報が失われます'),
		).toBeVisible();
		const run = page.getByRole('button', { name: '画像化して圧縮する' });
		await expect(run).toBeDisabled();
		await chooseRaster(page, '72dpi', '品質50%');
		await expect(run).toBeEnabled();
		await run.click();
		await expect(page.getByTestId('pdf-compress-result')).toContainText(
			'画像化（72dpi・JPEG品質50%）',
		);

		const downloadPromise = page.waitForEvent('download');
		await page
			.getByRole('button', { name: '圧縮したPDFをダウンロード' })
			.click();
		const output = await readDownload(await downloadPromise);
		expect(output.length).toBeLessThan(
			fs.readFileSync(fixturePath('scan.pdf')).length,
		);
		expect(await pageSizes(output)).toEqual([
			{ width: 595, height: 842, rotation: 0 },
			{ width: 595, height: 842, rotation: 0 },
		]);
		// 72dpi では 1pt = 1px（595.28×841.89pt → 595×842px）
		for (const jpeg of await pageJpegs(output)) {
			const pixels = await rawPixels(jpeg);
			expect([pixels.width, pixels.height]).toEqual([595, 842]);
		}
	});

	test('画像化: 回転ページを見たままの向きで描画し、ページ寸法を入れ替える', async ({
		page,
	}) => {
		await upload(page, 'rotated.pdf', 4);
		await chooseRaster(page, '72dpi', '品質92%');
		await page.getByRole('button', { name: '画像化して圧縮する' }).click();
		const result = page.getByTestId('pdf-compress-result');
		await expect(result).toBeVisible();
		// 小さい図形だけのPDFは画像化で大きくなるため、元のファイルを保持する
		await expect(result).toContainText('これ以上小さくできませんでした');
	});

	test('暗号化・署名・フォーム・破損・空・非PDF・上限超過を日本語で拒否する', async ({
		page,
	}) => {
		const alert = page.getByRole('alert');
		await fileInput(page).setInputFiles(ENCRYPTED_PDF);
		await expect(alert).toContainText('パスワード付きPDFには対応していません');

		await fileInput(page).setInputFiles(fixturePath('signed.pdf'));
		await expect(alert).toContainText('電子署名');
		await fileInput(page).setInputFiles(fixturePath('signed-hidden.pdf'));
		await expect(alert).toContainText('電子署名');
		await fileInput(page).setInputFiles(fixturePath('form.pdf'));
		await expect(alert).toContainText('入力フォーム');

		await fileInput(page).setInputFiles({
			name: 'broken.pdf',
			mimeType: 'application/pdf',
			buffer: fs.readFileSync(fixturePath('text-ja.pdf')).subarray(0, 300),
		});
		await expect(alert).toContainText('PDFを読み込めませんでした');

		await fileInput(page).setInputFiles({
			name: 'empty.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.alloc(0),
		});
		await expect(alert).toContainText('ファイルが空です');

		await fileInput(page).setInputFiles({
			name: 'note.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('hello'),
		});
		await expect(alert).toContainText('PDFファイル（.pdf）を選択してください');

		await fileInput(page).setInputFiles({
			name: 'pages101.pdf',
			mimeType: 'application/pdf',
			buffer: await blankPdf(101),
		});
		await expect(alert).toContainText('全101ページ');

		// Playwright はバッファ渡しが50MBまでのため、一時ファイルにして渡す
		const tooLarge = Buffer.alloc(50 * 1024 * 1024 + 1, 0x20);
		tooLarge.write('%PDF-1.7', 0);
		const largePath = test.info().outputPath('large.pdf');
		fs.writeFileSync(largePath, tooLarge);
		await fileInput(page).setInputFiles(largePath);
		await expect(alert).toContainText('50MBを超えています');
		await expect(page.getByTestId('pdf-compress-info')).toHaveCount(0);
	});

	test('画像化の処理中にキャンセルでき、結果を表示しない', async ({ page }) => {
		await fileInput(page).setInputFiles({
			name: 'many.pdf',
			mimeType: 'application/pdf',
			buffer: await blankPdf(60, [1400, 1400]),
		});
		await expect(page.getByTestId('pdf-compress-info')).toContainText(
			'全60ページ',
		);
		await chooseRaster(page, '144dpi', '品質92%');
		await page.getByRole('button', { name: '画像化して圧縮する' }).click();
		await expect(page.getByText(/ページを画像化中/)).toBeVisible();
		await page.getByRole('button', { name: 'キャンセル' }).click();
		await expect(page.getByText('処理をキャンセルしました')).toBeVisible();
		await expect(page.getByTestId('pdf-compress-result')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: '画像化して圧縮する' }),
		).toBeEnabled();
	});

	test('新しいファイルを選ぶと前の結果を表示しない', async ({ page }) => {
		await upload(page, 'text-ja.pdf', 3);
		await page.getByRole('button', { name: '圧縮する' }).click();
		await expect(page.getByTestId('pdf-compress-result')).toBeVisible();
		await upload(page, 'compact.pdf', 1);
		await expect(page.getByTestId('pdf-compress-result')).toHaveCount(0);
		// 方式は毎回「標準」に戻る（画像化の同意を引き継がない）
		await expect(page.getByRole('radio', { name: /標準/ })).toBeChecked();
	});

	test('キーボードだけで画像化を選び、同意して実行できる', async ({ page }) => {
		await upload(page, 'scan.pdf', 2);
		await page.getByRole('radio', { name: /標準/ }).focus();
		await page.keyboard.press('ArrowDown');
		await expect(
			page.getByRole('radio', { name: /画像化して圧縮/ }),
		).toBeChecked();
		await page.getByLabel(/画質が変わることを理解しました/).focus();
		await page.keyboard.press('Space');
		const run = page.getByRole('button', { name: '画像化して圧縮する' });
		await run.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('pdf-compress-result')).toContainText(
			'圧縮しました',
		);
	});

	test('375px / 1440px でレスポンシブ表示される', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await upload(page, 'text-ja.pdf', 3);
		await expect(
			page.getByRole('radio', { name: /画像化して圧縮/ }),
		).toBeVisible();
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth,
		);
		expect(overflow).toBe(false);
		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByRole('button', { name: '圧縮する' })).toBeVisible();
	});
});

test.describe('PDF圧縮: 画像化の向き（画素）', () => {
	test('回転ページの描画結果を埋め込みJPEGの画素で確認する', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('pdf-compress').goto();
		// 元より大きくなる回転PDFでも描画結果を確認できるよう、参照されない乱数ストリーム
		// （画像化で破棄される）を足して元のサイズを大きくする
		const doc = await PDFDocument.load(
			fs.readFileSync(fixturePath('rotated.pdf')),
		);
		doc.context.register(doc.context.stream(randomBytes(200_000)));
		const padded = Buffer.from(await doc.save());
		await fileInput(page).setInputFiles({
			name: 'rotated-padded.pdf',
			mimeType: 'application/pdf',
			buffer: padded,
		});
		await expect(page.getByTestId('pdf-compress-info')).toContainText(
			'全4ページ',
		);
		await chooseRaster(page, '72dpi', '品質92%');
		await page.getByRole('button', { name: '画像化して圧縮する' }).click();
		await expect(page.getByTestId('pdf-compress-result')).toContainText(
			'圧縮しました',
		);
		const downloadPromise = page.waitForEvent('download');
		await page
			.getByRole('button', { name: '圧縮したPDFをダウンロード' })
			.click();
		const output = await readDownload(await downloadPromise);

		expect(await pageSizes(output)).toEqual(
			ROTATED_EXPECTATIONS.map((e) => ({
				width: e.size[0],
				height: e.size[1],
				rotation: 0,
			})),
		);
		const jpegs = await pageJpegs(output);
		for (const [index, expected] of ROTATED_EXPECTATIONS.entries()) {
			const pixels = await rawPixels(jpegs[index]);
			expect([pixels.width, pixels.height]).toEqual([...expected.size]);
			expect(
				isRed(pixels.at(expected.red[0], expected.red[1])),
				`${expected.rotate}度: 赤の位置`,
			).toBe(true);
			expect(
				isBlue(pixels.at(expected.blue[0], expected.blue[1])),
				`${expected.rotate}度: 青の位置`,
			).toBe(true);
		}
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
	await createToolPage('pdf-compress').goto();
	await page.locator('input[type="file"]').setInputFiles({
		name: 'slow.pdf',
		mimeType: 'application/pdf',
		buffer: fs.readFileSync(fixturePath('text-ja.pdf')),
	});
	await expect(page.getByText('PDFを確認中…', { exact: true })).toBeVisible();
	await page.locator('input[type="file"]').setInputFiles({
		name: 'empty.pdf',
		mimeType: 'application/pdf',
		buffer: Buffer.alloc(0),
	});
	await expect(page.getByRole('alert')).toContainText('空');
	await expect(page.getByText('PDFを確認中…', { exact: true })).toHaveCount(0);
	await page
		.locator('input[type="file"]')
		.setInputFiles(fixturePath('text-ja.pdf'));
	await expect(page.getByTestId('pdf-compress-info')).toContainText(
		'全3ページ',
	);
});

test('極端に細長いPDFのプレビューも描画上限内で扱う', async ({
	page,
	createToolPage,
}) => {
	await page.addInitScript(() => {
		const getContext = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (
			this: HTMLCanvasElement,
			...args: Parameters<typeof getContext>
		) {
			if (this.width * this.height > 16_000_000)
				throw new Error('preview pixel limit exceeded');
			return getContext.apply(this, args);
		} as typeof getContext;
	});
	await createToolPage('pdf-compress').goto();
	await page.locator('input[type="file"]').setInputFiles({
		name: 'tall.pdf',
		mimeType: 'application/pdf',
		buffer: await blankPdf(1, [1, 20_000_000]),
	});
	await expect(page.getByTestId('pdf-compress-info')).toContainText(
		'全1ページ',
	);
	await expect(page.getByTestId('pdf-compress-input-preview')).toHaveCount(0);
	await page
		.getByRole('radio', { name: '画像化して圧縮', exact: false })
		.check();
	await page.getByRole('checkbox').check();
	await page
		.getByRole('button', { name: '画像化して圧縮する', exact: true })
		.click();
	await expect(page.getByRole('alert')).toContainText('16メガピクセル');
});

test('画像化圧縮の画像生成失敗はPDF破損ではなく解像度を下げる案内を表示する', async ({
	page,
	createToolPage,
}) => {
	await createToolPage('pdf-compress').goto();
	await upload(page, 'scan.pdf', 2);
	await chooseRaster(page, '72dpi', '品質50%');
	await page.evaluate(() => {
		HTMLCanvasElement.prototype.toBlob = (callback) => {
			callback(null);
		};
	});
	await page
		.getByRole('button', { name: '画像化して圧縮する', exact: true })
		.click();
	await expect(page.getByRole('alert')).toContainText(
		'解像度を下げてお試しください',
	);
	await expect(page.getByRole('alert')).not.toContainText('破損');
});
