import path from 'node:path';
import { stackBlur } from '../../src/lib/tools/image-mosaic';
import { expect, test } from './fixtures/base';
import {
	countDiffFromFixture,
	dragOnCanvas,
	getCanvasPixel,
	imagePointToPage,
} from './helpers/canvas';

const FIXTURE = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'sample-400x300.png',
);

const WHITE = [255, 255, 255, 255];
const RED = [220, 40, 40, 255];

// フィクスチャは白地 + (100,80)〜(219,169) の赤矩形。
// 赤/白の境界をまたぐ位置にマスクをかけると、ブロック平均/ぼかしの結果が
// 白とも赤とも異なる値になり「変化した」ことを確実に検証できる。

async function uploadSample(page: import('@playwright/test').Page) {
	await page.locator('input[type="file"]').setInputFiles(FIXTURE);
	await expect(page.getByTestId('editor-canvas')).toBeVisible();
	// レンダーは rAF 経由の非同期のため、描画完了を poll で待つ
	await expect
		.poll(() => getCanvasPixel(page, 'editor-canvas', 150, 100))
		.toEqual(RED);
}

test.describe('画像モザイク・ぼかし', () => {
	test.beforeEach(async ({ page, createToolPage }) => {
		const toolPage = createToolPage('image-mosaic');
		await toolPage.goto();
		await expect(
			page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
		).toBeVisible({ timeout: 10000 });
	});

	test('ページ表示とSafetyBadge', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('image-mosaic');
		await toolPage.expectTitle('画像モザイク・ぼかし');
		await toolPage.expectSafetyBadge();
		// ページ説明文とドロップゾーン注記の両方に含まれるため first() で確認
		await expect(
			page
				.getByText('画像はサーバーに送信されません', { exact: false })
				.first(),
		).toBeVisible();
	});

	test('アップロードで元解像度のcanvasが表示される', async ({ page }) => {
		await uploadSample(page);
		const size = await page
			.getByTestId('editor-canvas')
			.evaluate((el) => [
				(el as HTMLCanvasElement).width,
				(el as HTMLCanvasElement).height,
			]);
		expect(size).toEqual([400, 300]);
	});

	test('ドラッグ選択でモザイクが領域内のみに適用される', async ({ page }) => {
		await uploadSample(page);
		const canvas = page.getByTestId('editor-canvas');

		// 赤/白の境界(x=100)をまたぐ領域を選択（ブロックサイズ デフォルト12）
		await dragOnCanvas(page, canvas, { x: 80, y: 60 }, { x: 180, y: 140 });

		// 境界をまたぐブロック内の点: 白とも赤とも異なる平均色になる
		await expect
			.poll(() => getCanvasPixel(page, 'editor-canvas', 96, 100))
			.not.toEqual(WHITE);
		expect(await getCanvasPixel(page, 'editor-canvas', 96, 100)).not.toEqual(
			RED,
		);

		// 同一ブロック内の2点は同値（ブロック平均化の性質）
		const p1 = await getCanvasPixel(page, 'editor-canvas', 95, 100);
		const p2 = await getCanvasPixel(page, 'editor-canvas', 100, 105);
		expect(p1).toEqual(p2);

		// 領域外は不変
		expect(await getCanvasPixel(page, 'editor-canvas', 300, 200)).toEqual(
			WHITE,
		);
		expect(await getCanvasPixel(page, 'editor-canvas', 150, 160)).toEqual(RED);
	});

	test('ぼかしモードに切り替えて適用できる', async ({ page }) => {
		await uploadSample(page);
		const canvas = page.getByTestId('editor-canvas');

		await page.getByRole('tab', { name: 'ぼかし' }).click();
		// 赤/白の境界(y=170)をまたぐ領域を選択
		await dragOnCanvas(page, canvas, { x: 60, y: 120 }, { x: 160, y: 200 });

		// 境界近くの赤ピクセルは白が混ざって変化する
		await expect
			.poll(() => getCanvasPixel(page, 'editor-canvas', 110, 165))
			.not.toEqual(RED);
		// 領域外は不変
		expect(await getCanvasPixel(page, 'editor-canvas', 300, 200)).toEqual(
			WHITE,
		);
	});

	test('強度スライダーで選択領域の出力が変わる', async ({ page }) => {
		await uploadSample(page);
		const canvas = page.getByTestId('editor-canvas');

		await dragOnCanvas(page, canvas, { x: 80, y: 60 }, { x: 180, y: 140 });
		await expect
			.poll(() => getCanvasPixel(page, 'editor-canvas', 96, 100))
			.not.toEqual(WHITE);
		const before = await getCanvasPixel(page, 'editor-canvas', 96, 100);

		// 領域をクリックして選択し、スライダーでブロックサイズを変更
		const center = await imagePointToPage(canvas, 130, 100);
		await page.mouse.click(center.x, center.y);
		const slider = page.getByRole('slider');
		await slider.focus();
		for (let i = 0; i < 10; i++) {
			await slider.press('ArrowRight');
		}

		await expect
			.poll(() => getCanvasPixel(page, 'editor-canvas', 96, 100))
			.not.toEqual(before);

		// スライダー変更は1操作=1履歴: undoを繰り返すと変更前の強度に戻り、
		// さらにundoすると領域追加自体が取り消される
		for (let i = 0; i < 10; i++) {
			await page.getByRole('button', { name: '元に戻す' }).click();
		}
		await expect
			.poll(() => getCanvasPixel(page, 'editor-canvas', 96, 100))
			.toEqual(before);

		await page.getByRole('button', { name: '元に戻す' }).click();
		await expect
			.poll(() => getCanvasPixel(page, 'editor-canvas', 96, 100))
			.toEqual(WHITE);
	});

	test('undo / redo / リセットでピクセル状態が戻る', async ({ page }) => {
		await uploadSample(page);
		const canvas = page.getByTestId('editor-canvas');

		await dragOnCanvas(page, canvas, { x: 80, y: 60 }, { x: 180, y: 140 });
		await expect
			.poll(() => getCanvasPixel(page, 'editor-canvas', 96, 100))
			.not.toEqual(WHITE);

		await page.getByRole('button', { name: '元に戻す' }).click();
		await expect
			.poll(() => getCanvasPixel(page, 'editor-canvas', 96, 100))
			.toEqual(WHITE);

		await page.getByRole('button', { name: 'やり直す' }).click();
		await expect
			.poll(() => getCanvasPixel(page, 'editor-canvas', 96, 100))
			.not.toEqual(WHITE);

		await page.getByRole('button', { name: 'すべてリセット' }).click();
		await expect
			.poll(() => countDiffFromFixture(page, 'editor-canvas'))
			.toBe(0);
	});

	test('ダウンロードが _edited ファイル名で発火する', async ({ page }) => {
		await uploadSample(page);
		const canvas = page.getByTestId('editor-canvas');
		await dragOnCanvas(page, canvas, { x: 80, y: 60 }, { x: 180, y: 140 });

		// PNG
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'ダウンロード' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('sample-400x300_edited.png');

		// JPEG に切り替えると拡張子が .jpg になり品質スライダーが現れる
		await page.locator('#export-format').click();
		await page.getByRole('option', { name: 'JPEG' }).click();
		await expect(page.getByText(/品質: \d+%/)).toBeVisible();

		const jpegPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'ダウンロード' }).click();
		const jpeg = await jpegPromise;
		expect(jpeg.suggestedFilename()).toBe('sample-400x300_edited.jpg');
	});

	test('20MB超のファイルは日本語エラーになる', async ({ page }) => {
		await page.locator('input[type="file"]').setInputFiles({
			name: 'big.png',
			mimeType: 'image/png',
			buffer: Buffer.alloc(21 * 1024 * 1024),
		});
		await expect(page.getByRole('alert')).toContainText('20MB');
	});

	test('375px / 1440px でレスポンシブ表示される', async ({ page }) => {
		await uploadSample(page);

		await page.setViewportSize({ width: 375, height: 667 });
		const canvas = page.getByTestId('editor-canvas');
		await expect(canvas).toBeVisible();
		const boxMobile = await canvas.boundingBox();
		expect(boxMobile?.width).toBeLessThanOrEqual(375);
		await expect(page.getByRole('tab', { name: 'モザイク' })).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(canvas).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'ダウンロード' }),
		).toBeVisible();
	});
});

