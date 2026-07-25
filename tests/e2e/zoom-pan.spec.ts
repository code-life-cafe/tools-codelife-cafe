// image-mosaic / image-text 共通のズーム＆パン機構（ZoomableCanvasViewport）を
// 対象にした、実装非依存の幾何検証。
// 「倍率表示が変わったこと」ではなく「カーソル直下の画像内座標が維持されること」
// をDOMから直接測定して検証する（tests/e2e/helpers/canvas.ts の getZoomGeometry /
// imagePointFromClientPoint を参照）。
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/base';
import {
	generateSyntheticImage,
	getContainerBox,
	getZoomGeometry,
	imagePointFromClientPoint,
	pinch,
	type ZoomGeometry,
	zoomAtClientPoint,
} from './helpers/canvas';

const SAMPLE = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'sample-400x300.png',
);

type Tool = {
	id: 'image-mosaic' | 'image-text';
	canvasTestId: string;
};

const TOOLS: Tool[] = [
	{ id: 'image-mosaic', canvasTestId: 'editor-canvas' },
	{ id: 'image-text', canvasTestId: 'text-canvas' },
];

/**
 * ResizeObserver によるコンテナ実測（フィット倍率・中央配置オフセット）が
 * 安定するまで待つ。アップロード直後や倍率操作直後は、初回の観測が届く前の
 * 過渡値を読んでしまうことがあるため、2回連続で同じ値になるまでポーリングする。
 */
async function waitForStableGeometry(
	page: Page,
	canvasTestId: string,
): Promise<ZoomGeometry> {
	let previous: ZoomGeometry | null = null;
	await expect
		.poll(
			async () => {
				const current = await getZoomGeometry(page, canvasTestId);
				const stable =
					previous !== null &&
					previous.scale === current.scale &&
					previous.offsetX === current.offsetX &&
					previous.offsetY === current.offsetY &&
					previous.containerWidth === current.containerWidth &&
					previous.containerHeight === current.containerHeight;
				previous = current;
				return stable;
			},
			{ intervals: [50, 50, 100], timeout: 5000 },
		)
		.toBe(true);
	return getZoomGeometry(page, canvasTestId);
}

async function uploadFixture(page: Page, canvasTestId: string) {
	await page.locator('input[type="file"]').setInputFiles(SAMPLE);
	await expect(page.getByTestId(canvasTestId)).toBeVisible();
	await waitForStableGeometry(page, canvasTestId);
}

async function uploadBuffer(
	page: Page,
	canvasTestId: string,
	buffer: Buffer,
	name: string,
) {
	await page
		.locator('input[type="file"]')
		.setInputFiles({ name, mimeType: 'image/png', buffer });
	await expect(page.getByTestId(canvasTestId)).toBeVisible();
	await waitForStableGeometry(page, canvasTestId);
}

/** 画像px単位の許容誤差。低倍率ほど1 CSS px の丸め誤差が画像px換算で拡大するため、
 * 実効倍率に応じて許容量を広げる（無限に緩めないよう下限3pxで打ち止め）。 */
function toleranceFor(geometry: ZoomGeometry): number {
	return Math.max(3, 3 / geometry.scale);
}

async function waitForScaleChange(
	page: Page,
	canvasTestId: string,
	previousScale: number,
): Promise<ZoomGeometry> {
	await expect
		.poll(async () => (await getZoomGeometry(page, canvasTestId)).scale)
		.not.toBe(previousScale);
	return getZoomGeometry(page, canvasTestId);
}

/**
 * コンテナよりはっきり大きい画像を100%表示にして、確実に実スクロール可能な
 * （コンテンツ＞コンテナの）状態を作る。コンテンツがコンテナ内に収まる場合、
 * カーソル基準の位置は「中央配置」に吸収されてしまい、カーソル追従の検証が
 * 意味を持たないため（スクロール余地がなければ、どの点を基準にズームしても
 * 中央寄せが優先されるのは仕様として正しい）。
 */
