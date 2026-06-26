// favicon.ts — ファビコン生成ツールのコアロジック（純TS・React非依存）
// 1枚の画像から favicon.ico（16/32/48内包）・各サイズPNG・apple-touch-icon・
// Android/PWA アイコン・site.webmanifest・HTMLスニペットを生成する。
//
// ラスタライズ（rasterize / generatePngSet / generateFavicons）は Canvas/Image など
// ブラウザAPIに依存するため Node では実行できない（E2Eで検証）。
// シグネチャ検証・ICOエンコード・manifest/HTML生成は DOM 非依存の純関数で、
// tests/unit/favicon.test.ts でユニットテストする。
//
// ICOは複数PNGをラップする単純なコンテナ形式（ICONDIR + ICONDIRENTRY×N + PNGペイロード）。
// scripts/_gen-favicons.mts（Node Buffer版）のエンコードを Uint8Array/DataView へ移植している。

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export type FitMode = 'cover' | 'contain';

export type FaviconOptions = {
	/** 非正方形入力の収め方: cover=中央クロップ / contain=アスペクト維持＋背景色余白 */
	fit: FitMode;
	/** 余白・透過なし入力の塗り。'transparent' または CSS カラー */
	background: string | 'transparent';
	/** site.webmanifest の name */
	appName: string;
	/** theme-color メタ・manifest の theme_color */
	themeColor: string;
	/** manifest の background_color */
	backgroundColor: string;
};

export type FaviconAsset =
	| 'favicon-16x16.png'
	| 'favicon-32x32.png'
	| 'apple-touch-icon.png' // 180x180
	| 'android-chrome-192x192.png'
	| 'android-chrome-512x512.png';

export type ImageKind = 'png' | 'jpeg' | 'webp' | 'svg';

export type ImageInputValidation =
	| { ok: true; kind: ImageKind }
	| {
			ok: false;
			reason:
				| 'unsupported-type'
				| 'too-large'
				| 'invalid-signature'
				| 'unsafe-svg';
			message: string;
	  };

/** Canvas へ描画するための画像ソース（自然な寸法を併せ持つ） */
export type RasterSource = {
	readonly image: CanvasImageSource;
	readonly width: number;
	readonly height: number;
	/** 読み込みに使った object URL を解放する（描画完了後に呼ぶ） */
	dispose(): void;
};

export type RasterizeOptions = {
	fit: FitMode;
	background: string | 'transparent';
};

export type ManifestOptions = {
	appName: string;
	shortName?: string;
	themeColor: string;
	backgroundColor: string;
};

export type GeneratedFavicons = {
	pngs: Record<FaviconAsset, Blob>;
	ico: Blob;
	webmanifest: string;
};

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 入力ファイルの上限: 20MB */
export const MAX_FAVICON_FILE_SIZE = 20 * 1024 * 1024;

/** マスターキャンバスの一辺（SVGはここでラスタライズしてから各サイズへ縮小） */
export const MASTER_SIZE = 512;

/** favicon.ico に内包するサイズ */
export const ICO_SIZES = [16, 32, 48] as const;

/** 出力する PNG アセットと一辺（すべて正方形） */
export const ASSET_SIZES: Record<FaviconAsset, number> = {
	'favicon-16x16.png': 16,
	'favicon-32x32.png': 32,
	'apple-touch-icon.png': 180,
	'android-chrome-192x192.png': 192,
	'android-chrome-512x512.png': 512,
};

export const FAVICON_ASSETS = Object.keys(ASSET_SIZES) as FaviconAsset[];

const SUPPORTED_MIME = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/svg+xml',
] as const;

// ---------------------------------------------------------------------------
// バリデーション（DOM非依存・ユニットテスト対象）
// ---------------------------------------------------------------------------

/** ヘッダ先頭領域を緩く ASCII/UTF-8 文字列化する（SVG 判定用） */
function decodeHeaderText(header: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', { fatal: false }).decode(header);
	} catch {
		let s = '';
		for (let i = 0; i < header.length; i++) s += String.fromCharCode(header[i]);
		return s;
	}
}

/**
 * 先頭バイト列から画像種別をマジックナンバーで判定する。
 * PNG `89 50 4E 47` / JPEG `FF D8 FF` / WebP `RIFF....WEBP` / SVG（`<svg` を含む）。
 */
