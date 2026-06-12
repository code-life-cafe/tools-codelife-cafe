import path from 'node:path';
import { expect, test } from './fixtures/base';
import {
	countDiffFromFixture,
	countMatchingPixels,
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

const RED = [220, 40, 40, 255];

// デフォルトレイヤーは画像中央付近 (136,126) に「テキスト」(32px) を配置する。
// グリフの正確な形はフォント依存のため、ピクセル単位の一致ではなく
// 「領域内にフィクスチャ原画と異なるピクセルが現れる/消える」ことで検証する
// （領域はフィクスチャの赤矩形と重なるため、非白判定ではなく原画との差分で数える）
const TEXT_REGION = { x: 130, y: 120, width: 160, height: 60 };

async function uploadSample(page: import('@playwright/test').Page) {
	await page.locator('input[type="file"]').setInputFiles(FIXTURE);
	await expect(page.getByTestId('text-canvas')).toBeVisible();
	await expect
		.poll(() => getCanvasPixel(page, 'text-canvas', 150, 100))
		.toEqual(RED);
}

async function addLayer(page: import('@playwright/test').Page) {
	await page.getByRole('button', { name: 'テキストを追加' }).click();
	await expect
		.poll(() => countDiffFromFixture(page, 'text-canvas', TEXT_REGION))
		.toBeGreaterThan(0);
}

test.describe('画像テキスト挿入', () => {
	test.beforeEach(async ({ page, createToolPage }) => {
		const toolPage = createToolPage('image-text');
		await toolPage.goto();
		await expect(
			page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
		).toBeVisible({ timeout: 10000 });
	});

	test('ページ表示とSafetyBadge', async ({ createToolPage }) => {
		const toolPage = createToolPage('image-text');
		await toolPage.expectTitle('画像テキスト挿入');
		await toolPage.expectSafetyBadge();
	});

	test('レイヤー追加でテキストが描画される', async ({ page }) => {
		await uploadSample(page);
		await addLayer(page);
		// 領域外（テキストから離れた場所）は原状のまま
		expect(await getCanvasPixel(page, 'text-canvas', 350, 280)).toEqual([
			255, 255, 255, 255,
		]);
	});

	test('テキスト・サイズ・色の編集がcanvasに反映される', async ({ page }) => {
		await uploadSample(page);
		await addLayer(page);

		const before = await countDiffFromFixture(page, 'text-canvas', TEXT_REGION);

		// フォントサイズを大きくするとグリフのピクセル数が増える
		await page.locator('#layer-font-size').fill('64');
		const bigRegion = { x: 130, y: 120, width: 270, height: 100 };
		await expect
			.poll(() => countDiffFromFixture(page, 'text-canvas', bigRegion))
			.toBeGreaterThan(before);

		// 文字色を青に変更すると青いピクセルが現れる
		await page.locator('#layer-color').evaluate((el, value) => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				'value',
			)?.set;
			setter?.call(el, value);
			el.dispatchEvent(new Event('input', { bubbles: true }));
		}, '#0000ff');
		await expect
			.poll(() => countMatchingPixels(page, 'text-canvas', bigRegion, 'blue'))
			.toBeGreaterThan(0);

		// テキスト変更も反映される（空にするとグリフが消え、原画に一致する）
		await page.locator('#layer-text').fill('');
		await expect
			.poll(() => countDiffFromFixture(page, 'text-canvas', bigRegion))
			.toBe(0);
	});

	test('ドラッグでレイヤーを移動できる', async ({ page }) => {
		await uploadSample(page);
		await addLayer(page);
		const canvas = page.getByTestId('text-canvas');

		// テキストボックス中央 (200,148) から下へ100pxドラッグ
		const from = await imagePointToPage(canvas, 200, 148);
		const to = await imagePointToPage(canvas, 200, 248);
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(to.x, to.y, { steps: 5 });
		await page.mouse.up();

		// 旧位置からテキストが消えて原画に戻り、下方の新位置に現れる
		await expect
			.poll(() => countDiffFromFixture(page, 'text-canvas', TEXT_REGION))
			.toBe(0);
		const movedRegion = { x: 120, y: 200, width: 200, height: 90 };
		expect(
			await countDiffFromFixture(page, 'text-canvas', movedRegion),
		).toBeGreaterThan(0);
	});

	test('レイヤー削除でcanvasが原状に戻る', async ({ page }) => {
		await uploadSample(page);
		await addLayer(page);

		await page.getByRole('button', { name: 'レイヤーを削除' }).click();
		await expect.poll(() => countDiffFromFixture(page, 'text-canvas')).toBe(0);
	});

	test('複製と並べ替えができる', async ({ page }) => {
		await uploadSample(page);
		await addLayer(page);

		const layerList = page.getByRole('list', { name: 'レイヤー一覧' });

		await page.getByRole('button', { name: 'レイヤーを複製' }).click();
		await expect(layerList.getByRole('listitem')).toHaveCount(2);

		// 2番目（複製）を上へ移動できる
		await page.getByRole('button', { name: '上へ移動' }).last().click();
		await expect(layerList.getByRole('listitem')).toHaveCount(2);
	});

	test('ダウンロードが _edited ファイル名で発火する', async ({ page }) => {
		await uploadSample(page);
		await addLayer(page);

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'ダウンロード' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('sample-400x300_edited.png');
	});

	test('375px / 1440px でレスポンシブ表示される', async ({ page }) => {
		await uploadSample(page);
		await addLayer(page);

		await page.setViewportSize({ width: 375, height: 667 });
		const canvas = page.getByTestId('text-canvas');
		await expect(canvas).toBeVisible();
		const boxMobile = await canvas.boundingBox();
		expect(boxMobile?.width).toBeLessThanOrEqual(375);
		await expect(
			page.getByRole('button', { name: 'テキストを追加' }),
		).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(canvas).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'ダウンロード' }),
		).toBeVisible();
	});
});
