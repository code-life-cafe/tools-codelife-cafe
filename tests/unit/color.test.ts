// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/color.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	cmykToRgb,
	formatCmyk,
	formatHex,
	formatHsl,
	formatRgb,
	hexToRgb,
	hslToRgb,
	parseColor,
	rgbToCmyk,
	rgbToHex,
	rgbToHsl,
} from '../../src/lib/tools/color.ts';

// ---------------------------------------------------------------------------
// hexToRgb / rgbToHex
// ---------------------------------------------------------------------------

test('hexToRgb: 6桁HEX（#有無どちらも可）', () => {
	assert.deepEqual(hexToRgb('#1E90FF'), { r: 30, g: 144, b: 255 });
	assert.deepEqual(hexToRgb('1E90FF'), { r: 30, g: 144, b: 255 });
	assert.deepEqual(hexToRgb('#1e90ff'), { r: 30, g: 144, b: 255 });
});

test('hexToRgb: 3桁HEXは各桁を複製して展開', () => {
	assert.deepEqual(hexToRgb('#0f8'), { r: 0, g: 255, b: 136 });
	assert.deepEqual(hexToRgb('fff'), { r: 255, g: 255, b: 255 });
});

test('hexToRgb: 4桁HEXはalphaを含む', () => {
	const result = hexToRgb('#0f8c');
	assert.equal(result?.r, 0);
	assert.equal(result?.g, 255);
	assert.equal(result?.b, 136);
	assert.equal(result?.alpha, roundTo(0xcc / 255, 3));
});

test('hexToRgb: 8桁HEXはalphaを含む', () => {
	const result = hexToRgb('#1E90FF80');
	assert.equal(result?.r, 30);
	assert.equal(result?.g, 144);
	assert.equal(result?.b, 255);
	assert.equal(result?.alpha, roundTo(0x80 / 255, 3));
});

test('hexToRgb: 不正な桁数・文字はnull', () => {
	assert.equal(hexToRgb('#GGG'), null);
	assert.equal(hexToRgb('#12345'), null);
	assert.equal(hexToRgb(''), null);
	assert.equal(hexToRgb('#zzzzzz'), null);
});