export function detectImageKind(header: Uint8Array): ImageKind | null {
	if (
		header.length >= 4 &&
		header[0] === 0x89 &&
		header[1] === 0x50 &&
		header[2] === 0x4e &&
		header[3] === 0x47
	) {
		return 'png';
	}
	if (
		header.length >= 3 &&
		header[0] === 0xff &&
		header[1] === 0xd8 &&
		header[2] === 0xff
	) {
		return 'jpeg';
	}
	if (
		header.length >= 12 &&
		header[0] === 0x52 && // R
		header[1] === 0x49 && // I
		header[2] === 0x46 && // F
		header[3] === 0x46 && // F
		header[8] === 0x57 && // W
		header[9] === 0x45 && // E
		header[10] === 0x42 && // B
		header[11] === 0x50 // P
	) {
		return 'webp';
	}
	// SVG: 先頭領域（BOM/<?xml/コメント/空白を許容）に <svg を含む
	if (decodeHeaderText(header).toLowerCase().includes('<svg')) {
		return 'svg';
	}
	return null;
}

/**
 * 入力ファイルを検証する。サイズ→MIME→シグネチャの順でチェックする。
 * シグネチャ照合のためファイル先頭を読むので非同期。
 */
export async function validateImageFile(
	file: File,
): Promise<ImageInputValidation> {
	if (file.size > MAX_FAVICON_FILE_SIZE) {
		return {
			ok: false,
			reason: 'too-large',
			message: 'ファイルサイズが20MBを超えています。',
		};
	}
	// type が明示されていて未対応なら早期に弾く（GIF など）
	if (file.type && !(SUPPORTED_MIME as readonly string[]).includes(file.type)) {
		return {
			ok: false,
			reason: 'unsupported-type',
			message:
				'対応していない形式です。PNG / JPEG / WebP / SVG 画像を選択してください。',
		};
	}
	const header = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
	const kind = detectImageKind(header);
	if (!kind) {
		return {
			ok: false,
			reason: 'invalid-signature',
			message:
				'画像の形式を判別できませんでした。PNG / JPEG / WebP / SVG を選択してください。',
		};
	}
	return { ok: true, kind };
}

// ---------------------------------------------------------------------------
// SVG の安全性検証・寸法解析（DOM非依存・ユニットテスト対象）
// ---------------------------------------------------------------------------

