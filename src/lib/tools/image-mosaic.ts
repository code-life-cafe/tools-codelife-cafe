// image-mosaic.ts — モザイク・ぼかしのコアロジック
// すべて純粋関数。プレビューとエクスポートは renderMasked を単一ソースとして共用する

/** 元画像座標系の矩形（width/height > 0 に正規化済みであること） */
export type Rect = { x: number; y: number; width: number; height: number };

export type MaskMode = 'mosaic' | 'blur';

export type MaskRegion = {
	id: string;
	rect: Rect;
	mode: MaskMode;
	/** mosaic: ブロックサイズ(px) / blur: 半径(px) */
	strength: number;
};

export const MOSAIC_BLOCK = { min: 4, max: 64, default: 12 } as const;
export const BLUR_RADIUS = { min: 2, max: 30, default: 8 } as const;

/** 矩形を canvas 境界内にクリップする。交差しない場合は null */
export function clampRect(
	rect: Rect,
	width: number,
	height: number,
): Rect | null {
	const x = Math.max(0, Math.floor(rect.x));
	const y = Math.max(0, Math.floor(rect.y));
	const right = Math.min(width, Math.ceil(rect.x + rect.width));
	const bottom = Math.min(height, Math.ceil(rect.y + rect.height));
	if (right - x < 1 || bottom - y < 1) return null;
	return { x, y, width: right - x, height: bottom - y };
}

/**
 * 矩形領域にモザイク（ピクセル化）を適用する。
 * ImageData 上のブロック平均化による実装で、同一入力に対して決定論的な出力を返す
 * （imageSmoothingEnabled による縮小拡大トリックは使わない）。
 * ブロックは rect 左上を原点に敷き詰め、端は矩形内にクリップされる。
 */
export function applyMosaic(
	ctx: CanvasRenderingContext2D,
	rect: Rect,
	blockSize: number,
): void {
	const clipped = clampRect(rect, ctx.canvas.width, ctx.canvas.height);
	if (!clipped) return;
	const block = Math.max(1, Math.round(blockSize));

	const image = ctx.getImageData(
		clipped.x,
		clipped.y,
		clipped.width,
		clipped.height,
	);
	const { data, width, height } = image;

	for (let by = 0; by < height; by += block) {
		const bh = Math.min(block, height - by);
		for (let bx = 0; bx < width; bx += block) {
			const bw = Math.min(block, width - bx);
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (let y = by; y < by + bh; y++) {
				for (let x = bx; x < bx + bw; x++) {
					const i = (y * width + x) * 4;
					r += data[i];
					g += data[i + 1];
					b += data[i + 2];
					a += data[i + 3];
				}
			}
			const count = bw * bh;
			const avgR = Math.round(r / count);
			const avgG = Math.round(g / count);
			const avgB = Math.round(b / count);
			const avgA = Math.round(a / count);
			for (let y = by; y < by + bh; y++) {
				for (let x = bx; x < bx + bw; x++) {
					const i = (y * width + x) * 4;
					data[i] = avgR;
					data[i + 1] = avgG;
					data[i + 2] = avgB;
					data[i + 3] = avgA;
				}
			}
		}
	}

	ctx.putImageData(image, clipped.x, clipped.y);
}

// --- ctx.filter サポート判定（旧Safariは setter が無視される） ---
let filterSupport: boolean | undefined;

export function supportsCanvasFilter(): boolean {
	if (filterSupport === undefined) {
		if (typeof document === 'undefined') return false;
		const ctx = document.createElement('canvas').getContext('2d');
		if (ctx) {
			ctx.filter = 'blur(2px)';
			filterSupport = ctx.filter === 'blur(2px)';
		} else {
			filterSupport = false;
		}
	}
	return filterSupport;
}

/**
 * Stack Blur（Mario Klingemann 方式の簡略版）。
 * ctx.filter 非対応ブラウザ向けのフォールバック。ImageData を in-place で変更する。
 * 水平→垂直の2パス。スライディングウィンドウの差分更新により計算量は半径に依存せず O(N)。
 * 端は端ピクセルの繰り返し（clamp-to-edge）。
 * 注: 透過画像での縁の暗化を防ぐ premultiply は省略（写真用途では実質影響なし）。
 */