test('rgbToHex: 基本変換と8桁出力（alpha < 1）', () => {
	assert.equal(rgbToHex({ r: 30, g: 144, b: 255 }), '#1e90ff');
	assert.equal(rgbToHex({ r: 0, g: 0, b: 0 }), '#000000');
	assert.equal(rgbToHex({ r: 255, g: 255, b: 255 }), '#ffffff');
	// alpha=1 は6桁のまま
	assert.equal(rgbToHex({ r: 1, g: 2, b: 3, alpha: 1 }), '#010203');
	// alpha<1 は8桁
	const withAlpha = rgbToHex({ r: 30, g: 144, b: 255, alpha: 0.5 });
	assert.match(withAlpha, /^#1e90ff[0-9a-f]{2}$/);
});

// ---------------------------------------------------------------------------
// rgbToHsl / hslToRgb ラウンドトリップ
// ---------------------------------------------------------------------------

function roundTo(value: number, digits: number): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function assertChannelClose(actual: number, expected: number, tolerance = 1) {
	assert.ok(
		Math.abs(actual - expected) <= tolerance,
		`expected ${actual} to be within ${tolerance} of ${expected}`,
	);
}

test('rgbToHsl: 境界色（黒・白・グレー）', () => {
	assert.deepEqual(rgbToHsl({ r: 0, g: 0, b: 0 }), { h: 0, s: 0, l: 0 });
	assert.deepEqual(rgbToHsl({ r: 255, g: 255, b: 255 }), {
		h: 0,
		s: 0,
		l: 100,
	});
	const gray = rgbToHsl({ r: 128, g: 128, b: 128 });
	assert.equal(gray.h, 0);
	assert.equal(gray.s, 0);
	assertChannelClose(gray.l, 50.2, 1);
});

test('rgbToHsl: 原色（赤・緑・青）', () => {
	assert.deepEqual(rgbToHsl({ r: 255, g: 0, b: 0 }), { h: 0, s: 100, l: 50 });
	assert.deepEqual(rgbToHsl({ r: 0, g: 255, b: 0 }), {
		h: 120,
		s: 100,
		l: 50,
	});
	assert.deepEqual(rgbToHsl({ r: 0, g: 0, b: 255 }), {
		h: 240,
		s: 100,
		l: 50,
	});
});

test('hslToRgb: 原色の逆変換', () => {
	assert.deepEqual(hslToRgb({ h: 0, s: 100, l: 50 }), { r: 255, g: 0, b: 0 });
	assert.deepEqual(hslToRgb({ h: 120, s: 100, l: 50 }), {
		r: 0,
		g: 255,
		b: 0,
	});
	assert.deepEqual(hslToRgb({ h: 240, s: 100, l: 50 }), {
		r: 0,
		g: 0,
		b: 255,
	});
});

test('ラウンドトリップ: HEX→RGB→HSL→RGB→HEX が誤差±1/チャンネルで一致', () => {
	const samples = [
		'#1e90ff',
		'#000000',
		'#ffffff',
		'#ff0000',
		'#00ff00',
		'#0000ff',
		'#808080',
		'#abcdef',
		'#123456',
	];
	for (const hex of samples) {
		const rgb1 = hexToRgb(hex);
		assert.ok(rgb1, `hexToRgb failed for ${hex}`);
		const hsl = rgbToHsl(rgb1);
		const rgb2 = hslToRgb(hsl);
		assertChannelClose(rgb2.r, rgb1.r);
		assertChannelClose(rgb2.g, rgb1.g);
		assertChannelClose(rgb2.b, rgb1.b);
		const hexBack = rgbToHex(rgb2);
		// 誤差±1により完全一致しない場合があるため、再パースしてチャンネル差を確認
		const rgb3 = hexToRgb(hexBack);
		assert.ok(rgb3);
		assertChannelClose(rgb3.r, rgb1.r);
		assertChannelClose(rgb3.g, rgb1.g);
		assertChannelClose(rgb3.b, rgb1.b);
	}
});

// ---------------------------------------------------------------------------
// rgbToCmyk / cmykToRgb
// ---------------------------------------------------------------------------

test('rgbToCmyk: 境界色', () => {
	assert.deepEqual(rgbToCmyk({ r: 0, g: 0, b: 0 }), {
		c: 0,
		m: 0,
		y: 0,
		k: 100,
	});
	assert.deepEqual(rgbToCmyk({ r: 255, g: 255, b: 255 }), {
		c: 0,
		m: 0,
		y: 0,
		k: 0,
	});
	assert.deepEqual(rgbToCmyk({ r: 255, g: 0, b: 0 }), {
		c: 0,
		m: 100,
		y: 100,
		k: 0,
	});
});

test('cmykToRgb: 境界色の逆変換', () => {
	assert.deepEqual(cmykToRgb({ c: 0, m: 0, y: 0, k: 100 }), {
		r: 0,
		g: 0,
		b: 0,
	});
	assert.deepEqual(cmykToRgb({ c: 0, m: 0, y: 0, k: 0 }), {
		r: 255,
		g: 255,
		b: 255,
	});
	assert.deepEqual(cmykToRgb({ c: 0, m: 100, y: 100, k: 0 }), {
		r: 255,
		g: 0,
		b: 0,
	});
});

test('CMYKラウンドトリップ: RGB→CMYK→RGB が誤差±1/チャンネルで一致', () => {
	const samples = [
		{ r: 30, g: 144, b: 255 },
		{ r: 128, g: 128, b: 128 },
		{ r: 12, g: 200, b: 50 },
	];
	for (const rgb of samples) {
		const cmyk = rgbToCmyk(rgb);
		const back = cmykToRgb(cmyk);
		assertChannelClose(back.r, rgb.r);
		assertChannelClose(back.g, rgb.g);
		assertChannelClose(back.b, rgb.b);
	}
});

// ---------------------------------------------------------------------------
// formatHex / formatRgb / formatHsl / formatCmyk
// ---------------------------------------------------------------------------

test('formatHex / formatRgb / formatHsl / formatCmyk: CSSでそのまま使える文字列', () => {
	const rgb = { r: 30, g: 144, b: 255 };
	assert.equal(formatHex(rgb), '#1e90ff');
	assert.equal(formatRgb(rgb), 'rgb(30, 144, 255)');
	assert.equal(formatHsl(rgbToHsl(rgb)), 'hsl(209.6, 100%, 55.9%)');
	assert.match(formatCmyk(rgbToCmyk(rgb)), /^cmyk\(/);
});

test('formatRgb / formatHsl: alpha < 1 でrgba()/hsla()になる', () => {
	assert.equal(
		formatRgb({ r: 30, g: 144, b: 255, alpha: 0.5 }),
		'rgba(30, 144, 255, 0.5)',
	);
	assert.equal(
		formatHsl({ h: 208.2, s: 100, l: 55.9, alpha: 0.5 }),
		'hsla(208.2, 100%, 55.9%, 0.5)',
	);
});

test('formatRgb / formatHsl: alpha = 1 はrgb()/hsl()のまま', () => {
	assert.equal(
		formatRgb({ r: 30, g: 144, b: 255, alpha: 1 }),
		'rgb(30, 144, 255)',
	);
	assert.equal(formatHsl({ h: 0, s: 0, l: 0, alpha: 1 }), 'hsl(0, 0%, 0%)');
});

// ---------------------------------------------------------------------------
// parseColor: 自動判定
// ---------------------------------------------------------------------------

test('parseColor: HEX（6桁、#有無どちらも可）', () => {
	assert.deepEqual(parseColor('#1E90FF'), {
		format: 'hex',
		rgb: { r: 30, g: 144, b: 255 },
	});
	assert.deepEqual(parseColor('1e90ff'), {
		format: 'hex',
		rgb: { r: 30, g: 144, b: 255 },
	});
});

test('parseColor: HEX（3桁・4桁・8桁）', () => {
	assert.deepEqual(parseColor('#fff'), {
		format: 'hex',
		rgb: { r: 255, g: 255, b: 255 },
	});
	const four = parseColor('#0f8c');
	assert.equal(four?.format, 'hex');
	assert.equal(four?.rgb.r, 0);
	assert.equal(four?.rgb.g, 255);
	assert.equal(four?.rgb.b, 136);
	assert.ok(four?.rgb.alpha !== undefined);

	const eight = parseColor('#1E90FF80');
	assert.equal(eight?.format, 'hex');
	assert.equal(eight?.rgb.r, 30);
	assert.equal(eight?.rgb.g, 144);
	assert.equal(eight?.rgb.b, 255);
	assert.ok(eight?.rgb.alpha !== undefined);
});

test('parseColor: rgb() / rgba()', () => {
	assert.deepEqual(parseColor('rgb(30, 144, 255)'), {
		format: 'rgb',
		rgb: { r: 30, g: 144, b: 255 },
	});
	assert.deepEqual(parseColor('rgba(30, 144, 255, 0.5)'), {
		format: 'rgb',
		rgb: { r: 30, g: 144, b: 255, alpha: 0.5 },
	});
});

test('parseColor: hsl() / hsla()', () => {
	const hsl = parseColor('hsl(208, 100%, 56%)');
	assert.equal(hsl?.format, 'hsl');
	assertChannelClose(hsl?.rgb.r ?? -999, 31, 2);

	const hsla = parseColor('hsla(208, 100%, 56%, 0.5)');
	assert.equal(hsla?.format, 'hsl');
	assert.equal(hsla?.rgb.alpha, 0.5);
});

test('parseColor: cmyk()', () => {
	const cmyk = parseColor('cmyk(0%, 43%, 0%, 0%)');
	assert.equal(cmyk?.format, 'cmyk');
	assert.equal(cmyk?.rgb.r, 255);
	assertChannelClose(cmyk?.rgb.g ?? -999, 145, 2);
	assert.equal(cmyk?.rgb.b, 255);
});

test('parseColor: 空白・大文字小文字・全角文字を正規化して許容', () => {
	assert.deepEqual(parseColor('  #1E90FF  '), {
		format: 'hex',
		rgb: { r: 30, g: 144, b: 255 },
	});
	assert.deepEqual(parseColor('rgb( 30 , 144 , 255 )'), {
		format: 'rgb',
		rgb: { r: 30, g: 144, b: 255 },
	});
	// 全角＃と全角数字
	assert.deepEqual(parseColor('＃１Ｅ９０ＦＦ'.toLowerCase()), {
		format: 'hex',
		rgb: { r: 30, g: 144, b: 255 },
	});
});

test('parseColor: 不正入力はnull', () => {
	assert.equal(parseColor('#GGG'), null);
	assert.equal(parseColor('rgb(300, 0, 0)'), null);
	assert.equal(parseColor(''), null);
	assert.equal(parseColor('   '), null);
	assert.equal(parseColor('not-a-color'), null);
	assert.equal(parseColor('#12345'), null);
	assert.equal(parseColor('hsl(0, 150%, 50%)'), null);
	assert.equal(parseColor('cmyk(0%, 0%, 0%, 150%)'), null);
});

test('parseColor: 不正な小数トークン（1..2 / 1.2.3 等）はnull', () => {
	assert.equal(parseColor('rgb(1..2, 0, 0)'), null);
	assert.equal(parseColor('rgb(1.2.3, 0, 0)'), null);
	assert.equal(parseColor('rgb(., 0, 0)'), null);
	assert.equal(parseColor('hsl(1.2.3, 50%, 50%)'), null);
	assert.equal(parseColor('hsl(120, 5..0%, 50%)'), null);
	assert.equal(parseColor('cmyk(0..1%, 0%, 0%, 0%)'), null);
	// 正常な小数は引き続き受理される
	assert.notEqual(parseColor('rgb(1.5, 0, 0)'), null);
	assert.notEqual(parseColor('rgb(.5, 0, 0)'), null);
	assert.notEqual(parseColor('hsl(120.5, 50%, 50%)'), null);
});
