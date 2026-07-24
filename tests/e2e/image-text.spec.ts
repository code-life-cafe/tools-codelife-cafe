import path from 'node:path';
import { expect, test } from './fixtures/base';
import {
	countDiffFromFixture,
	countMatchingPixels,
	generateSyntheticImage,
	getCanvasPixel,
	getContainerBox,
	getZoomGeometry,
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
		// ズームビューポートのフィット再計算は ResizeObserver 経由の非同期のため poll で待つ
		await expect
			.poll(async () => (await canvas.boundingBox())?.width)
			.toBeLessThanOrEqual(375);
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

test.describe('ズーム＆パン・フルサイズ表示', () => {
	test.beforeEach(async ({ page, createToolPage }) => {
		const toolPage = createToolPage('image-text');
		await toolPage.goto();
		await expect(
			page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
		).toBeVisible({ timeout: 10000 });
	});

	test('アップロード直後はフィット表示で、ズームコントロールが揃っている', async ({
		page,
	}) => {
		await uploadSample(page);
		await expect(page.getByText(/^フィット（\d+%）$/)).toBeVisible();
		await expect(page.getByRole('button', { name: 'フィット' })).toBeVisible();
		await expect(page.getByRole('button', { name: '100%' })).toBeVisible();
		await expect(page.getByRole('button', { name: '縮小' })).toBeVisible();
		await expect(page.getByRole('button', { name: '拡大' })).toBeVisible();
	});

	test('100%表示でもcanvas内部解像度は変わらない', async ({ page }) => {
		await uploadSample(page);
		const canvas = page.getByTestId('text-canvas');
		await page.getByRole('button', { name: '100%' }).click();
		await expect(page.getByTestId('zoom-percent-label')).toHaveText('100%');
		const size = await canvas.evaluate((el) => [
			(el as HTMLCanvasElement).width,
			(el as HTMLCanvasElement).height,
		]);
		expect(size).toEqual([400, 300]);
	});

	test('拡大した後もレイヤーのドラッグ移動が正しい画像座標で機能する', async ({
		page,
	}) => {
		await uploadSample(page);
		await addLayer(page);
		const canvas = page.getByTestId('text-canvas');
		const percentLabel = page.getByTestId('zoom-percent-label');
		const before = await percentLabel.textContent();
		// 表示領域内に収まる範囲でズームする（拡大しすぎるとスクロールで対象領域が
		// 見切れるため、可視範囲を保ったまま座標変換の正しさを検証する）
		await page.getByRole('button', { name: '拡大' }).click();
		await expect(percentLabel).not.toHaveText(before ?? '');

		const from = await imagePointToPage(canvas, 200, 148);
		const to = await imagePointToPage(canvas, 200, 248);
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(to.x, to.y, { steps: 5 });
		await page.mouse.up();

		await expect
			.poll(() => countDiffFromFixture(page, 'text-canvas', TEXT_REGION))
			.toBe(0);
		const movedRegion = { x: 120, y: 200, width: 200, height: 90 };
		expect(
			await countDiffFromFixture(page, 'text-canvas', movedRegion),
		).toBeGreaterThan(0);
	});

	test('Ctrl+ホイールでカーソル位置基準にズームできる', async ({ page }) => {
		await uploadSample(page);
		const canvas = page.getByTestId('text-canvas');
		await canvas.scrollIntoViewIfNeeded();
		const box = await canvas.boundingBox();
		if (!box) throw new Error('canvas が表示されていません');

		const percentLabel = page.getByTestId('zoom-percent-label');
		const before = await percentLabel.textContent();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.keyboard.down('Control');
		await page.mouse.wheel(0, -200);
		await page.keyboard.up('Control');

		await expect.poll(() => percentLabel.textContent()).not.toBe(before);
	});

	test('フルサイズ切替でページ幅上限が解除され、ズーム状態は維持される', async ({
		page,
	}) => {
		await uploadSample(page);
		await page.getByRole('button', { name: '100%' }).click();
		await expect(page.getByTestId('zoom-percent-label')).toHaveText('100%');

		const container = page.locator('#tool-layout-container');
		await expect(container).toHaveClass(/max-w-\[800px\]/);

		await page.getByRole('button', { name: 'フルサイズ' }).click();
		await expect(container).toHaveClass(/max-w-full/);
		await expect(page.getByTestId('zoom-percent-label')).toHaveText('100%');

		await page.getByRole('button', { name: '標準幅' }).click();
		await expect(container).toHaveClass(/max-w-\[800px\]/);
	});

	test('別の画像を選び直すとフィット表示に戻る', async ({ page }) => {
		await uploadSample(page);
		await page.getByRole('button', { name: '100%' }).click();
		await expect(page.getByTestId('zoom-percent-label')).toHaveText('100%');

		await page.getByRole('button', { name: '別の画像を選ぶ' }).click();
		await uploadSample(page);
		await expect(page.getByText(/^フィット（\d+%）$/)).toBeVisible();
	});
});

test.describe('モバイル編集／パンモード', () => {
	test.beforeEach(async ({ page, createToolPage }) => {
		// モバイル用の編集／パン切替ボタンは sm:hidden のため、
		// どの Playwright project で実行してもボタンが見えるよう明示的に狭める
		await page.setViewportSize({ width: 375, height: 812 });
		const toolPage = createToolPage('image-text');
		await toolPage.goto();
		await expect(
			page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
		).toBeVisible({ timeout: 10000 });
	});

	const editButton = (page: import('@playwright/test').Page) =>
		page.getByRole('button', { name: '編集モード（ドラッグで選択・移動）' });
	const panButton = (page: import('@playwright/test').Page) =>
		page.getByRole('button', { name: 'パンモード（ドラッグで画像内を移動）' });

	test('アップロード直後は編集モードで、Accessible Nameとaria-pressedが正しい', async ({
		page,
	}) => {
		await uploadSample(page);
		await expect(editButton(page)).toHaveAttribute('aria-pressed', 'true');
		await expect(panButton(page)).toHaveAttribute('aria-pressed', 'false');
	});

	test('編集モードでは既存のレイヤードラッグ移動が機能する', async ({
		page,
	}) => {
		await uploadSample(page);
		await addLayer(page);
		const canvas = page.getByTestId('text-canvas');

		const from = await imagePointToPage(canvas, 200, 148);
		const to = await imagePointToPage(canvas, 200, 248);
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(to.x, to.y, { steps: 5 });
		await page.mouse.up();

		await expect
			.poll(() => countDiffFromFixture(page, 'text-canvas', TEXT_REGION))
			.toBe(0);
	});

	test('パンモードに切り替えるとレイヤードラッグ移動が発火しない', async ({
		page,
	}) => {
		await uploadSample(page);
		await addLayer(page);
		await panButton(page).click();
		await expect(panButton(page)).toHaveAttribute('aria-pressed', 'true');

		const canvas = page.getByTestId('text-canvas');
		const from = await imagePointToPage(canvas, 200, 148);
		const to = await imagePointToPage(canvas, 200, 248);
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(to.x, to.y, { steps: 5 });
		await page.mouse.up();

		// パンモードではレイヤーが移動しないため、元の位置に留まる
		expect(
			await countDiffFromFixture(page, 'text-canvas', TEXT_REGION),
		).toBeGreaterThan(0);
		const movedRegion = { x: 120, y: 200, width: 200, height: 90 };
		expect(await countDiffFromFixture(page, 'text-canvas', movedRegion)).toBe(
			0,
		);
	});

	test('パンモードでは画像の四隅へ移動でき、ページの横スクロールは発生しない', async ({
		page,
	}) => {
		// フィクスチャ(400x300)は100%表示でもコンテナ内に収まってしまいパンの
		// 余地がないため、縦横ともコンテナよりはっきり大きい画像を使う
		const buffer = await generateSyntheticImage(page, 2400, 1800);
		await page
			.locator('input[type="file"]')
			.setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer });
		await expect(page.getByTestId('text-canvas')).toBeVisible();
		await page.getByRole('button', { name: '100%' }).click();
		await expect(page.getByTestId('zoom-percent-label')).toHaveText('100%');
		await panButton(page).click();

		const containerBox = await getContainerBox(page);
		const cx = containerBox.x + containerBox.width / 2;
		const cy = containerBox.y + containerBox.height / 2;
		await page.mouse.move(cx, cy);

		await page.mouse.wheel(-5000, -5000);
		await expect
			.poll(async () => (await getZoomGeometry(page, 'text-canvas')).scrollLeft)
			.toBe(0);
		expect((await getZoomGeometry(page, 'text-canvas')).scrollTop).toBe(0);

		await page.mouse.wheel(5000, 5000);
		await expect
			.poll(async () => (await getZoomGeometry(page, 'text-canvas')).scrollLeft)
			.toBeGreaterThan(0);
		const afterBottomRight = await getZoomGeometry(page, 'text-canvas');
		expect(afterBottomRight.scrollTop).toBeGreaterThan(0);

		const hasHorizontalOverflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth >
				document.documentElement.clientWidth,
		);
		expect(hasHorizontalOverflow).toBe(false);
	});

	test('ズームビューポート外ではページの縦スクロールが阻害されない', async ({
		page,
	}) => {
		await uploadSample(page);
		const scrollYBefore = await page.evaluate(() => window.scrollY);
		await page.mouse.move(10, 5);
		await page.mouse.wheel(0, 400);
		await expect
			.poll(() => page.evaluate(() => window.scrollY))
			.toBeGreaterThan(scrollYBefore);
	});

	test('新しい画像を読み込むと編集モードへ戻る', async ({ page }) => {
		await uploadSample(page);
		await panButton(page).click();
		await expect(panButton(page)).toHaveAttribute('aria-pressed', 'true');

		await page.getByRole('button', { name: '別の画像を選ぶ' }).click();
		await uploadSample(page);
		await expect(editButton(page)).toHaveAttribute('aria-pressed', 'true');
	});

	test('編集／パンの切替でズーム倍率や編集内容が失われない', async ({
		page,
	}) => {
		await uploadSample(page);
		await addLayer(page);
		await page.getByRole('button', { name: '100%' }).click();
		const percentLabel = page.getByTestId('zoom-percent-label');
		await expect(percentLabel).toHaveText('100%');
		const diffBefore = await countDiffFromFixture(
			page,
			'text-canvas',
			TEXT_REGION,
		);
		expect(diffBefore).toBeGreaterThan(0);

		await panButton(page).click();
		await expect(percentLabel).toHaveText('100%');
		expect(await countDiffFromFixture(page, 'text-canvas', TEXT_REGION)).toBe(
			diffBefore,
		);

		await editButton(page).click();
		await expect(percentLabel).toHaveText('100%');
		expect(await countDiffFromFixture(page, 'text-canvas', TEXT_REGION)).toBe(
			diffBefore,
		);
	});
});