export function stackBlur(image: ImageData, radius: number): void {
	const r = Math.max(1, Math.round(radius));
	const { data, width, height } = image;

	// 三角重み（stack）: 中心が最大、端に向かって線形減衰
	const weightTotal = (r + 1) * (r + 1);

	const channel = new Float64Array(Math.max(width, height));

	// 1ライン分のぼかし（in-place用ワークバッファ方式）
	const blurLine = (
		read: (i: number) => number,
		write: (i: number, v: number) => void,
		length: number,
	) => {
		for (let i = 0; i < length; i++) channel[i] = read(i);
		const clampIdx = (i: number) => Math.min(length - 1, Math.max(0, i));

		// 初期スタックの構築
		let sum = 0;
		let sumIn = 0;
		let sumOut = 0;
		for (let i = -r; i <= r; i++) {
			const v = channel[clampIdx(i)];
			const weight = r + 1 - Math.abs(i);
			sum += v * weight;
			if (i <= 0) {
				sumOut += v;
			} else {
				sumIn += v;
			}
		}

		for (let i = 0; i < length; i++) {
			write(i, Math.round(sum / weightTotal));
			// ウィンドウを1つ進める（古典的な stack blur の更新順序）
			sum -= sumOut;
			sumOut -= channel[clampIdx(i - r)];
			const added = channel[clampIdx(i + r + 1)];
			sumIn += added;
			sum += sumIn;
			const center = channel[clampIdx(i + 1)];
			sumOut += center;
			sumIn -= center;
		}
	};

	for (let c = 0; c < 4; c++) {
		// 水平パス
		for (let y = 0; y < height; y++) {
			const rowOffset = y * width * 4 + c;
			blurLine(
				(i) => data[rowOffset + i * 4],
				(i, v) => {
					data[rowOffset + i * 4] = v;
				},
				width,
			);
		}
		// 垂直パス
		for (let x = 0; x < width; x++) {
			const colOffset = x * 4 + c;
			blurLine(
				(i) => data[colOffset + i * width * 4],
				(i, v) => {
					data[colOffset + i * width * 4] = v;
				},
				height,
			);
		}
	}
}

/**
 * 矩形領域にぼかしを適用する。
 * 半径分パディングした領域をサンプリングしてから内側のみ書き戻すことで、
 * 領域端で透明ピクセルや未ぼかし境界がにじむのを防ぐ。
 * ctx.filter 対応ブラウザはオフスクリーン canvas + filter、非対応時は stackBlur。
 */
export function applyBlur(
	ctx: CanvasRenderingContext2D,
	rect: Rect,
	radius: number,
): void {
	const inner = clampRect(rect, ctx.canvas.width, ctx.canvas.height);
	if (!inner) return;
	const r = Math.max(1, Math.round(radius));

	const padded = clampRect(
		{
			x: inner.x - r,
			y: inner.y - r,
			width: inner.width + r * 2,
			height: inner.height + r * 2,
		},
		ctx.canvas.width,
		ctx.canvas.height,
	);
	if (!padded) return;
	const offsetX = inner.x - padded.x;
	const offsetY = inner.y - padded.y;

	if (supportsCanvasFilter()) {
		const offscreen = document.createElement('canvas');
		offscreen.width = padded.width;
		offscreen.height = padded.height;
		const offCtx = offscreen.getContext('2d');
		if (!offCtx) return;
		offCtx.filter = `blur(${r}px)`;
		offCtx.drawImage(
			ctx.canvas,
			padded.x,
			padded.y,
			padded.width,
			padded.height,
			0,
			0,
			padded.width,
			padded.height,
		);
		// パディング部のにじみを捨て、内側のみ書き戻す
		ctx.drawImage(
			offscreen,
			offsetX,
			offsetY,
			inner.width,
			inner.height,
			inner.x,
			inner.y,
			inner.width,
			inner.height,
		);
	} else {
		const image = ctx.getImageData(
			padded.x,
			padded.y,
			padded.width,
			padded.height,
		);
		stackBlur(image, r);
		// dirty rect 指定で内側のみ書き戻す
		ctx.putImageData(
			image,
			padded.x,
			padded.y,
			offsetX,
			offsetY,
			inner.width,
			inner.height,
		);
	}
}

/**
 * 元画像にマスク領域を順に適用した Canvas を返す純粋レンダーパイプライン。
 * プレビューとエクスポートの両方がこの関数を単一ソースとして使う。
 * 領域は配列順に適用されるため、重なった領域は後のものが上書きする。
 */
export function renderMasked(
	source: HTMLImageElement | HTMLCanvasElement,
	regions: MaskRegion[],
): HTMLCanvasElement {
	const width =
		source instanceof HTMLImageElement ? source.naturalWidth : source.width;
	const height =
		source instanceof HTMLImageElement ? source.naturalHeight : source.height;

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		throw new Error('Canvas 2D コンテキストの取得に失敗しました');
	}
	ctx.drawImage(source, 0, 0);

	for (const region of regions) {
		if (region.mode === 'mosaic') {
			applyMosaic(ctx, region.rect, region.strength);
		} else {
			applyBlur(ctx, region.rect, region.strength);
		}
	}

	return canvas;
}