async function uploadLargePannableImage(page: Page, canvasTestId: string) {
	const buffer = await generateSyntheticImage(page, 2400, 1800);
	await uploadBuffer(page, canvasTestId, buffer, 'large.png');
	await page.getByRole('button', { name: '100%' }).click();
	await expect(page.getByTestId('zoom-percent-label')).toHaveText('100%');
	await waitForStableGeometry(page, canvasTestId);
}

/**
 * クリック対象のページ絶対座標と、その時点の幾何情報を対にして返す。
 * `getContainerBox` はコンテナをビューポート内へスクロールしうるため、
 * 座標計算より前に幾何情報を読んでしまうと `containerTop` 等が古い値のまま
 * ずれる。必ずスクロール確定後に幾何情報を読み直す。
 */
async function getClientPointAndGeometry(
	page: Page,
	canvasTestId: string,
	xRatio: number,
	yRatio: number,
): Promise<{ clientX: number; clientY: number; geometry: ZoomGeometry }> {
	const containerBox = await getContainerBox(page);
	const geometry = await waitForStableGeometry(page, canvasTestId);
	return {
		clientX: containerBox.x + containerBox.width * xRatio,
		clientY: containerBox.y + containerBox.height * yRatio,
		geometry,
	};
}

for (const tool of TOOLS) {
	test.describe(`${tool.id}: カーソル基準ズームで画像内座標が維持される`, () => {
		test.beforeEach(async ({ page, createToolPage }) => {
			const toolPage = createToolPage(tool.id);
			await toolPage.goto();
			await expect(
				page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
			).toBeVisible({ timeout: 10000 });
		});

		const anchors: { name: string; xRatio: number; yRatio: number }[] = [
			{ name: '中央', xRatio: 0.5, yRatio: 0.5 },
			{ name: '左上寄り', xRatio: 0.12, yRatio: 0.12 },
			{ name: '右下寄り', xRatio: 0.88, yRatio: 0.88 },
		];

		for (const anchor of anchors) {
			test(`${anchor.name}を基準にCtrl+ホイールでズームしても画像内座標が維持される`, async ({
				page,
			}) => {
				await uploadLargePannableImage(page, tool.canvasTestId);
				const {
					clientX,
					clientY,
					geometry: before,
				} = await getClientPointAndGeometry(
					page,
					tool.canvasTestId,
					anchor.xRatio,
					anchor.yRatio,
				);
				const beforePoint = imagePointFromClientPoint(before, clientX, clientY);

				await zoomAtClientPoint(page, clientX, clientY, -200, 'Control');
				const after = await waitForScaleChange(
					page,
					tool.canvasTestId,
					before.scale,
				);
				const afterPoint = imagePointFromClientPoint(after, clientX, clientY);

				const tolerance = toleranceFor(after);
				expect(
					Math.abs(beforePoint.x - afterPoint.x),
					`x座標のずれ（許容${tolerance.toFixed(1)}px）`,
				).toBeLessThanOrEqual(tolerance);
				expect(
					Math.abs(beforePoint.y - afterPoint.y),
					`y座標のずれ（許容${tolerance.toFixed(1)}px）`,
				).toBeLessThanOrEqual(tolerance);
			});
		}

		test('metaKey(⌘)+ホイールでもカーソル位置基準にズームできる', async ({
			page,
		}) => {
			await uploadLargePannableImage(page, tool.canvasTestId);
			const {
				clientX,
				clientY,
				geometry: before,
			} = await getClientPointAndGeometry(page, tool.canvasTestId, 0.7, 0.3);
			const beforePoint = imagePointFromClientPoint(before, clientX, clientY);

			await zoomAtClientPoint(page, clientX, clientY, -150, 'Meta');
			const after = await waitForScaleChange(
				page,
				tool.canvasTestId,
				before.scale,
			);
			const afterPoint = imagePointFromClientPoint(after, clientX, clientY);

			const tolerance = toleranceFor(after);
			expect(Math.abs(beforePoint.x - afterPoint.x)).toBeLessThanOrEqual(
				tolerance,
			);
			expect(Math.abs(beforePoint.y - afterPoint.y)).toBeLessThanOrEqual(
				tolerance,
			);
		});

		test('修飾キーなしのホイールはズームせず、通常のスクロールとして扱われる', async ({
			page,
		}) => {
			await uploadLargePannableImage(page, tool.canvasTestId);
			const percentLabel = page.getByTestId('zoom-percent-label');
			const containerBox = await getContainerBox(page);
			const before = await waitForStableGeometry(page, tool.canvasTestId);

			await page.mouse.move(
				containerBox.x + containerBox.width / 2,
				containerBox.y + containerBox.height / 2,
			);
			// 修飾キーなしホイール: ズームは発生せず、コンテナが縦スクロールする
			await page.mouse.wheel(0, 300);

			await expect
				.poll(
					async () =>
						(await getZoomGeometry(page, tool.canvasTestId)).scrollTop,
				)
				.toBeGreaterThan(before.scrollTop);
			await expect(percentLabel).toHaveText('100%');
		});

		test('縦長画像でも中央配置オフセットを含めカーソル位置が維持される', async ({
			page,
		}) => {
			const buffer = await generateSyntheticImage(page, 300, 2200);
			await uploadBuffer(page, tool.canvasTestId, buffer, 'tall.png');
			const canvas = page.getByTestId(tool.canvasTestId);
			await canvas.scrollIntoViewIfNeeded();
			const box = await canvas.boundingBox();
			if (!box) throw new Error('canvas が表示されていません');
			const clientX = box.x + box.width * 0.5;
			const clientY = box.y + box.height * 0.3;

			const before = await getZoomGeometry(page, tool.canvasTestId);
			// 縦長画像はフィット時、横方向に大きな中央配置オフセットが生じる
			expect(before.offsetX).toBeGreaterThan(10);
			const beforePoint = imagePointFromClientPoint(before, clientX, clientY);

			await zoomAtClientPoint(page, clientX, clientY, -200, 'Control');
			const after = await waitForScaleChange(
				page,
				tool.canvasTestId,
				before.scale,
			);
			const afterPoint = imagePointFromClientPoint(after, clientX, clientY);
			const tolerance = toleranceFor(after);
			expect(Math.abs(beforePoint.x - afterPoint.x)).toBeLessThanOrEqual(
				tolerance,
			);
			expect(Math.abs(beforePoint.y - afterPoint.y)).toBeLessThanOrEqual(
				tolerance,
			);
		});

		test('横長画像でも中央配置オフセットを含めカーソル位置が維持される', async ({
			page,
		}) => {
			const buffer = await generateSyntheticImage(page, 4000, 300);
			await uploadBuffer(page, tool.canvasTestId, buffer, 'wide.png');
			const canvas = page.getByTestId(tool.canvasTestId);
			await canvas.scrollIntoViewIfNeeded();
			const box = await canvas.boundingBox();
			if (!box) throw new Error('canvas が表示されていません');
			const clientX = box.x + box.width * 0.5;
			const clientY = box.y + box.height * 0.5;

			const before = await getZoomGeometry(page, tool.canvasTestId);
			// 横長の巨大画像はフィット時、縦方向に大きな中央配置オフセットが生じる
			expect(before.offsetY).toBeGreaterThan(10);
			const beforePoint = imagePointFromClientPoint(before, clientX, clientY);

			await zoomAtClientPoint(page, clientX, clientY, -200, 'Control');
			const after = await waitForScaleChange(
				page,
				tool.canvasTestId,
				before.scale,
			);
			const afterPoint = imagePointFromClientPoint(after, clientX, clientY);
			const tolerance = toleranceFor(after);
			expect(Math.abs(beforePoint.x - afterPoint.x)).toBeLessThanOrEqual(
				tolerance,
			);
			expect(Math.abs(beforePoint.y - afterPoint.y)).toBeLessThanOrEqual(
				tolerance,
			);
		});

		test('フィット倍率25%未満からの連続ズームは不自然にジャンプせず、25%到達後は25〜400%にクランプされる', async ({
			page,
		}) => {
			// 横方向のフィット比率が確実に25%を下回るよう、十分に横長の画像を使う
			const buffer = await generateSyntheticImage(page, 4000, 300);
			await uploadBuffer(page, tool.canvasTestId, buffer, 'wide.png');
			const percentLabel = page.getByTestId('zoom-percent-label');
			await expect(percentLabel).toContainText('フィット');

			const readPercent = async () => {
				const text = (await percentLabel.textContent()) ?? '';
				const match = text.match(/(\d+)%/);
				if (!match) throw new Error(`倍率表示を解析できません: ${text}`);
				return Number(match[1]);
			};
			const initialPercent = await readPercent();
			expect(initialPercent).toBeLessThan(25);

			const containerBox = await getContainerBox(page);
			const clientX = containerBox.x + containerBox.width / 2;
			const clientY = containerBox.y + containerBox.height / 2;

			// 25%未満の間は「25%へ即時ジャンプ」せず、連続的に増加することを確認する。
			// 丸め表示（整数%）は1回の操作では変化しないことがあるため、
			// 「単調に非減少」かつ「複数回の操作を要する」ことで検証する
			// （厳密な数値クランプは zoom-pan.test.ts の単体テストで担保する）。
			// 30%まで続けるのは、表示は25%へ丸められていても内部値はまだ25%未満の
			// ことがあり（例: 24.6%→表示"25%"）、その状態で次のクランプ検証に入ると
			// 「25%未満は自由に動く」分岐のままズームアウトを続けてしまうため。
			let previousPercent = initialPercent;
			let percent = initialPercent;
			let steps = 0;
			for (let i = 0; i < 200 && percent < 30; i++) {
				await zoomAtClientPoint(page, clientX, clientY, -60, 'Control');
				await page.waitForTimeout(20);
				percent = await readPercent();
				expect(percent, '倍率表示は減少しないはず').toBeGreaterThanOrEqual(
					previousPercent,
				);
				previousPercent = percent;
				steps++;
			}
			expect(percent).toBeGreaterThanOrEqual(30);
			expect(
				steps,
				'1回の操作で25%へ到達（急激なジャンプ）していないこと',
			).toBeGreaterThan(1);

			// 25%以上へ到達した後は、さらにズームアウトしても25%を下回らない
			for (let i = 0; i < 15; i++) {
				await zoomAtClientPoint(page, clientX, clientY, 300, 'Control');
			}
			await expect(percentLabel).toHaveText('25%');
			await expect(page.getByRole('button', { name: '縮小' })).toBeDisabled();

			// さらにズームインしても400%を超えない
			for (let i = 0; i < 60; i++) {
				await zoomAtClientPoint(page, clientX, clientY, -300, 'Control');
			}
			await expect(percentLabel).toHaveText('400%');
			await expect(page.getByRole('button', { name: '拡大' })).toBeDisabled();
		});
	});

	test.describe(`${tool.id}: ズームボタンの境界動作`, () => {
		test.beforeEach(async ({ page, createToolPage }) => {
			const toolPage = createToolPage(tool.id);
			await toolPage.goto();
			await expect(
				page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
			).toBeVisible({ timeout: 10000 });
		});

		test('ちょうど25%では縮小ボタンが無効になる（押しても倍率が変わらないため）', async ({
			page,
		}) => {
			await uploadFixture(page, tool.canvasTestId);
			await page.getByRole('button', { name: '100%' }).click();
			const percentLabel = page.getByTestId('zoom-percent-label');
			await expect(percentLabel).toHaveText('100%');

			const zoomOutButton = page.getByRole('button', { name: '縮小' });
			// 100% → 50% → 25% とスナップ系列を下って25%に到達させる
			await zoomOutButton.click();
			await expect(percentLabel).toHaveText('50%');
			await expect(zoomOutButton).toBeEnabled();
			await zoomOutButton.click();
			await expect(percentLabel).toHaveText('25%');
			await expect(zoomOutButton).toBeDisabled();
		});

		test('400%では拡大ボタンが無効になる', async ({ page }) => {
			await uploadFixture(page, tool.canvasTestId);
			const percentLabel = page.getByTestId('zoom-percent-label');
			const zoomInButton = page.getByRole('button', { name: '拡大' });
			for (let i = 0; i < 6; i++) {
				if (await zoomInButton.isDisabled()) break;
				await zoomInButton.click();
			}
			await expect(percentLabel).toHaveText('400%');
			await expect(zoomInButton).toBeDisabled();
		});

		test('400%上限に張り付いた後、1段階だけズームアウトしてもカーソル位置がずれない', async ({
			page,
		}) => {
			await uploadLargePannableImage(page, tool.canvasTestId);
			const { clientX, clientY } = await getClientPointAndGeometry(
				page,
				tool.canvasTestId,
				0.5,
				0.5,
			);
			// 400%上限に張り付くまで拡大し続ける（同値setMode呼び出しを複数回発生させる）
			for (let i = 0; i < 10; i++) {
				await zoomAtClientPoint(page, clientX, clientY, -1_000_000, 'Control');
			}
			await expect(page.getByTestId('zoom-percent-label')).toHaveText('400%');
			const before = await getZoomGeometry(page, tool.canvasTestId);
			const beforePoint = imagePointFromClientPoint(before, clientX, clientY);

			await zoomAtClientPoint(page, clientX, clientY, 60, 'Control');
			const after = await waitForScaleChange(
				page,
				tool.canvasTestId,
				before.scale,
			);
			const afterPoint = imagePointFromClientPoint(after, clientX, clientY);

			const tolerance = toleranceFor(after);
			expect(Math.abs(beforePoint.x - afterPoint.x)).toBeLessThanOrEqual(
				tolerance,
			);
			expect(Math.abs(beforePoint.y - afterPoint.y)).toBeLessThanOrEqual(
				tolerance,
			);
		});
	});

	test.describe(`${tool.id}: ピンチズーム・2本指パン`, () => {
		test.beforeEach(async ({ page, createToolPage }, testInfo) => {
			test.skip(
				testInfo.project.name !== 'mobile-chrome',
				'CDPタッチイベントはhasTouch:trueのmobile-chromeプロジェクトでのみ検証する',
			);
			const toolPage = createToolPage(tool.id);
			await toolPage.goto();
			await expect(
				page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
			).toBeVisible({ timeout: 10000 });
		});

		test('2本指ピンチで拡大でき、倍率表示が変化する', async ({ page }) => {
			await uploadLargePannableImage(page, tool.canvasTestId);
			const percentLabel = page.getByTestId('zoom-percent-label');
			const before = await percentLabel.textContent();
			const containerBox = await getContainerBox(page);
			const center = {
				x: containerBox.x + containerBox.width / 2,
				y: containerBox.y + containerBox.height / 2,
			};

			await pinch(page, { center, startDistance: 100, endDistance: 260 });

			await expect.poll(() => percentLabel.textContent()).not.toBe(before);
		});

		test('2本指パンでスクロール位置が変化する', async ({ page }) => {
			await uploadLargePannableImage(page, tool.canvasTestId);
			const before = await getZoomGeometry(page, tool.canvasTestId);
			const containerBox = await getContainerBox(page);
			const center = {
				x: containerBox.x + containerBox.width / 2,
				y: containerBox.y + containerBox.height / 2,
			};

			await pinch(page, {
				center,
				startDistance: 150,
				endDistance: 150,
				panDeltaX: -150,
				panDeltaY: -100,
			});

			const after = await getZoomGeometry(page, tool.canvasTestId);
			expect(after.scrollLeft).not.toEqual(before.scrollLeft);
			expect(after.scrollTop).not.toEqual(before.scrollTop);
		});
	});
}
