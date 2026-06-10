// image-text.ts — 画像テキスト挿入のコアロジック
// すべて純粋関数。プレビューとエクスポートは renderTextLayers を単一ソースとして共用する

export type FontFamily = 'sans-serif' | 'serif' | 'monospace';

export type TextLayer = {
	id: string;
	/** 複数行可（\n 区切り） */
	text: string;
	/** テキストボックス左上の元画像座標 */
	x: number;
	y: number;
	/** フォントサイズ(px) 8–256 */
	fontSize: number;
	fontFamily: FontFamily;
	/** 塗り色（hex） */
	color: string;
	/** 縁取り色。undefined = 縁取りなし */
	strokeColor?: string;
	/** 縁取り太さ 0–10 */
	strokeWidth: number;
	/** 背景ボックス色。undefined = 背景なし */
	backgroundColor?: string;
	/** 不透明度 0.1–1.0 */
	opacity: number;
};

export const FONT_SIZE = { min: 8, max: 256, default: 32 } as const;
export const STROKE_WIDTH = { min: 0, max: 10, default: 0 } as const;
export const OPACITY = { min: 0.1, max: 1, default: 1 } as const;
export const LINE_HEIGHT = 1.4;
/** 背景ボックスのパディング(px) */
export const BG_PADDING = 4;

export const FONT_FAMILIES: readonly { value: FontFamily; label: string }[] = [
	{ value: 'sans-serif', label: 'ゴシック体' },
	{ value: 'serif', label: '明朝体' },
	{ value: 'monospace', label: '等幅' },
];

/** 新しいテキストレイヤーを作る */
export function createTextLayer(
	x: number,
	y: number,
	overrides?: Partial<Omit<TextLayer, 'id'>>,
): TextLayer {
	return {
		id: crypto.randomUUID(),
		text: 'テキスト',
		x,
		y,
		fontSize: FONT_SIZE.default,
		fontFamily: 'sans-serif',
		color: '#ff0000',
		strokeColor: undefined,
		strokeWidth: STROKE_WIDTH.default,
		backgroundColor: undefined,
		opacity: OPACITY.default,
		...overrides,
	};
}

// 計測用の共有 Canvas コンテキスト（描画とヒットテストで同じ計測結果を使う）
let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D {
	if (!measureCtx) {
		const ctx = document.createElement('canvas').getContext('2d');
		if (!ctx) {
			throw new Error('Canvas 2D コンテキストの取得に失敗しました');
		}
		measureCtx = ctx;
	}
	return measureCtx;
}

function fontString(layer: TextLayer): string {
	return `${layer.fontSize}px ${layer.fontFamily}`;
}

/**
 * テキストレイヤーのバウンディングボックス（テキスト部分のみ、背景パディング含まず）を計測する。
 * width = 最長行の幅、height = 行数 × fontSize × 行高1.4
 */
export function measureTextLayer(layer: TextLayer): {
	width: number;
	height: number;
} {
	const ctx = getMeasureCtx();
	ctx.font = fontString(layer);
	const lines = layer.text.split('\n');
	let width = 0;
	for (const line of lines) {
		width = Math.max(width, ctx.measureText(line).width);
	}
	return {
		width,
		height: lines.length * layer.fontSize * LINE_HEIGHT,
	};
}

/** 1レイヤーを ctx に描画する（背景 → 各行 stroke 先行 → fill） */
export function drawTextLayer(
	ctx: CanvasRenderingContext2D,
	layer: TextLayer,
): void {
	const lines = layer.text.split('\n');
	const lineHeight = layer.fontSize * LINE_HEIGHT;

	ctx.save();
	ctx.globalAlpha = layer.opacity;
	ctx.font = fontString(layer);
	ctx.textBaseline = 'top';

	if (layer.backgroundColor) {
		const size = measureTextLayer(layer);
		ctx.fillStyle = layer.backgroundColor;
		ctx.fillRect(
			layer.x - BG_PADDING,
			layer.y - BG_PADDING,
			size.width + BG_PADDING * 2,
			size.height + BG_PADDING * 2,
		);
	}

	// 各行の縦中央に文字を置く（行高1.4のうち上下0.2ずつが行間）
	const lineInset = (lineHeight - layer.fontSize) / 2;
	lines.forEach((line, i) => {
		const y = layer.y + i * lineHeight + lineInset;
		if (layer.strokeColor && layer.strokeWidth > 0) {
			ctx.strokeStyle = layer.strokeColor;
			ctx.lineWidth = layer.strokeWidth;
			ctx.lineJoin = 'round';
			ctx.strokeText(line, layer.x, y);
		}
		ctx.fillStyle = layer.color;
		ctx.fillText(line, layer.x, y);
	});

	ctx.restore();
}

/**
 * 元画像にテキストレイヤーを順に描画した Canvas を返す純粋レンダーパイプライン。
 * プレビューとエクスポートの両方がこの関数を単一ソースとして使う。
 */
export function renderTextLayers(
	source: HTMLImageElement | HTMLCanvasElement,
	layers: TextLayer[],
): HTMLCanvasElement {
	const width =
		source instanceof HTMLImageElement ? source.naturalWidth : source.width;
	const height =
		source instanceof HTMLImageElement ? source.naturalHeight : source.height;

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('Canvas 2D コンテキストの取得に失敗しました');
	}
	ctx.drawImage(source, 0, 0);

	for (const layer of layers) {
		drawTextLayer(ctx, layer);
	}

	return canvas;
}
