// qr-restore.ts — 破損・不鮮明なQRコードの読み取りを補助する画像前処理（純粋関数）
//
// 画像はグレースケール（1ピクセル1バイト）の GrayImage として扱う。
// デコード自体（zxing-wasm）は呼び出し側が decode 関数として渡す。
// ここでは前処理の各手法と「手法を順に試して最初に読めた結果を返す」流れだけを持ち、
// DOM・Worker・React に依存しない（node --test で検証できる）。

export type GrayImage = {
	width: number;
	height: number;
	/** 0（黒）〜255（白）の輝度。長さは width * height */
	data: Uint8ClampedArray;
};

/** 前処理で扱う画像の上限（画素数）。これを超える画像は縮小してから処理する */
export const MAX_RESTORE_PIXELS = 1600 * 1600;

/** 小さい画像を拡大する手法の上限（拡大後の画素数） */
const MAX_UPSCALE_PIXELS = 2400 * 2400;

function createGray(width: number, height: number, fill = 255): GrayImage {
	const data = new Uint8ClampedArray(width * height);
	if (fill !== 0) data.fill(fill);
	return { width, height, data };
}

function assertValidSize(width: number, height: number): void {
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error('画像の幅と高さが正しくありません');
	}
}

/** RGBA（ImageData.data）をグレースケールへ変換する。透明部分は白として扱う */
export function rgbaToGray(
	rgba: Uint8ClampedArray,
	width: number,
	height: number,
): GrayImage {
	assertValidSize(width, height);
	if (rgba.length !== width * height * 4) {
		throw new Error('画像データの長さが幅と高さに一致しません');
	}
	const out = createGray(width, height, 0);
	for (let i = 0, p = 0; p < out.data.length; i += 4, p++) {
		const alpha = rgba[i + 3] / 255;
		const luma = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
		out.data[p] = Math.round(luma * alpha + 255 * (1 - alpha));
	}
	return out;
}

/** グレースケールをRGBA（不透明）へ戻す。デコーダーや canvas へ渡すため */
export function grayToRgba(image: GrayImage): Uint8ClampedArray {
	const out = new Uint8ClampedArray(image.width * image.height * 4);
	for (let p = 0, i = 0; p < image.data.length; p++, i += 4) {
		const v = image.data[p];
		out[i] = v;
		out[i + 1] = v;
		out[i + 2] = v;
		out[i + 3] = 255;
	}
	return out;
}

function histogram(image: GrayImage): Uint32Array {
	const hist = new Uint32Array(256);
	for (const v of image.data) hist[v]++;
	return hist;
}

function percentileValue(hist: Uint32Array, total: number, ratio: number) {
	const target = Math.min(total - 1, Math.max(0, Math.floor(total * ratio)));
	let acc = 0;
	for (let v = 0; v < 256; v++) {
		acc += hist[v];
		if (acc > target) return v;
	}
	return 255;
}

/**
 * コントラストを引き伸ばす（明るさの下位 lowRatio・上位 highRatio を黒・白へ）。
 * 薄い印刷・暗い写真・白飛び気味の画像の明暗差を広げる。
 */
export function stretchContrast(
	image: GrayImage,
	lowRatio = 0.01,
	highRatio = 0.99,
): GrayImage {
	const hist = histogram(image);
	const total = image.data.length;
	const low = percentileValue(hist, total, lowRatio);
	const high = percentileValue(hist, total, highRatio);
	const out = createGray(image.width, image.height, 0);
	if (high <= low) {
		out.data.set(image.data);
		return out;
	}
	const scale = 255 / (high - low);
	for (let p = 0; p < image.data.length; p++) {
		out.data[p] = Math.round((image.data[p] - low) * scale);
	}
	return out;
}

/** 大津の方法で、明暗を分ける最適なしきい値（0〜255）を求める */
export function otsuThreshold(image: GrayImage): number {
	const hist = histogram(image);
	const total = image.data.length;
	let sumAll = 0;
	for (let v = 0; v < 256; v++) sumAll += v * hist[v];
	let sumBack = 0;
	let weightBack = 0;
	let best = 127;
	let bestVar = -1;
	for (let t = 0; t < 256; t++) {
		weightBack += hist[t];
		if (weightBack === 0) continue;
		const weightFore = total - weightBack;
		if (weightFore === 0) break;
		sumBack += t * hist[t];
		const meanBack = sumBack / weightBack;
		const meanFore = (sumAll - sumBack) / weightFore;
		const between = weightBack * weightFore * (meanBack - meanFore) ** 2;
		if (between > bestVar) {
			bestVar = between;
			best = t;
		}
	}
	return best;
}

