// カラーコード変換ロジック（純粋関数・ゼロ依存）
//
// 対応形式: HEX（3/4/6/8桁、#有無どちらも可）/ rgb() / rgba() / hsl() / hsla() / cmyk()
// CMYKはICCプロファイルを使用しない単純変換（naive conversion）であり、
// 印刷用途の正確な色再現を保証するものではない。

export type Rgb = { r: number; g: number; b: number; alpha?: number }; // 0-255, alpha 0-1
export type Hsl = { h: number; s: number; l: number; alpha?: number }; // h 0-360, s/l 0-100
export type Cmyk = { c: number; m: number; y: number; k: number }; // 0-100
export type ParsedColor = { format: 'hex' | 'rgb' | 'hsl' | 'cmyk'; rgb: Rgb };

// ---------------------------------------------------------------------------
// 入力正規化
// ---------------------------------------------------------------------------

/** 全角文字を半角に変換し、前後の空白を除去する */
function normalizeInput(input: string): string {
	return input
		.trim()
		.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)) // 全角英数記号 → 半角
		.replace(/　/g, ' ') // 全角スペース → 半角スペース
		.replace(/＃/g, '#'); // 念のため（上の範囲で変換されない場合）
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, digits: number): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// HEX <-> RGB
// ---------------------------------------------------------------------------

/** RGB（+alpha）をHEX文字列（小文字、#始まり）に変換する。alphaがある場合は8桁HEXを返す */
export function rgbToHex(rgb: Rgb): string {
	const r = Math.round(clamp(rgb.r, 0, 255));
	const g = Math.round(clamp(rgb.g, 0, 255));
	const b = Math.round(clamp(rgb.b, 0, 255));
	const toHex = (n: number) => n.toString(16).padStart(2, '0');
	let hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
	if (rgb.alpha !== undefined && rgb.alpha < 1) {
		const a = Math.round(clamp(rgb.alpha, 0, 1) * 255);
		hex += toHex(a);
	}
	return hex;
}

/**
 * HEX文字列（#有無どちらも可、3/4/6/8桁）をRGBに変換する。
 * 不正な形式（桁数不正・16進数以外の文字）は null を返す。
 */