test.describe('stackBlur フォールバック実装', () => {
	// ctx.filter 非対応ブラウザ用の純TS実装をNode側で直接検証する
	// （E2E実行ブラウザは filter 対応のためUI経由では通らないパス）

	function makeImage(width: number, height: number, fill: number) {
		return {
			data: new Uint8ClampedArray(width * height * 4).fill(fill),
			width,
			height,
		} as unknown as ImageData;
	}

	test('定数入力は不変', () => {
		const image = makeImage(16, 16, 128);
		stackBlur(image, 5);
		for (const value of image.data) {
			expect(value).toBe(128);
		}
	});

	test('中央インパルスが対称に拡散する', () => {
		const size = 9;
		const image = makeImage(size, size, 0);
		const center = (4 * size + 4) * 4;
		image.data[center] = 255; // 中央ピクセルのRのみ
		stackBlur(image, 2);

		const r = (x: number, y: number) => image.data[(y * size + x) * 4];
		// 中央が最大、左右・上下対称
		expect(r(4, 4)).toBeGreaterThan(0);
		expect(r(3, 4)).toBe(r(5, 4));
		expect(r(2, 4)).toBe(r(6, 4));
		expect(r(4, 3)).toBe(r(4, 5));
		expect(r(3, 4)).toBeLessThanOrEqual(r(4, 4));
	});
});
