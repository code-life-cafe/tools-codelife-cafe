import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/base';
import { getCanvasPixel } from './helpers/canvas';

const RED = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'merge-red-120x80.png',
);
const BLUE = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'merge-blue-80x60.png',
);

const INVALID_XLSX = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'invalid.xlsx',
);

// Playwright の setInputFiles はパスとバッファを混在できないため、混在ケースはすべてバッファで渡す
const asPayload = (filePath: string, mimeType: string) => ({
	name: path.basename(filePath),
	mimeType,
	buffer: fs.readFileSync(filePath),
});
const RED_PAYLOAD = asPayload(RED, 'image/png');
const BLUE_PAYLOAD = asPayload(BLUE, 'image/png');
const INVALID_XLSX_PAYLOAD = asPayload(
	INVALID_XLSX,
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
);

// PNGのMIME・拡張子だが中身がデコードできない「破損PNG」。input の accept は通るが createImageBitmap が失敗する
const BROKEN_PNG = {
	name: 'broken.png',
	mimeType: 'image/png',
	buffer: Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		Buffer.from('this is not a valid png body'),
	]),
};

const errorAlert = (page: import('@playwright/test').Page) =>
	page.getByRole('alert');

const fileInput = (page: import('@playwright/test').Page) =>
	page.locator('input[type="file"]');

const previewCanvas = (page: import('@playwright/test').Page) =>
	page.getByTestId('merge-preview-canvas');

async function canvasSize(
	page: import('@playwright/test').Page,
): Promise<[number, number]> {
	return previewCanvas(page).evaluate((el) => {
		const c = el as HTMLCanvasElement;
		return [c.width, c.height];
	});
}

async function uploadAndWait(
	page: import('@playwright/test').Page,
	files: string | string[],
) {
	await fileInput(page).setInputFiles(files);
	// プレビューcanvasが描画される（width>0）まで待つ
	await expect.poll(async () => (await canvasSize(page))[0]).toBeGreaterThan(0);
}

