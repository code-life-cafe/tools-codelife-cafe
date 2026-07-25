import type { BrowserContext, Locator, Page } from '@playwright/test';

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
	await canvas.scrollIntoViewIfNeeded();

	const p1 = await imagePointToPage(canvas, from.x, from.y);
	const p2 = await imagePointToPage(canvas, to.x, to.y);
	await page.mouse.move(p1.x, p1.y);
	await page.mouse.down();
	await page.mouse.move(p2.x, p2.y, { steps: 5 });
	await page.mouse.up();
}

export type ZoomGeometry = {
	/** 現在の実効倍率（1 = 100%） */
	scale: number;
	scrollLeft: number;
	scrollTop: number;
	/** 中央配置オフセット（px） */
	offsetX: number;
	offsetY: number;
	/** スクロールコンテナのビューポート座標（ページ絶対座標→コンテナ内座標の変換に使う） */
	containerLeft: number;
	containerTop: number;
	containerWidth: number;
	containerHeight: number;
	canvasWidth: number;
	canvasHeight: number;
};

/**
 * ZoomableCanvasViewport のDOM構造からズーム幾何情報を読み取る。
 * 構造: canvas → (relative h-full w-full ラッパー) → (原寸ボックス, インライン
 * style で width/height/margin を持つ) → (overflow-auto スクロールコンテナ)。
 * `useZoomPan` の内部実装を呼ばず、実際のDOM値のみから幾何を再構成する。
 */
export async function getZoomGeometry(
	page: Page,
	testId: string,
): Promise<ZoomGeometry> {
	const geometry = await page.evaluate((testId) => {
		const canvas = document.querySelector(
			`[data-testid="${testId}"]`,
		) as HTMLCanvasElement | null;
		const wrapper = canvas?.parentElement ?? null;
		const contentBox = (wrapper?.parentElement ?? null) as HTMLElement | null;
		const scrollContainer = (contentBox?.parentElement ??
			null) as HTMLElement | null;
		if (!canvas || !wrapper || !contentBox || !scrollContainer) return null;
		const containerRect = scrollContainer.getBoundingClientRect();
		return {
			scale: contentBox.getBoundingClientRect().width / canvas.width,
			scrollLeft: scrollContainer.scrollLeft,
			scrollTop: scrollContainer.scrollTop,
			offsetX: contentBox.offsetLeft,
			offsetY: contentBox.offsetTop,
			containerLeft: containerRect.left,
			containerTop: containerRect.top,
			containerWidth: scrollContainer.clientWidth,
			containerHeight: scrollContainer.clientHeight,
			canvasWidth: canvas.width,
			canvasHeight: canvas.height,
		};
	}, testId);
	if (!geometry) {
		throw new Error(`ズームジオメトリを取得できません: ${testId}`);
	}
	return geometry;
}

/**
 * ページ絶対座標（clientX/clientY、Playwrightのマウス座標系）が指す画像内座標を、
 * ズーム幾何情報から算出する。「カーソル直下の画像座標」を実装非依存に定義するための
 * 純粋な幾何計算であり、アプリ側の補正ロジックは呼び出さない。
 */
export function imagePointFromClientPoint(
	geometry: ZoomGeometry,
	clientX: number,
	clientY: number,
): { x: number; y: number } {
	const pointerX = clientX - geometry.containerLeft;
	const pointerY = clientY - geometry.containerTop;
	return {
		x: (pointerX + geometry.scrollLeft - geometry.offsetX) / geometry.scale,
		y: (pointerY + geometry.scrollTop - geometry.offsetY) / geometry.scale,
	};
}

/**
 * スクロールコンテナ自体の可視範囲（ページ絶対座標）を返す。
 * canvas 自身の boundingBox はコンテナの overflow で隠れている部分も含む
 * フルサイズを返してしまう（ズームでコンテンツがコンテナより大きくなった場合、
 * 画面外の座標を含みうる）ため、マウス操作の目標座標には必ずこちらを使う。
 */
