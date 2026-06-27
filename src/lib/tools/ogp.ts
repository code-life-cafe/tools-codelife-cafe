// ogp.ts — OGP画像ジェネレーターのコアロジック
// Canvas API で 1200×630 の OGP 画像を描画する純粋関数群
// プレビューとエクスポートは renderOgp を単一ソースとして共用する

export const OGP_WIDTH = 1200;
export const OGP_HEIGHT = 630;
export const LINE_HEIGHT = 1.4;
export const PADDING = 60;

const TITLE_MAX_LINES = 3;
const SUBTITLE_MAX_LINES = 2;
const SUBTITLE_FONT_SIZE = 24;
const LOGO_MAX_SIZE = 80;
const BAND_RATIO = 0.4;
const BAND_OVERLAY_ALPHA = 0.7;
const SUBTITLE_GAP = 16;

export type OgpTemplate = 'simple' | 'band' | 'photo';

export type BgKind =
	| { type: 'solid'; color: string }
	| { type: 'gradient'; from: string; to: string }
	| { type: 'image'; bitmap: ImageBitmap; overlay: number };

export type OgpSpec = {
	template: OgpTemplate;
	background: BgKind;
	title: string;
	subtitle?: string;
	textColor: string;
	align: 'left' | 'center';
	logo?: ImageBitmap;
	fontFamily: string;
};

export type FontFamily = 'sans-serif' | 'serif' | 'monospace';

export const FONT_FAMILIES: readonly { value: FontFamily; label: string }[] = [
	{ value: 'sans-serif', label: 'ゴシック体' },
	{ value: 'serif', label: '明朝体' },
	{ value: 'monospace', label: '等幅' },
];

export const TEMPLATES: readonly {
	value: OgpTemplate;
	label: string;
	description: string;
}[] = [
	{
		value: 'simple',
		label: 'シンプル',
		description: '単色またはグラデーション背景にテキスト',
	},
	{
		value: 'band',
		label: '帯',
		description: '下部に帯を配置してテキストを表示',
	},
	{
		value: 'photo',
		label: '写真背景',
		description: '画像背景＋暗幕オーバーレイ',
	},
];

// ---------------------------------------------------------------------------
// MeasureFn — Canvas テキスト計測の抽象化（テスト時にモック注入可能）
// ---------------------------------------------------------------------------

export type MeasureFn = (text: string, fontSize: number) => number;

export function createMeasureFn(
	ctx: CanvasRenderingContext2D,
	fontFamily: string,
): MeasureFn {
	return (text: string, fontSize: number) => {
		ctx.font = `bold ${fontSize}px ${fontFamily}`;
		return ctx.measureText(text).width;
	};
}

// ---------------------------------------------------------------------------
// Pure functions（DOM 非依存、Node で単体テスト可能）
// ---------------------------------------------------------------------------

/**
 * 文字単位の折り返し。maxLines を超える分は最終行に省略記号を付与する。
 * Array.from でサロゲートペア・絵文字を安全に処理する。
 */
export function wrapText(
	text: string,
	maxWidth: number,
	maxLines: number,
	measureFn: MeasureFn,
	fontSize: number,
): string[] {
	if (!text || maxLines <= 0 || maxWidth <= 0) return [];

	const chars = Array.from(text);
	const lines: string[] = [];
	let current = '';
	let allConsumed = true;

	for (let i = 0; i < chars.length; i++) {
		if (lines.length >= maxLines) {
			allConsumed = false;
			break;
		}

		const ch = chars[i];

		if (ch === '\n') {
			lines.push(current);
			current = '';
			continue;
		}

		const candidate = current + ch;
		if (current !== '' && measureFn(candidate, fontSize) > maxWidth) {
			lines.push(current);
			current = ch;
		} else {
			current = candidate;
		}
	}

	if (current && lines.length < maxLines) {
		lines.push(current);
	} else if (current) {
		allConsumed = false;
	}

	if (!allConsumed && lines.length > 0) {
		const lastIdx = lines.length - 1;
		const lastLine = lines[lastIdx];
		const ellipsis = '…';

		if (measureFn(lastLine + ellipsis, fontSize) <= maxWidth) {
			lines[lastIdx] = lastLine + ellipsis;
		} else {
			const lastChars = Array.from(lastLine);
			let fitted = '';
			for (const ch of lastChars) {
				if (measureFn(fitted + ch + ellipsis, fontSize) > maxWidth) break;
				fitted += ch;
			}
			lines[lastIdx] = fitted + ellipsis;
		}
	}

	return lines;
}

/**
 * boxWidth × boxHeight に収まる最大フォントサイズを二分探索で決定する。
 */
export function fitFontSize(
	text: string,
	boxWidth: number,
	boxHeight: number,
	maxLines: number,
	measureFn: MeasureFn,
	min = 16,
	max = 120,
): number {
	let lo = min;
	let hi = max;

	while (hi - lo > 1) {
		const mid = Math.floor((lo + hi) / 2);
		const lines = wrapText(text, boxWidth, maxLines, measureFn, mid);
		const totalHeight = lines.length * mid * LINE_HEIGHT;

		if (totalHeight <= boxHeight) {
			lo = mid;
		} else {
			hi = mid;
		}
	}

	return lo;
}

// ---------------------------------------------------------------------------
// Canvas 描画（ブラウザ専用、E2E でテスト）
// ---------------------------------------------------------------------------