test.describe('画像連結・コンタクトシート', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('image-merge');
		await toolPage.goto();
	});

	test('ページ表示とSafetyBadge・プライバシー注記', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('image-merge');
		await toolPage.expectTitle('画像結合ツール');
		await toolPage.expectSafetyBadge();
		await expect(
			page
				.getByText('画像はサーバーに送信されません', { exact: false })
				.first(),
		).toBeVisible();
	});

	test('2枚投入→縦結合→ダウンロード（出力サイズ検証）', async ({ page }) => {
		await uploadAndWait(page, [RED, BLUE]);

		// デフォルト（縦・幅をそろえる・余白0）: 赤120x80 + 青を幅120へ拡大(120x90) = 120x170
		await expect.poll(async () => canvasSize(page)).toEqual([120, 170]);
		await expect(page.getByText('出力サイズ: 120×170px')).toBeVisible();

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: '結合画像をダウンロード' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('merged.png');

		const buf = fs.readFileSync(await download.path());
		// PNGシグネチャ
		expect(buf[0]).toBe(0x89);
		expect(buf[1]).toBe(0x50);
		// IHDR の幅・高さ（offset 16 / 20）
		expect(buf.readUInt32BE(16)).toBe(120);
		expect(buf.readUInt32BE(20)).toBe(170);
	});

	test('横結合・グリッド（列数2）が反映される', async ({ page }) => {
		await uploadAndWait(page, [RED, BLUE]);

		// 横に連結: 高さを最大(80)にそろえる。赤120x80 + 青(80x60→107x80) = 227x80
		await page.getByRole('combobox', { name: '結合モード' }).click();
		await page.getByRole('option', { name: '横に連結' }).click();
		await expect.poll(async () => canvasSize(page)).toEqual([227, 80]);

		// グリッド（列数2）: 統一幅120のセル2列1行 = 240x80
		await page.getByRole('combobox', { name: '結合モード' }).click();
		await page.getByRole('option', { name: 'グリッド' }).click();
		await expect(
			page.getByRole('spinbutton', { name: 'グリッド列数' }),
		).toHaveValue('2');
		await expect.poll(async () => canvasSize(page)).toEqual([240, 80]);
	});

	test('並び替えが結果に反映される', async ({ page }) => {
		await uploadAndWait(page, [RED, BLUE]);

		// 初期: 縦結合で上が赤
		await expect
			.poll(async () => getCanvasPixel(page, 'merge-preview-canvas', 60, 20))
			.toEqual([255, 0, 0, 255]);

		// 2枚目（青）を前へ移動 → 上が青になる
		await page.getByRole('button', { name: '2枚目を前へ移動' }).click();
		await expect
			.poll(async () => getCanvasPixel(page, 'merge-preview-canvas', 40, 20))
			.toEqual([0, 0, 255, 255]);
	});

	test('375px / 1440px でレスポンシブ表示される', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByText('画像をドラッグ＆ドロップ')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await uploadAndWait(page, [RED, BLUE]);
		await expect(previewCanvas(page)).toBeVisible();
	});
	test.describe('不正ファイル混在時のエラー表示（#608）', () => {
		test('正常PNGと非対応形式を同時投入: エラーが残り、正常分のプレビューも作られる', async ({
			page,
		}) => {
			await fileInput(page).setInputFiles([RED_PAYLOAD, INVALID_XLSX_PAYLOAD]);

			// 正常分（赤120x80）だけでプレビューが完成する
			await expect.poll(async () => canvasSize(page)).toEqual([120, 80]);
			await expect(page.getByText('出力サイズ: 120×80px')).toBeVisible();
			// プレビュー完成後も、拒否したファイルのエラーは消えない
			await expect(errorAlert(page)).toBeVisible();
			await expect(errorAlert(page)).toContainText('invalid.xlsx');
		});

		test('正常PNGと破損PNG（acceptは通るがデコード失敗）を同時投入: 読み込み失敗のエラーが残る', async ({
			page,
		}) => {
			await fileInput(page).setInputFiles([RED_PAYLOAD, BROKEN_PNG]);

			await expect.poll(async () => canvasSize(page)).toEqual([120, 80]);
			await expect(errorAlert(page)).toBeVisible();
			await expect(errorAlert(page)).toContainText(
				'broken.png: 画像の読み込みに失敗しました。',
			);

			// 続けて正常画像だけを追加すると、エラーは消えて2枚で結合される
			await fileInput(page).setInputFiles([BLUE_PAYLOAD]);
			await expect.poll(async () => canvasSize(page)).toEqual([120, 170]);
			await expect(errorAlert(page)).toHaveCount(0);
		});

		test('全ファイルが不正: エラーのみ表示され、プレビューは作られない', async ({
			page,
		}) => {
			await fileInput(page).setInputFiles([INVALID_XLSX_PAYLOAD, BROKEN_PNG]);

			await expect(errorAlert(page)).toContainText('invalid.xlsx');
			await expect(errorAlert(page)).toContainText('broken.png');
			await expect(page.getByText(/出力サイズ:/)).toHaveCount(0);
		});

		test('すべてクリアでエラーも消える', async ({ page }) => {
			await fileInput(page).setInputFiles([RED_PAYLOAD, INVALID_XLSX_PAYLOAD]);
			await expect.poll(async () => canvasSize(page)).toEqual([120, 80]);
			await expect(errorAlert(page)).toContainText('invalid.xlsx');

			await page.getByRole('button', { name: 'すべてクリア' }).click();
			await expect(errorAlert(page)).toHaveCount(0);
			await expect(page.getByText(/出力サイズ:/)).toHaveCount(0);
		});
	});
});

// #517: ファイル選択ダイアログやドロップの後は「直前の操作」と見なされず、
// 初回の画像追加で作業領域が挿入されると下の本文が押し下げられてCLSになっていた。
for (const { width, height } of [
	{ width: 375, height: 812 },
	{ width: 1440, height: 900 },
]) {
	test(`画像を初めて追加してもCLSが0.1以下で、作業領域の高さが変わらない (${width}px)`, async ({
		page,
		createToolPage,
	}) => {
		await page.setViewportSize({ width, height });
		await page.addInitScript(() => {
			const shifts: number[] = [];
			Object.assign(window, { __mergeShifts: shifts });
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					const shift = entry as PerformanceEntry & {
						value: number;
						hadRecentInput: boolean;
					};
					if (!shift.hadRecentInput) shifts.push(shift.value);
				}
			}).observe({ type: 'layout-shift', buffered: true });
		});
		await createToolPage('image-merge').goto();
		await page.evaluate(() => document.fonts.ready);
		await expect(page.getByText('画像をドラッグ＆ドロップ')).toBeVisible();
		const listArea = page.getByTestId('merge-image-list-area');
		const emptyListBox =
			(await listArea.count()) > 0 ? await listArea.boundingBox() : null;
		// 初期表示のシフトは対象外にし、画像追加で起きるシフトだけを測る
		await page.evaluate(() => {
			(window as unknown as { __mergeShifts: number[] }).__mergeShifts.length =
				0;
		});

		await fileInput(page).setInputFiles([RED_PAYLOAD, BLUE_PAYLOAD]);
		await expect.poll(async () => canvasSize(page)).toEqual([120, 170]);
		await expect(page.getByText('出力サイズ: 120×170px')).toBeVisible();
		await page.waitForTimeout(750);

		const cls = await page.evaluate(() =>
			(window as unknown as { __mergeShifts: number[] }).__mergeShifts.reduce(
				(sum, value) => sum + value,
				0,
			),
		);
		expect(cls).toBeLessThanOrEqual(0.1);
		// 一覧の領域は空の状態から確保されており、画像追加の前後で位置も高さも変わらない
		expect(emptyListBox).not.toBeNull();
		expect(await listArea.boundingBox()).toEqual(emptyListBox);
	});
}