/** しきい値以下を黒（0）、それより明るい画素を白（255）にする */
export function binarize(image: GrayImage, threshold: number): GrayImage {
	const out = createGray(image.width, image.height, 0);
	for (let p = 0; p < image.data.length; p++) {
		out.data[p] = image.data[p] <= threshold ? 0 : 255;
	}
	return out;
}

/**
 * 局所平均による二値化。周囲 windowSize 四方の平均より offset 以上暗い画素を黒にする。
 * 影・照明むら（片側だけ暗い写真など）がある画像向け。
 */
export function adaptiveBinarize(
	image: GrayImage,
	windowSize: number,
	offset = 8,
): GrayImage {
	const { width, height, data } = image;
	const half = Math.max(1, Math.floor(windowSize / 2));
	// 積分画像（(width+1)*(height+1)）
	const stride = width + 1;
	const integral = new Float64Array(stride * (height + 1));
	for (let y = 0; y < height; y++) {
		let rowSum = 0;
		for (let x = 0; x < width; x++) {
			rowSum += data[y * width + x];
			integral[(y + 1) * stride + x + 1] =
				integral[y * stride + x + 1] + rowSum;
		}
	}
	const out = createGray(width, height, 0);
	for (let y = 0; y < height; y++) {
		const y0 = Math.max(0, y - half);
		const y1 = Math.min(height, y + half + 1);
		for (let x = 0; x < width; x++) {
			const x0 = Math.max(0, x - half);
			const x1 = Math.min(width, x + half + 1);
			const sum =
				integral[y1 * stride + x1] -
				integral[y0 * stride + x1] -
				integral[y1 * stride + x0] +
				integral[y0 * stride + x0];
			const mean = sum / ((x1 - x0) * (y1 - y0));
			out.data[y * width + x] = data[y * width + x] < mean - offset ? 0 : 255;
		}
	}
	return out;
}

/** 3×3 のメディアンフィルタ。点状のノイズ・ゴミ・JPEGのざらつきを消す */
export function medianFilter3(image: GrayImage): GrayImage {
	const { width, height, data } = image;
	const out = createGray(width, height, 0);
	const win = new Uint8Array(9);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let n = 0;
			for (let dy = -1; dy <= 1; dy++) {
				const yy = Math.min(height - 1, Math.max(0, y + dy));
				for (let dx = -1; dx <= 1; dx++) {
					const xx = Math.min(width - 1, Math.max(0, x + dx));
					win[n++] = data[yy * width + xx];
				}
			}
			win.sort();
			out.data[y * width + x] = win[4];
		}
	}
	return out;
}

/** 箱型ぼかし（半径 radius）。細かいノイズをならしてから二値化するため */
export function boxBlur(image: GrayImage, radius = 1): GrayImage {
	const { width, height, data } = image;
	const r = Math.max(1, Math.floor(radius));
	const tmp = new Float32Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let sum = 0;
			let count = 0;
			for (let dx = -r; dx <= r; dx++) {
				const xx = x + dx;
				if (xx < 0 || xx >= width) continue;
				sum += data[y * width + xx];
				count++;
			}
			tmp[y * width + x] = sum / count;
		}
	}
	const out = createGray(width, height, 0);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let sum = 0;
			let count = 0;
			for (let dy = -r; dy <= r; dy++) {
				const yy = y + dy;
				if (yy < 0 || yy >= height) continue;
				sum += tmp[yy * width + x];
				count++;
			}
			out.data[y * width + x] = Math.round(sum / count);
		}
	}
	return out;
}

/** アンシャープマスクで輪郭を強調する（ピンぼけ・にじみ向け） */
export function sharpen(image: GrayImage, amount = 1): GrayImage {
	const blurred = boxBlur(image, 1);
	const out = createGray(image.width, image.height, 0);
	for (let p = 0; p < image.data.length; p++) {
		out.data[p] = Math.round(
			image.data[p] + amount * (image.data[p] - blurred.data[p]),
		);
	}
	return out;
}

/** 明暗を反転する（黒地に白のQRコード向け） */
export function invert(image: GrayImage): GrayImage {
	const out = createGray(image.width, image.height, 0);
	for (let p = 0; p < image.data.length; p++) out.data[p] = 255 - image.data[p];
	return out;
}

/** 3×3 の最小値（黒を太らせる）。モジュール内の白い欠け・かすれを埋める */
export function erode3(image: GrayImage): GrayImage {
	return extremum3(image, Math.min);
}

/** 3×3 の最大値（黒を細らせる）。黒いにじみ・つぶれを細くする */
export function dilate3(image: GrayImage): GrayImage {
	return extremum3(image, Math.max);
}