function drawBackground(ctx: CanvasRenderingContext2D, bg: BgKind): void {
	const { OGP_WIDTH: w, OGP_HEIGHT: h } = { OGP_WIDTH, OGP_HEIGHT };
	switch (bg.type) {
		case 'solid':
			ctx.fillStyle = bg.color;
			ctx.fillRect(0, 0, w, h);
			break;
		case 'gradient': {
			const grad = ctx.createLinearGradient(0, 0, w, h);
			grad.addColorStop(0, bg.from);
			grad.addColorStop(1, bg.to);
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, w, h);
			break;
		}
		case 'image':
			ctx.drawImage(bg.bitmap, 0, 0, w, h);
			break;
	}
}

/**
 * 単一レンダーパイプライン。プレビューとエクスポートの両方がこの関数を共用する。
 */
export function renderOgp(spec: OgpSpec): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = OGP_WIDTH;
	canvas.height = OGP_HEIGHT;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D コンテキストの取得に失敗しました');

	// 1. 背景描画
	drawBackground(ctx, spec.background);

	// 2. テンプレート固有のオーバーレイ
	const bandY = Math.round(OGP_HEIGHT * (1 - BAND_RATIO));
	const bandHeight = OGP_HEIGHT - bandY;

	if (spec.template === 'photo' && spec.background.type === 'image') {
		ctx.fillStyle = `rgba(0, 0, 0, ${spec.background.overlay})`;
		ctx.fillRect(0, 0, OGP_WIDTH, OGP_HEIGHT);
	} else if (spec.template === 'band') {
		ctx.fillStyle = `rgba(0, 0, 0, ${BAND_OVERLAY_ALPHA})`;
		ctx.fillRect(0, bandY, OGP_WIDTH, bandHeight);
	}

	// 3. テキストエリア算出
	const textWidth = OGP_WIDTH - PADDING * 2;
	let textAreaY: number;
	let textAreaHeight: number;

	if (spec.template === 'band') {
		textAreaY = bandY + PADDING / 2;
		textAreaHeight = bandHeight - PADDING;
	} else {
		textAreaY = PADDING;
		textAreaHeight = OGP_HEIGHT - PADDING * 2;
	}

	const titleMeasureFn = createMeasureFn(ctx, spec.fontFamily);

	// サブタイトル計測（タイトル領域の高さ確保に必要）
	let subtitleLines: string[] = [];
	let subtitleTotalHeight = 0;
	if (spec.subtitle) {
		const subMeasureFn: MeasureFn = (text, fontSize) => {
			ctx.font = `${fontSize}px ${spec.fontFamily}`;
			return ctx.measureText(text).width;
		};
		subtitleLines = wrapText(
			spec.subtitle,
			textWidth,
			SUBTITLE_MAX_LINES,
			subMeasureFn,
			SUBTITLE_FONT_SIZE,
		);
		subtitleTotalHeight =
			subtitleLines.length * SUBTITLE_FONT_SIZE * LINE_HEIGHT + SUBTITLE_GAP;
	}

	// 4. タイトル描画
	const titleBoxHeight = textAreaHeight - subtitleTotalHeight;
	const titleFontSize = fitFontSize(
		spec.title,
		textWidth,
		titleBoxHeight,
		TITLE_MAX_LINES,
		titleMeasureFn,
	);
	const titleLines = wrapText(
		spec.title,
		textWidth,
		TITLE_MAX_LINES,
		titleMeasureFn,
		titleFontSize,
	);
	const titleTotalHeight = titleLines.length * titleFontSize * LINE_HEIGHT;

	const blockHeight = titleTotalHeight + subtitleTotalHeight;
	const blockY = textAreaY + (textAreaHeight - blockHeight) / 2;

	ctx.fillStyle = spec.textColor;
	ctx.textBaseline = 'top';
	ctx.font = `bold ${titleFontSize}px ${spec.fontFamily}`;

	for (let i = 0; i < titleLines.length; i++) {
		const lineY = blockY + i * titleFontSize * LINE_HEIGHT;
		let lineX: number;
		if (spec.align === 'center') {
			const lw = titleMeasureFn(titleLines[i], titleFontSize);
			lineX = (OGP_WIDTH - lw) / 2;
		} else {
			lineX = PADDING;
		}
		ctx.fillText(titleLines[i], lineX, lineY);
	}

	// 5. サブタイトル描画
	if (spec.subtitle && subtitleLines.length > 0) {
		const subtitleY = blockY + titleTotalHeight + SUBTITLE_GAP;
		ctx.font = `${SUBTITLE_FONT_SIZE}px ${spec.fontFamily}`;
		ctx.globalAlpha = 0.8;

		for (let i = 0; i < subtitleLines.length; i++) {
			const lineY = subtitleY + i * SUBTITLE_FONT_SIZE * LINE_HEIGHT;
			let lineX: number;
			if (spec.align === 'center') {
				const lw = ctx.measureText(subtitleLines[i]).width;
				lineX = (OGP_WIDTH - lw) / 2;
			} else {
				lineX = PADDING;
			}
			ctx.fillText(subtitleLines[i], lineX, lineY);
		}
		ctx.globalAlpha = 1;
	}

	// 6. ロゴ描画
	if (spec.logo) {
		const scale = Math.min(
			LOGO_MAX_SIZE / spec.logo.width,
			LOGO_MAX_SIZE / spec.logo.height,
			1,
		);
		const w = spec.logo.width * scale;
		const h = spec.logo.height * scale;
		const logoX = OGP_WIDTH - PADDING - w;
		const logoY =
			spec.template === 'band'
				? bandY - h - PADDING / 2
				: OGP_HEIGHT - PADDING - h;
		ctx.drawImage(spec.logo, logoX, logoY, w, h);
	}

	return canvas;
}