export async function getContainerBox(
	page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
	const container = page.getByTestId('zoom-scroll-container');
	// ページレイアウトによってはビューポート下端より下に位置することがあるため、
	// 座標計算の前に確実にビューポート内へスクロールしておく
	await container.scrollIntoViewIfNeeded();
	const box = await container.boundingBox();
	if (!box) throw new Error('zoom-scroll-container が表示されていません');
	return box;
}

/** 指定のページ絶対座標にカーソルを置き、修飾キー付きホイールでズームする */
export async function zoomAtClientPoint(
	page: Page,
	clientX: number,
	clientY: number,
	deltaY: number,
	modifier: 'Control' | 'Meta' = 'Control',
): Promise<void> {
	await page.mouse.move(clientX, clientY);
	await page.keyboard.down(modifier);
	await page.mouse.wheel(0, deltaY);
	await page.keyboard.up(modifier);
}

/**
 * 指定サイズの単色パターンPNGをブラウザのcanvasで生成しBufferとして返す。
 * 縦長・横長・巨大画像でのフィット倍率／中央配置オフセット挙動を検証するために使う
 * （新規npm依存を追加せず、Canvas APIのみでフィクスチャを都度生成する）。
 */
export async function generateSyntheticImage(
	page: Page,
	width: number,
	height: number,
): Promise<Buffer> {
	const dataUrl = await page.evaluate(
		({ width, height }) => {
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('2D context取得に失敗しました');
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, width, height);
			ctx.fillStyle = '#dc2828';
			ctx.fillRect(0, 0, Math.min(40, width), Math.min(40, height));
			return canvas.toDataURL('image/png');
		},
		{ width, height },
	);
	const base64 = dataUrl.split(',')[1] ?? '';
	return Buffer.from(base64, 'base64');
}

type CDPSession = Awaited<ReturnType<BrowserContext['newCDPSession']>>;

type TouchPoint = { x: number; y: number; id: number };

function toCdpTouchPoint(p: TouchPoint) {
	return { x: p.x, y: p.y, id: p.id, radiusX: 1, radiusY: 1, force: 1 };
}

/**
 * Input.dispatchTouchEvent の低レベルラッパー（CDP、Chromiumのみ）。
 * touchPoints にはその時点でアクティブな全接触点を渡す。
 * 一部の指だけを離す場合は type: 'touchEnd' に「残す指のみ」を渡し、
 * 完全に離す場合は空配列を渡す。
 */
export async function dispatchTouchEvent(
	client: CDPSession,
	type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
	touchPoints: TouchPoint[],
): Promise<void> {
	await client.send('Input.dispatchTouchEvent', {
		type,
		touchPoints: touchPoints.map(toCdpTouchPoint),
	});
}

/**
 * 2本指のピンチ＋パンをCDP経由でシミュレートする（Chromiumのみ）。
 * page.touchscreen は単点tap()のみで多点非対応のため、CDPを直接叩く。
 */
export async function pinch(
	page: Page,
	params: {
		center: { x: number; y: number };
		startDistance: number;
		endDistance: number;
		panDeltaX?: number;
		panDeltaY?: number;
		steps?: number;
	},
): Promise<void> {
	const client = await page.context().newCDPSession(page);
	const steps = params.steps ?? 8;
	const panDeltaX = params.panDeltaX ?? 0;
	const panDeltaY = params.panDeltaY ?? 0;

	const pointsAt = (t: number): TouchPoint[] => {
		const distance =
			params.startDistance + (params.endDistance - params.startDistance) * t;
		const cx = params.center.x + panDeltaX * t;
		const cy = params.center.y + panDeltaY * t;
		return [
			{ x: cx - distance / 2, y: cy, id: 0 },
			{ x: cx + distance / 2, y: cy, id: 1 },
		];
	};

	await dispatchTouchEvent(client, 'touchStart', pointsAt(0));
	for (let i = 1; i <= steps; i++) {
		await dispatchTouchEvent(client, 'touchMove', pointsAt(i / steps));
	}
	await dispatchTouchEvent(client, 'touchEnd', []);
	await client.detach();
}