function extremum3(
	image: GrayImage,
	pick: (a: number, b: number) => number,
): GrayImage {
	const { width, height, data } = image;
	const out = createGray(width, height, 0);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let v = data[y * width + x];
			for (let dy = -1; dy <= 1; dy++) {
				const yy = y + dy;
				if (yy < 0 || yy >= height) continue;
				for (let dx = -1; dx <= 1; dx++) {
					const xx = x + dx;
					if (xx < 0 || xx >= width) continue;
					v = pick(v, data[yy * width + xx]);
				}
			}
			out.data[y * width + x] = v;
		}
	}
	return out;
}

/** 双線形補間で拡大・縮小する */
export function resize(
	image: GrayImage,
	width: number,
	height: number,
): GrayImage {
	assertValidSize(width, height);
	const out = createGray(width, height, 0);
	const sx = image.width / width;
	const sy = image.height / height;
	for (let y = 0; y < height; y++) {
		const fy = Math.min(image.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
		const y0 = Math.floor(fy);
		const y1 = Math.min(image.height - 1, y0 + 1);
		const wy = fy - y0;
		for (let x = 0; x < width; x++) {
			const fx = Math.min(image.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
			const x0 = Math.floor(fx);
			const x1 = Math.min(image.width - 1, x0 + 1);
			const wx = fx - x0;
			const a = image.data[y0 * image.width + x0];
			const b = image.data[y0 * image.width + x1];
			const c = image.data[y1 * image.width + x0];
			const d = image.data[y1 * image.width + x1];
			out.data[y * width + x] = Math.round(
				a * (1 - wx) * (1 - wy) +
					b * wx * (1 - wy) +
					c * (1 - wx) * wy +
					d * wx * wy,
			);
		}
	}
	return out;
}

/** 画素数が maxPixels を超える場合だけ、縦横比を保って縮小する */
export function limitPixels(
	image: GrayImage,
	maxPixels = MAX_RESTORE_PIXELS,
): GrayImage {
	const pixels = image.width * image.height;
	if (pixels <= maxPixels) return image;
	const scale = Math.sqrt(maxPixels / pixels);
	return resize(
		image,
		Math.max(1, Math.floor(image.width * scale)),
		Math.max(1, Math.floor(image.height * scale)),
	);
}

/** 周囲に白い余白（クワイエットゾーン）を足す。余白ぎりぎりで切り取られた画像向け */
export function addMargin(image: GrayImage, margin: number): GrayImage {
	const m = Math.max(0, Math.floor(margin));
	const out = createGray(image.width + m * 2, image.height + m * 2, 255);
	for (let y = 0; y < image.height; y++) {
		out.data.set(
			image.data.subarray(y * image.width, (y + 1) * image.width),
			(y + m) * out.width + m,
		);
	}
	return out;
}

// --- 復元手順 ---

export type RestoreStep = {
	id: string;
	/** 画面に出す手法名 */
	label: string;
	apply: (image: GrayImage) => GrayImage;
};

function marginFor(image: GrayImage): number {
	return Math.max(8, Math.round(Math.min(image.width, image.height) * 0.08));
}

function upscaleFactor(image: GrayImage): number {
	const pixels = image.width * image.height;
	if (pixels * 4 <= MAX_UPSCALE_PIXELS) return 2;
	return 1;
}

/**
 * 試す順番に並べた前処理。軽い補正から強い補正の順。
 * それぞれ元画像（グレースケール）から独立に作る（前の手法の結果を引き継がない）。
 */
export const RESTORE_STEPS: readonly RestoreStep[] = [
	{ id: 'original', label: '元の画像', apply: (img) => img },
	{
		id: 'margin',
		label: '余白を追加',
		apply: (img) => addMargin(img, marginFor(img)),
	},
	{
		id: 'contrast',
		label: 'コントラストを強める',
		apply: (img) => addMargin(stretchContrast(img), marginFor(img)),
	},
	{
		id: 'denoise',
		label: 'ノイズを除去',
		apply: (img) =>
			addMargin(stretchContrast(medianFilter3(img)), marginFor(img)),
	},
	{
		id: 'otsu',
		label: '白黒に二値化',
		apply: (img) => {
			const smoothed = boxBlur(stretchContrast(img), 1);
			return addMargin(
				binarize(smoothed, otsuThreshold(smoothed)),
				marginFor(img),
			);
		},
	},
	{
		id: 'adaptive',
		label: '影・照明むらを補正',
		apply: (img) => {
			const window = Math.max(
				15,
				Math.round(Math.min(img.width, img.height) / 8),
			);
			return addMargin(
				adaptiveBinarize(boxBlur(img, 1), window, 6),
				marginFor(img),
			);
		},
	},
	{
		id: 'sharpen',
		label: 'ぼやけを補正（輪郭を強調）',
		apply: (img) =>
			addMargin(sharpen(stretchContrast(img), 1.5), marginFor(img)),
	},
	{
		id: 'upscale',
		label: '拡大して補正（小さい・粗い画像）',
		apply: (img) => {
			const f = upscaleFactor(img);
			const big = f > 1 ? resize(img, img.width * f, img.height * f) : img;
			const smoothed = boxBlur(stretchContrast(big), 1);
			return addMargin(
				binarize(smoothed, otsuThreshold(smoothed)),
				marginFor(big),
			);
		},
	},
	{
		id: 'fill-gaps',
		label: 'かすれ・白い欠けを埋める',
		apply: (img) => {
			const smoothed = boxBlur(stretchContrast(img), 1);
			const bin = binarize(smoothed, otsuThreshold(smoothed));
			return addMargin(dilate3(erode3(bin)), marginFor(img));
		},
	},
	{
		id: 'thin',
		label: 'にじみ・黒つぶれを細くする',
		apply: (img) => {
			const smoothed = boxBlur(stretchContrast(img), 1);
			const bin = binarize(smoothed, otsuThreshold(smoothed));
			return addMargin(erode3(dilate3(bin)), marginFor(img));
		},
	},
	{
		id: 'threshold-dark',
		label: '濃い部分だけを黒にする',
		apply: (img) => {
			const s = stretchContrast(img);
			return addMargin(
				binarize(s, Math.round(otsuThreshold(s) * 0.6)),
				marginFor(img),
			);
		},
	},
	{
		id: 'threshold-light',
		label: '薄い部分も黒にする',
		apply: (img) => {
			const s = stretchContrast(img);
			const t = otsuThreshold(s);
			return addMargin(
				binarize(s, Math.round(t + (255 - t) * 0.4)),
				marginFor(img),
			);
		},
	},
	{
		id: 'invert',
		label: '明暗を反転',
		apply: (img) => addMargin(invert(stretchContrast(img)), marginFor(img)),
	},
];

export type RestoreAttempt = {
	id: string;
	label: string;
	found: boolean;
};

export type RestoreOutcome =
	| {
			status: 'success';
			texts: string[];
			step: { id: string; label: string };
			/** 読み取りに成功した前処理後の画像 */
			image: GrayImage;
			attempts: RestoreAttempt[];
	  }
	| { status: 'failed'; attempts: RestoreAttempt[] };

export type RestoreProgress = {
	index: number;
	total: number;
	label: string;
};

/**
 * 前処理を順に試し、最初にQRコードを読み取れた結果を返す。
 * decode は前処理後の画像を受け取り、読み取れた文字列の配列（なければ空配列）を返す。
 * decode が例外を投げた手法は「読み取れなかった」として次へ進む。
 */
export async function runRestore(
	source: GrayImage,
	decode: (image: GrayImage) => Promise<string[]>,
	options: {
		steps?: readonly RestoreStep[];
		onProgress?: (progress: RestoreProgress) => void;
	} = {},
): Promise<RestoreOutcome> {
	const steps = options.steps ?? RESTORE_STEPS;
	const base = limitPixels(source);
	const attempts: RestoreAttempt[] = [];
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		options.onProgress?.({ index: i, total: steps.length, label: step.label });
		const processed = step.apply(base);
		let texts: string[] = [];
		try {
			texts = (await decode(processed)).filter((t) => t.length > 0);
		} catch {
			texts = [];
		}
		const unique = [...new Set(texts)];
		attempts.push({ id: step.id, label: step.label, found: unique.length > 0 });
		if (unique.length > 0) {
			return {
				status: 'success',
				texts: unique,
				step: { id: step.id, label: step.label },
				image: processed,
				attempts,
			};
		}
	}
	return { status: 'failed', attempts };
}

// --- 入力ファイルの検証 ---

export const RESTORE_ACCEPTED_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
] as const;

export const RESTORE_MAX_FILE_SIZE = 20 * 1024 * 1024;

/** 画像ファイルの形式とサイズを確かめる。問題があれば日本語のエラー文言を返す */
export function validateRestoreFile(file: {
	type: string;
	size: number;
}): string | null {
	if (!(RESTORE_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
		return '対応形式は PNG・JPEG・WebP です。別の形式の画像は、スクリーンショットなどでPNGにしてからお試しください。';
	}
	if (file.size <= 0) {
		return '画像ファイルが空です。';
	}
	if (file.size > RESTORE_MAX_FILE_SIZE) {
		return `ファイルサイズは${RESTORE_MAX_FILE_SIZE / 1024 / 1024}MB以下にしてください。`;
	}
	return null;
}