export function hexToRgb(hex: string): Rgb | null {
	const normalized = hex.trim().replace(/^#/, '');
	if (!/^[0-9a-fA-F]+$/.test(normalized)) return null;

	const expand = (ch: string) => ch + ch;

	switch (normalized.length) {
		case 3: {
			const [r, g, b] = normalized.split('');
			return {
				r: Number.parseInt(expand(r), 16),
				g: Number.parseInt(expand(g), 16),
				b: Number.parseInt(expand(b), 16),
			};
		}
		case 4: {
			const [r, g, b, a] = normalized.split('');
			return {
				r: Number.parseInt(expand(r), 16),
				g: Number.parseInt(expand(g), 16),
				b: Number.parseInt(expand(b), 16),
				alpha: roundTo(Number.parseInt(expand(a), 16) / 255, 3),
			};
		}
		case 6: {
			return {
				r: Number.parseInt(normalized.slice(0, 2), 16),
				g: Number.parseInt(normalized.slice(2, 4), 16),
				b: Number.parseInt(normalized.slice(4, 6), 16),
			};
		}
		case 8: {
			return {
				r: Number.parseInt(normalized.slice(0, 2), 16),
				g: Number.parseInt(normalized.slice(2, 4), 16),
				b: Number.parseInt(normalized.slice(4, 6), 16),
				alpha: roundTo(Number.parseInt(normalized.slice(6, 8), 16) / 255, 3),
			};
		}
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// RGB <-> HSL
// ---------------------------------------------------------------------------

/** RGB（0-255）をHSL（h:0-360, s/l:0-100）に変換する。alphaは保持される */
export function rgbToHsl(rgb: Rgb): Hsl {
	const r = clamp(rgb.r, 0, 255) / 255;
	const g = clamp(rgb.g, 0, 255) / 255;
	const b = clamp(rgb.b, 0, 255) / 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;

	let h = 0;
	if (delta !== 0) {
		switch (max) {
			case r:
				h = ((g - b) / delta) % 6;
				break;
			case g:
				h = (b - r) / delta + 2;
				break;
			default:
				h = (r - g) / delta + 4;
				break;
		}
		h *= 60;
		if (h < 0) h += 360;
	}

	const l = (max + min) / 2;
	const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

	const result: Hsl = {
		h: roundTo(h, 1),
		s: roundTo(s * 100, 1),
		l: roundTo(l * 100, 1),
	};
	if (rgb.alpha !== undefined) result.alpha = rgb.alpha;
	return result;
}

/** HSL（h:0-360, s/l:0-100）をRGB（0-255）に変換する。alphaは保持される */
export function hslToRgb(hsl: Hsl): Rgb {
	const h = ((hsl.h % 360) + 360) % 360;
	const s = clamp(hsl.s, 0, 100) / 100;
	const l = clamp(hsl.l, 0, 100) / 100;

	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;

	let r1 = 0;
	let g1 = 0;
	let b1 = 0;
	if (h < 60) {
		[r1, g1, b1] = [c, x, 0];
	} else if (h < 120) {
		[r1, g1, b1] = [x, c, 0];
	} else if (h < 180) {
		[r1, g1, b1] = [0, c, x];
	} else if (h < 240) {
		[r1, g1, b1] = [0, x, c];
	} else if (h < 300) {
		[r1, g1, b1] = [x, 0, c];
	} else {
		[r1, g1, b1] = [c, 0, x];
	}

	const result: Rgb = {
		r: Math.round((r1 + m) * 255),
		g: Math.round((g1 + m) * 255),
		b: Math.round((b1 + m) * 255),
	};
	if (hsl.alpha !== undefined) result.alpha = hsl.alpha;
	return result;
}

// ---------------------------------------------------------------------------
// RGB <-> CMYK（簡易変換、ICCプロファイル非対応）
// ---------------------------------------------------------------------------

/**
 * RGB（0-255）をCMYK（0-100）に変換する。
 * ICCプロファイルを使用しない単純な減法混色変換（naive conversion）であり、
 * 印刷機・インクの特性は考慮していない。alphaは無視する。
 */
export function rgbToCmyk(rgb: Rgb): Cmyk {
	const r = clamp(rgb.r, 0, 255) / 255;
	const g = clamp(rgb.g, 0, 255) / 255;
	const b = clamp(rgb.b, 0, 255) / 255;

	const k = 1 - Math.max(r, g, b);
	if (k === 1) {
		return { c: 0, m: 0, y: 0, k: 100 };
	}
	const c = (1 - r - k) / (1 - k);
	const m = (1 - g - k) / (1 - k);
	const y = (1 - b - k) / (1 - k);

	return {
		c: roundTo(c * 100, 1),
		m: roundTo(m * 100, 1),
		y: roundTo(y * 100, 1),
		k: roundTo(k * 100, 1),
	};
}

/**
 * CMYK（0-100）をRGB（0-255）に変換する。
 * ICCプロファイルを使用しない単純な加法変換（naive conversion）。
 */
export function cmykToRgb(cmyk: Cmyk): Rgb {
	const c = clamp(cmyk.c, 0, 100) / 100;
	const m = clamp(cmyk.m, 0, 100) / 100;
	const y = clamp(cmyk.y, 0, 100) / 100;
	const k = clamp(cmyk.k, 0, 100) / 100;

	return {
		r: Math.round(255 * (1 - c) * (1 - k)),
		g: Math.round(255 * (1 - m) * (1 - k)),
		b: Math.round(255 * (1 - y) * (1 - k)),
	};
}

// ---------------------------------------------------------------------------
// 整形（CSSでそのまま使える文字列）
// ---------------------------------------------------------------------------

/** RGB（+alpha）をHEX文字列（小文字）にフォーマットする */
export function formatHex(rgb: Rgb): string {
	return rgbToHex(rgb);
}

/** RGB（+alpha）を rgb()/rgba() 文字列にフォーマットする */
export function formatRgb(rgb: Rgb): string {
	const r = Math.round(clamp(rgb.r, 0, 255));
	const g = Math.round(clamp(rgb.g, 0, 255));
	const b = Math.round(clamp(rgb.b, 0, 255));
	if (rgb.alpha !== undefined && rgb.alpha < 1) {
		return `rgba(${r}, ${g}, ${b}, ${roundTo(clamp(rgb.alpha, 0, 1), 3)})`;
	}
	return `rgb(${r}, ${g}, ${b})`;
}

/** HSL（+alpha）を hsl()/hsla() 文字列にフォーマットする */
export function formatHsl(hsl: Hsl): string {
	const h = roundTo(((hsl.h % 360) + 360) % 360, 1);
	const s = roundTo(clamp(hsl.s, 0, 100), 1);
	const l = roundTo(clamp(hsl.l, 0, 100), 1);
	if (hsl.alpha !== undefined && hsl.alpha < 1) {
		return `hsla(${h}, ${s}%, ${l}%, ${roundTo(clamp(hsl.alpha, 0, 1), 3)})`;
	}
	return `hsl(${h}, ${s}%, ${l}%)`;
}

/** CMYKを cmyk() 文字列にフォーマットする（CSS標準ではないが表示用） */
export function formatCmyk(cmyk: Cmyk): string {
	const c = roundTo(clamp(cmyk.c, 0, 100), 1);
	const m = roundTo(clamp(cmyk.m, 0, 100), 1);
	const y = roundTo(clamp(cmyk.y, 0, 100), 1);
	const k = roundTo(clamp(cmyk.k, 0, 100), 1);
	return `cmyk(${c}%, ${m}%, ${y}%, ${k}%)`;
}

// ---------------------------------------------------------------------------
// パース（自動判定）
// ---------------------------------------------------------------------------

// 厳密な数値トークン（123 / 1.5 / .5）。"1..2" や "1.2.3" のような不正値を弾く
const NUM = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const RGB_PATTERN = new RegExp(
	String.raw`^rgba?\(\s*(${NUM}%?)\s*,\s*(${NUM}%?)\s*,\s*(${NUM}%?)\s*(?:,\s*(${NUM}%?)\s*)?\)$`,
	'i',
);
const HSL_PATTERN = new RegExp(
	String.raw`^hsla?\(\s*(${NUM})(?:deg)?\s*,\s*(${NUM})%\s*,\s*(${NUM})%\s*(?:,\s*(${NUM}%?)\s*)?\)$`,
	'i',
);
const CMYK_PATTERN = new RegExp(
	String.raw`^cmyk\(\s*(${NUM})%?\s*,\s*(${NUM})%?\s*,\s*(${NUM})%?\s*,\s*(${NUM})%?\s*\)$`,
	'i',
);

function parseHexInput(input: string): ParsedColor | null {
	if (!/^#?[0-9a-fA-F]+$/.test(input)) return null;
	const rgb = hexToRgb(input);
	if (!rgb) return null;
	return { format: 'hex', rgb };
}

function parseRgbInput(input: string): ParsedColor | null {
	const match = input.match(RGB_PATTERN);
	if (!match) return null;

	const parseChannel = (value: string): number | null => {
		if (value.endsWith('%')) {
			const pct = Number.parseFloat(value.slice(0, -1));
			if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
			return roundTo((pct / 100) * 255, 3);
		}
		const num = Number.parseFloat(value);
		if (!Number.isFinite(num) || num < 0 || num > 255) return null;
		return num;
	};

	const r = parseChannel(match[1]);
	const g = parseChannel(match[2]);
	const b = parseChannel(match[3]);
	if (r === null || g === null || b === null) return null;

	let alpha: number | undefined;
	if (match[4] !== undefined) {
		if (match[4].endsWith('%')) {
			const pct = Number.parseFloat(match[4].slice(0, -1));
			if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
			alpha = roundTo(pct / 100, 3);
		} else {
			const a = Number.parseFloat(match[4]);
			if (!Number.isFinite(a) || a < 0 || a > 1) return null;
			alpha = roundTo(a, 3);
		}
	}

	const rgb: Rgb = { r: roundTo(r, 0), g: roundTo(g, 0), b: roundTo(b, 0) };
	if (alpha !== undefined) rgb.alpha = alpha;
	return { format: 'rgb', rgb };
}

function parseHslInput(input: string): ParsedColor | null {
	const match = input.match(HSL_PATTERN);
	if (!match) return null;

	const h = Number.parseFloat(match[1]);
	const s = Number.parseFloat(match[2]);
	const l = Number.parseFloat(match[3]);
	if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
		return null;
	}
	if (s < 0 || s > 100 || l < 0 || l > 100) return null;

	let alpha: number | undefined;
	if (match[4] !== undefined) {
		if (match[4].endsWith('%')) {
			const pct = Number.parseFloat(match[4].slice(0, -1));
			if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
			alpha = roundTo(pct / 100, 3);
		} else {
			const a = Number.parseFloat(match[4]);
			if (!Number.isFinite(a) || a < 0 || a > 1) return null;
			alpha = roundTo(a, 3);
		}
	}

	const hsl: Hsl = { h, s, l };
	if (alpha !== undefined) hsl.alpha = alpha;
	const rgb = hslToRgb(hsl);
	return { format: 'hsl', rgb };
}

function parseCmykInput(input: string): ParsedColor | null {
	const match = input.match(CMYK_PATTERN);
	if (!match) return null;

	const c = Number.parseFloat(match[1]);
	const m = Number.parseFloat(match[2]);
	const y = Number.parseFloat(match[3]);
	const k = Number.parseFloat(match[4]);
	if (![c, m, y, k].every((v) => Number.isFinite(v) && v >= 0 && v <= 100)) {
		return null;
	}

	return { format: 'cmyk', rgb: cmykToRgb({ c, m, y, k }) };
}

/**
 * 入力文字列を自動判定してパースする。
 * 対応形式: HEX（#有無、3/4/6/8桁）/ rgb() / rgba() / hsl() / hsla() / cmyk()
 * 全角文字・空白は正規化して許容する。判定不能・範囲外の値は null を返す。
 */
export function parseColor(input: string): ParsedColor | null {
	const normalized = normalizeInput(input);
	if (!normalized) return null;

	// 関数記法（rgb/rgba/hsl/hsla/cmyk）はスペースを除去して判定しやすくする
	const compact = normalized.replace(/\s+/g, '');

	if (/^rgba?\(/i.test(compact)) return parseRgbInput(compact);
	if (/^hsla?\(/i.test(compact)) return parseHslInput(compact);
	if (/^cmyk\(/i.test(compact)) return parseCmykInput(compact);

	// HEX（#有無、空白を含まない単一トークン）
	if (/^#?[0-9a-fA-F]+$/.test(compact)) return parseHexInput(compact);

	return null;
}