// #738: スマホ写真のような大きい画像では、操作のたびにフル解像度で描き直すと
// 次の描画まで1〜2秒かかっていた。プレビューだけ縮小し、出力はフル解像度のまま。
test.describe('大きい画像のプレビュー縮小（#738）', () => {
	// 単色の 2000×1500 PNG をブラウザで作る（縦結合で 2000×3000 = 600万画素）
	async function makeLargePng(
		page: import('@playwright/test').Page,
		color: string,
	): Promise<Buffer> {
		const base64 = await page.evaluate(async (fill) => {
			const canvas = new OffscreenCanvas(2000, 1500);
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('2d context unavailable');
			ctx.fillStyle = fill;
			ctx.fillRect(0, 0, 2000, 1500);
			const blob = await canvas.convertToBlob({ type: 'image/png' });
			const bytes = new Uint8Array(await blob.arrayBuffer());
			let binary = '';
			for (let i = 0; i < bytes.length; i += 0x8000) {
				binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
			}
			return btoa(binary);
		}, color);
		return Buffer.from(base64, 'base64');
	}

	test('プレビューは200万画素以下に縮小され、出力サイズ表示とダウンロードはフル解像度', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('image-merge').goto();
		const red = await makeLargePng(page, '#ff0000');
		const blue = await makeLargePng(page, '#0000ff');
		await fileInput(page).setInputFiles([
			{ name: 'red-large.png', mimeType: 'image/png', buffer: red },
			{ name: 'blue-large.png', mimeType: 'image/png', buffer: blue },
		]);

		await expect(page.getByText('出力サイズ: 2000×3000px')).toBeVisible();
		await expect
			.poll(async () => (await canvasSize(page))[0])
			.toBeGreaterThan(0);
		const [w, h] = await canvasSize(page);
		expect(w * h).toBeLessThanOrEqual(2_000_000);
		expect(w).toBeLessThan(2000);
		// 縦横比（2:3）は保たれる
		expect(Math.abs(w / h - 2000 / 3000)).toBeLessThan(0.01);

		// 縮小プレビューでも上半分が赤・下半分が青
		await expect
			.poll(async () =>
				getCanvasPixel(
					page,
					'merge-preview-canvas',
					Math.floor(w / 2),
					Math.floor(h / 4),
				),
			)
			.toEqual([255, 0, 0, 255]);
		await expect
			.poll(async () =>
				getCanvasPixel(
					page,
					'merge-preview-canvas',
					Math.floor(w / 2),
					Math.floor((h * 3) / 4),
				),
			)
			.toEqual([0, 0, 255, 255]);

		// 並び替えも縮小プレビューに反映される（上が青になる）
		await page.getByRole('button', { name: '2枚目を前へ移動' }).click();
		await expect
			.poll(async () =>
				getCanvasPixel(
					page,
					'merge-preview-canvas',
					Math.floor(w / 2),
					Math.floor(h / 4),
				),
			)
			.toEqual([0, 0, 255, 255]);

		// ダウンロードはフル解像度（IHDR の幅・高さ）
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: '結合画像をダウンロード' }).click();
		const download = await downloadPromise;
		const buf = fs.readFileSync(await download.path());
		expect(buf.readUInt32BE(16)).toBe(2000);
		expect(buf.readUInt32BE(20)).toBe(3000);
	});
});
