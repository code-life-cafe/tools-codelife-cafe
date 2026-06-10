import type { Locator, Page } from '@playwright/test';

/**
 * 画像座標（canvas内部解像度の座標）をページのCSS座標に変換する。
 * canvas は内部解像度＝元画像サイズで、CSSにより縮小表示されている前提。
 */
export async function imagePointToPage(
	canvas: Locator,
	imgX: number,
	imgY: number,
): Promise<{ x: number; y: number }> {
	const box = await canvas.boundingBox();
	if (!box) throw new Error('canvas が表示されていません');
	const [width, height] = await canvas.evaluate((el) => {
		const c = el as HTMLCanvasElement;
		return [c.width, c.height];
	});
	return {
		x: box.x + (imgX / width) * box.width,
		y: box.y + (imgY / height) * box.height,
	};
}

/**
 * canvas の指定座標のピクセル値 [r, g, b, a] を読む。
 * canvas 未描画（サイズ0）の場合は null（expect.poll でのリトライ用）。
 */
export async function getCanvasPixel(
	page: Page,
	testId: string,
	imgX: number,
	imgY: number,
): Promise<number[] | null> {
	return page.evaluate(
		({ testId, imgX, imgY }) => {
			const canvas = document.querySelector(
				`[data-testid="${testId}"]`,
			) as HTMLCanvasElement | null;
			if (!canvas || canvas.width === 0) return null;
			const ctx = canvas.getContext('2d');
			if (!ctx) return null;
			const d = ctx.getImageData(imgX, imgY, 1, 1).data;
			return [d[0], d[1], d[2], d[3]];
		},
		{ testId, imgX, imgY },
	);
}

/**
 * 指定領域内で条件に合うピクセル数を数える。
 * - non-white: いずれかのRGBチャンネルが240未満（白地上の描画検出用）
 * - blue: 青が支配的（b > 200 かつ r < 100）
 */
export async function countMatchingPixels(
	page: Page,
	testId: string,
	region: { x: number; y: number; width: number; height: number },
	mode: 'non-white' | 'blue',
): Promise<number> {
	return page.evaluate(
		({ testId, region, mode }) => {
			const canvas = document.querySelector(
				`[data-testid="${testId}"]`,
			) as HTMLCanvasElement | null;
			if (!canvas || canvas.width === 0) return 0;
			const ctx = canvas.getContext('2d');
			if (!ctx) return 0;
			const x = Math.max(0, region.x);
			const y = Math.max(0, region.y);
			const w = Math.min(canvas.width - x, region.width);
			const h = Math.min(canvas.height - y, region.height);
			if (w <= 0 || h <= 0) return 0;
			const { data } = ctx.getImageData(x, y, w, h);
			let count = 0;
			for (let i = 0; i < data.length; i += 4) {
				const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
				if (mode === 'non-white') {
					if (r < 240 || g < 240 || b < 240) count++;
				} else if (b > 200 && r < 100) {
					count++;
				}
			}
			return count;
		},
		{ testId, region, mode },
	);
}

/**
 * フィクスチャ画像（sample-400x300.png: 白地 + (100,80)〜(219,169) 赤矩形）の
 * 元ピクセルパターンと異なるピクセル数を数える。0 = 完全に原状。
 * region 指定時はその範囲のみを比較する（フィクスチャの赤矩形と重なる領域でも使える）。
 */
export async function countDiffFromFixture(
	page: Page,
	testId: string,
	region?: { x: number; y: number; width: number; height: number },
): Promise<number> {
	return page.evaluate(
		({ testId, region }) => {
			const canvas = document.querySelector(
				`[data-testid="${testId}"]`,
			) as HTMLCanvasElement | null;
			if (!canvas || canvas.width === 0) return Number.MAX_SAFE_INTEGER;
			const ctx = canvas.getContext('2d');
			if (!ctx) return Number.MAX_SAFE_INTEGER;
			const x0 = Math.max(0, region?.x ?? 0);
			const y0 = Math.max(0, region?.y ?? 0);
			const w = Math.min(canvas.width - x0, region?.width ?? canvas.width);
			const h = Math.min(canvas.height - y0, region?.height ?? canvas.height);
			if (w <= 0 || h <= 0) return 0;
			const { data } = ctx.getImageData(x0, y0, w, h);
			let diff = 0;
			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					const i = (y * w + x) * 4;
					const isRed =
						x0 + x >= 100 && x0 + x < 220 && y0 + y >= 80 && y0 + y < 170;
					const expected = isRed ? [220, 40, 40] : [255, 255, 255];
					if (
						Math.abs(data[i] - expected[0]) > 2 ||
						Math.abs(data[i + 1] - expected[1]) > 2 ||
						Math.abs(data[i + 2] - expected[2]) > 2 ||
						data[i + 3] !== 255
					) {
						diff++;
					}
				}
			}
			return diff;
		},
		{ testId, region },
	);
}

/** canvas 上の画像座標 from → to をマウスドラッグする */
export async function dragOnCanvas(
	page: Page,
	canvas: Locator,
	from: { x: number; y: number },
	to: { x: number; y: number },
): Promise<void> {
	const p1 = await imagePointToPage(canvas, from.x, from.y);
	const p2 = await imagePointToPage(canvas, to.x, to.y);
	await page.mouse.move(p1.x, p1.y);
	await page.mouse.down();
	await page.mouse.move(p2.x, p2.y, { steps: 5 });
	await page.mouse.up();
}