// 外部送信・スクリプト実行につながる危険な要素/属性。自己完結SVGのみ許可する。
// data: URI（インライン）は許可し、http(s)・プロトコル相対 // のみ外部参照として拒否する。
const SVG_UNSAFE_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
	{ re: /<script[\s/>]/i, reason: 'script要素' },
	{ re: /<foreignObject[\s/>]/i, reason: 'foreignObject要素' },
	{ re: /<iframe[\s/>]/i, reason: 'iframe要素' },
	// onload= などのイベントハンドラ属性
	{ re: /\son[a-z]+\s*=/i, reason: 'イベントハンドラ属性' },
	// href / xlink:href が外部（http(s) もしくは // 始まり）を指す
	{
		re: /(?:xlink:)?href\s*=\s*["']?\s*(?:https?:)?\/\//i,
		reason: '外部参照（href）',
	},
	// CSS url(...) / @import が外部を指す
	{ re: /url\(\s*["']?\s*(?:https?:)?\/\//i, reason: '外部参照（CSS url）' },
	{ re: /@import/i, reason: '外部参照（@import）' },
];

/**
 * SVG テキストが自己完結かを検証する（外部参照・スクリプトを含まないこと）。
 * 要件「画像を外部送信しない」を満たすため、ラスタライズ前に必ず通す。
 */
export function validateSvgSafety(
	text: string,
): { ok: true } | { ok: false; reason: string; message: string } {
	for (const { re, reason } of SVG_UNSAFE_PATTERNS) {
		if (re.test(text)) {
			return {
				ok: false,
				reason,
				message: `外部参照やスクリプトを含むSVGには対応していません（${reason}）。自己完結したSVGを選択してください。`,
			};
		}
	}
	return { ok: true };
}

function parseSvgLength(value: string | null): number | null {
	if (!value) return null;
	// "512" / "512px" のみ採用。% など相対単位は寸法として使えないので null
	const m = /^\s*([\d.]+)\s*(px)?\s*$/i.exec(value);
	if (!m) return null;
	const n = Number.parseFloat(m[1]);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * SVG ルート要素から表示寸法（アスペクト比）を求める。
 * width/height を優先し、なければ viewBox の幅高、いずれも無ければ正方形(512)。
 */
export function parseSvgDimensions(text: string): {
	width: number;
	height: number;
} {
	const tagMatch = /<svg\b[^>]*>/i.exec(text);
	const tag = tagMatch ? tagMatch[0] : '';
	const attr = (name: string): string | null => {
		const m =
			new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag) ??
			new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
		return m ? m[1] : null;
	};

	const w = parseSvgLength(attr('width'));
	const h = parseSvgLength(attr('height'));
	if (w && h) return { width: w, height: h };

	const viewBox = attr('viewBox');
	if (viewBox) {
		const parts = viewBox
			.trim()
			.split(/[\s,]+/)
			.map(Number);
		if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
			return { width: parts[2], height: parts[3] };
		}
	}
	return { width: MASTER_SIZE, height: MASTER_SIZE };
}

/** HTML 属性値として安全になるようエスケープする（コピー出力の改ざん防止） */
export function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// ICO エンコード（DOM非依存・ユニットテスト対象）
// ---------------------------------------------------------------------------

/**
 * 複数の PNG を内包する favicon.ico をエンコードする（PNG-in-ICO）。
 * 構造: ICONDIR(6) + ICONDIRENTRY(16)×N + PNGペイロード×N。
 */
export function encodeIco(
	images: ReadonlyArray<{ size: number; bytes: Uint8Array }>,
): Uint8Array<ArrayBuffer> {
	const count = images.length;
	const headerSize = 6;
	const dirSize = count * 16;
	const dataSize = images.reduce((sum, im) => sum + im.bytes.length, 0);
	const out = new Uint8Array(headerSize + dirSize + dataSize);
	const view = new DataView(out.buffer);

	// ICONDIR
	view.setUint16(0, 0, true); // reserved
	view.setUint16(2, 1, true); // type: 1 = icon
	view.setUint16(4, count, true); // number of images

	let entryPos = headerSize;
	let dataOffset = headerSize + dirSize;
	for (const im of images) {
		// 256px は 0 で表現する仕様
		const dim = im.size >= 256 ? 0 : im.size;
		out[entryPos] = dim; // width
		out[entryPos + 1] = dim; // height
		out[entryPos + 2] = 0; // color count（パレットなし）
		out[entryPos + 3] = 0; // reserved
		view.setUint16(entryPos + 4, 1, true); // color planes
		view.setUint16(entryPos + 6, 32, true); // bits per pixel
		view.setUint32(entryPos + 8, im.bytes.length, true); // image data size
		view.setUint32(entryPos + 12, dataOffset, true); // offset
		out.set(im.bytes, dataOffset);
		entryPos += 16;
		dataOffset += im.bytes.length;
	}
	return out;
}

// ---------------------------------------------------------------------------
// manifest / HTML 生成（DOM非依存・ユニットテスト対象）
// ---------------------------------------------------------------------------

/** site.webmanifest（有効JSON文字列）を生成する */
export function buildWebmanifest(opts: ManifestOptions): string {
	const manifest = {
		name: opts.appName,
		short_name: opts.shortName?.trim() || opts.appName,
		icons: [
			{
				src: '/android-chrome-192x192.png',
				sizes: '192x192',
				type: 'image/png',
			},
			{
				src: '/android-chrome-512x512.png',
				sizes: '512x512',
				type: 'image/png',
			},
		],
		theme_color: opts.themeColor,
		background_color: opts.backgroundColor,
		display: 'standalone',
	};
	return JSON.stringify(manifest, null, 2);
}

/** <head> に貼り付ける HTML スニペットを生成する */
export function buildHtmlSnippet(opts: { themeColor: string }): string {
	return [
		'<link rel="icon" href="/favicon.ico" sizes="any">',
		'<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
		'<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
		'<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
		'<link rel="manifest" href="/site.webmanifest">',
		`<meta name="theme-color" content="${escapeHtmlAttribute(opts.themeColor)}">`,
	].join('\n');
}

// ---------------------------------------------------------------------------
// ラスタライズ（ブラウザAPI依存・E2Eで検証）
// ---------------------------------------------------------------------------

/**
 * File から描画ソースを読み込む。
 * SVG は描画前にテキストを検査し、外部参照・スクリプトを含む場合は拒否する
 * （要件「画像を外部送信しない」を満たすため Image 生成前に検証する）。
 * 寸法は SVG の width/height/viewBox から決定し、取れない場合は正方形512とする。
 */
export async function loadImageSource(
	file: File,
	kind: ImageKind,
): Promise<RasterSource> {
	let svgDimensions: { width: number; height: number } | null = null;
	if (kind === 'svg') {
		const text = await file.text();
		const safety = validateSvgSafety(text);
		if (!safety.ok) {
			throw new Error(safety.message);
		}
		svgDimensions = parseSvgDimensions(text);
	}

	const url = URL.createObjectURL(file);
	const img = new Image();
	img.decoding = 'async';
	img.src = url;
	try {
		await img.decode();
	} catch {
		URL.revokeObjectURL(url);
		throw new Error(
			'画像の読み込みに失敗しました。ファイルが破損している可能性があります。',
		);
	}

	let width = svgDimensions?.width ?? img.naturalWidth;
	let height = svgDimensions?.height ?? img.naturalHeight;
	if (!width || !height) {
		width = MASTER_SIZE;
		height = MASTER_SIZE;
	}
	if (kind === 'svg') {
		// SVG は表示寸法を明示してから drawImage で意図した解像度にラスタライズする
		img.width = width;
		img.height = height;
	}
	// SVG は drawImage 時に再ラスタライズされる場合があるため、URL は dispose() まで保持する
	return {
		image: img,
		width,
		height,
		dispose: () => URL.revokeObjectURL(url),
	};
}

function createSquareCanvas(size: number): {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
} {
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('Canvas 2D コンテキストの取得に失敗しました');
	}
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	return { canvas, ctx };
}

/** ソースを正方形キャンバスへ fit/background を適用して描画する */
function drawSquare(
	source: RasterSource,
	size: number,
	options: RasterizeOptions,
): HTMLCanvasElement {
	const { canvas, ctx } = createSquareCanvas(size);

	if (options.background !== 'transparent') {
		ctx.fillStyle = options.background;
		ctx.fillRect(0, 0, size, size);
	}

	const sw = source.width;
	const sh = source.height;
	if (sw <= 0 || sh <= 0) {
		ctx.drawImage(source.image, 0, 0, size, size);
		return canvas;
	}

	// cover=外接（はみ出しはキャンバス境界でクロップ）/ contain=内接（余白は背景）
	const scale =
		options.fit === 'cover'
			? Math.max(size / sw, size / sh)
			: Math.min(size / sw, size / sh);
	const dw = sw * scale;
	const dh = sh * scale;
	const dx = (size - dw) / 2;
	const dy = (size - dh) / 2;
	ctx.drawImage(source.image, dx, dy, dw, dh);
	return canvas;
}

/** マスター（512）を高品質で size へ縮小する */
function downscale(master: HTMLCanvasElement, size: number): HTMLCanvasElement {
	const { canvas, ctx } = createSquareCanvas(size);
	ctx.drawImage(master, 0, 0, size, size);
	return canvas;
}

function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error('画像の書き出しに失敗しました'));
		}, 'image/png');
	});
}

async function toPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
	const blob = await toPngBlob(canvas);
	return new Uint8Array(await blob.arrayBuffer());
}

/** 指定サイズの正方形 PNG Blob を生成する */
export async function rasterize(
	source: RasterSource,
	size: number,
	options: RasterizeOptions,
): Promise<Blob> {
	return toPngBlob(drawSquare(source, size, options));
}

async function pngSetFromMaster(
	master: HTMLCanvasElement,
): Promise<Record<FaviconAsset, Blob>> {
	const entries = await Promise.all(
		FAVICON_ASSETS.map(async (asset) => {
			const size = ASSET_SIZES[asset];
			const canvas = size === MASTER_SIZE ? master : downscale(master, size);
			return [asset, await toPngBlob(canvas)] as const;
		}),
	);
	return Object.fromEntries(entries) as Record<FaviconAsset, Blob>;
}

/** 16/32/180/192/512 の PNG セットを生成する */
export async function generatePngSet(
	source: RasterSource,
	options: RasterizeOptions,
): Promise<Record<FaviconAsset, Blob>> {
	return pngSetFromMaster(drawSquare(source, MASTER_SIZE, options));
}

/**
 * フルセット（PNG群 + favicon.ico + site.webmanifest）を一括生成する。
 * マスター512を1度だけ描画し、全サイズをそこから縮小する（Preview=Export を担保）。
 */
export async function generateFavicons(
	source: RasterSource,
	options: FaviconOptions,
): Promise<GeneratedFavicons> {
	const master = drawSquare(source, MASTER_SIZE, options);
	const pngs = await pngSetFromMaster(master);
	// ICO_SIZES（16/32/48）はすべて MASTER_SIZE 未満なのでマスターから縮小する
	const icoPngs = await Promise.all(
		ICO_SIZES.map(async (size) => ({
			size,
			bytes: await toPngBytes(downscale(master, size)),
		})),
	);
	const ico = new Blob([encodeIco(icoPngs)], { type: 'image/x-icon' });
	const webmanifest = buildWebmanifest({
		appName: options.appName,
		themeColor: options.themeColor,
		backgroundColor: options.backgroundColor,
	});
	return { pngs, ico, webmanifest };
}
