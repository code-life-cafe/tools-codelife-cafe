// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/image-mosaic.test.ts
//
// Canvas 描画（applyMosaic/applyBlur/renderMasked 等、CanvasRenderingContext2D 依存）は
// ブラウザ専用のため E2E で検証する。ここでは座標計算・判定・ぼかしアルゴリズムなど
// DOM非依存の純粋ロジックを対象とする。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	BLUR_RADIUS,
	clampRect,
	DEFAULT_EMOJI_STAMP,
	defaultRegionInput,
	describeRegion,
	isMaskEffectMode,
	isMaskEffectRegion,
	type MaskRegion,
	MIN_REGION_SIZE,
	MOSAIC_BLOCK,
	parseRegionInput,
	stackBlur,
	supportsCanvasFilter,
} from '../../src/lib/tools/image-mosaic.ts';

// ============================================================
// 定数
// ============================================================

test('MOSAIC_BLOCK / BLUR_RADIUS: min <= default <= max', () => {
	assert.ok(MOSAIC_BLOCK.min <= MOSAIC_BLOCK.default);
	assert.ok(MOSAIC_BLOCK.default <= MOSAIC_BLOCK.max);
	assert.ok(BLUR_RADIUS.min <= BLUR_RADIUS.default);
	assert.ok(BLUR_RADIUS.default <= BLUR_RADIUS.max);
});

test('DEFAULT_EMOJI_STAMP: 空でない文字列', () => {
	assert.ok(DEFAULT_EMOJI_STAMP.length > 0);
});

// ============================================================
// isMaskEffectMode / isMaskEffectRegion
// ============================================================

test('isMaskEffectMode: mosaic/blur は true、emoji/image は false', () => {
	assert.equal(isMaskEffectMode('mosaic'), true);
	assert.equal(isMaskEffectMode('blur'), true);
	assert.equal(isMaskEffectMode('emoji'), false);
	assert.equal(isMaskEffectMode('image'), false);
});

test('isMaskEffectRegion: mode に応じて判定する', () => {
	const rect = { x: 0, y: 0, width: 10, height: 10 };
	const mosaicRegion: MaskRegion = {
		id: '1',
		rect,
		mode: 'mosaic',
		shape: 'rect',
		strength: 10,
	};
	const emojiRegion: MaskRegion = {
		id: '2',
		rect,
		mode: 'emoji',
		emoji: '🙈',
	};
	assert.equal(isMaskEffectRegion(mosaicRegion), true);
	assert.equal(isMaskEffectRegion(emojiRegion), false);
});

// ============================================================
// clampRect
// ============================================================

test('clampRect: 完全にキャンバス内の矩形はそのまま返る', () => {
	const result = clampRect({ x: 10, y: 10, width: 20, height: 20 }, 100, 100);
	assert.deepEqual(result, { x: 10, y: 10, width: 20, height: 20 });
});

test('clampRect: キャンバス境界からはみ出す矩形はクリップされる', () => {
	const result = clampRect({ x: 90, y: 90, width: 30, height: 30 }, 100, 100);
	assert.deepEqual(result, { x: 90, y: 90, width: 10, height: 10 });
});

test('clampRect: 負の座標は0にクランプされる', () => {
	const result = clampRect({ x: -10, y: -10, width: 20, height: 20 }, 100, 100);
	assert.deepEqual(result, { x: 0, y: 0, width: 10, height: 10 });
});

test('clampRect: キャンバスと交差しない矩形は null を返す', () => {
	const result = clampRect({ x: 200, y: 200, width: 10, height: 10 }, 100, 100);
	assert.equal(result, null);
});

test('clampRect: 小数座標は整数に丸められる', () => {
	const result = clampRect(
		{ x: 1.4, y: 1.6, width: 10.2, height: 10.8 },
		100,
		100,
	);
	assert.equal(result?.x, 1);
	assert.equal(result?.y, 1);
});

// ============================================================
// supportsCanvasFilter（document未定義のNode環境）
// ============================================================

test('supportsCanvasFilter: document未定義の環境では false を返す', () => {
	assert.equal(supportsCanvasFilter(), false);
});

// ============================================================
// stackBlur
// ============================================================

function makeImage(
	width: number,
	height: number,
	fill: [number, number, number, number],
) {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = fill[0];
		data[i + 1] = fill[1];
		data[i + 2] = fill[2];
		data[i + 3] = fill[3];
	}
	return { data, width, height };
}

test('stackBlur: 単色画像はぼかし後も同じ色を保つ', () => {
	const image = makeImage(10, 10, [100, 150, 200, 255]);
	// biome-ignore lint/suspicious/noExplicitAny: 純粋なdata/width/heightのみを使うためImageDataの完全な実装は不要
	stackBlur(image as any, 3);
	for (let i = 0; i < image.data.length; i += 4) {
		assert.equal(image.data[i], 100);
		assert.equal(image.data[i + 1], 150);
		assert.equal(image.data[i + 2], 200);
		assert.equal(image.data[i + 3], 255);
	}
});

test('stackBlur: 中央の孤立ピクセルが周囲へ拡散する（鋭いピークが弱まる）', () => {
	const width = 11;
	const height = 11;
	const image = makeImage(width, height, [0, 0, 0, 255]);
	const centerIndex = (5 * width + 5) * 4;
	image.data[centerIndex] = 255;
	// biome-ignore lint/suspicious/noExplicitAny: 純粋なdata/width/heightのみを使うためImageDataの完全な実装は不要
	stackBlur(image as any, 2);

	// ぼかし後、中心ピクセルの値は255未満に減衰する
	assert.ok(image.data[centerIndex] < 255);
	// 隣接ピクセルには値がにじみ出る
	const neighborIndex = (5 * width + 6) * 4;
	assert.ok(image.data[neighborIndex] > 0);
});

test('stackBlur: 端のピクセルもクランプされアクセスエラーにならない', () => {
	const image = makeImage(3, 3, [10, 20, 30, 255]);
	assert.doesNotThrow(() => {
		// biome-ignore lint/suspicious/noExplicitAny: 純粋なdata/width/heightのみを使うためImageDataの完全な実装は不要
		stackBlur(image as any, 5);
	});
});

// ============================================================
// キーボード範囲入力（#633）
// ============================================================

test('defaultRegionInput: 画像中央に縦横半分の範囲', () => {
	assert.deepEqual(defaultRegionInput(400, 300), {
		x: '100',
		y: '75',
		width: '200',
		height: '150',
	});
});

test('defaultRegionInput: 極小画像でも最小サイズを下回らない', () => {
	const input = defaultRegionInput(4, 2);
	assert.equal(Number(input.width), MIN_REGION_SIZE);
	assert.equal(Number(input.height), MIN_REGION_SIZE);
	assert.ok(Number(input.x) >= 0);
	assert.ok(Number(input.y) >= 0);
});

test('parseRegionInput: 画像内の値はそのまま返す', () => {
	assert.deepEqual(
		parseRegionInput(
			{ x: '80', y: '60', width: '100', height: '80' },
			400,
			300,
		),
		{ ok: true, rect: { x: 80, y: 60, width: 100, height: 80 } },
	);
});

test('parseRegionInput: 前後の空白を許容する', () => {
	const result = parseRegionInput(
		{ x: ' 0 ', y: '0', width: '3', height: '3 ' },
		400,
		300,
	);
	assert.deepEqual(result, {
		ok: true,
		rect: { x: 0, y: 0, width: 3, height: 3 },
	});
});

test('parseRegionInput: はみ出す範囲は画像内にクリップする', () => {
	assert.deepEqual(
		parseRegionInput(
			{ x: '350', y: '250', width: '100', height: '100' },
			400,
			300,
		),
		{ ok: true, rect: { x: 350, y: 250, width: 50, height: 50 } },
	);
});

test('parseRegionInput: 空欄・数値でない値は日本語エラー', () => {
	for (const bad of ['', 'abc', 'NaN', 'Infinity']) {
		const result = parseRegionInput(
			{ x: bad, y: '0', width: '10', height: '10' },
			400,
			300,
		);
		assert.equal(result.ok, false, bad);
		if (!result.ok) assert.match(result.message, /X（左端）には数値/);
	}
});

test('parseRegionInput: 負の値は日本語エラー', () => {
	const result = parseRegionInput(
		{ x: '0', y: '-1', width: '10', height: '10' },
		400,
		300,
	);
	assert.equal(result.ok, false);
	if (!result.ok) assert.match(result.message, /Y（上端）には0以上/);
});

test('parseRegionInput: 最小サイズ未満は拒否し、ちょうど最小サイズは受け付ける', () => {
	const small = parseRegionInput(
		{ x: '0', y: '0', width: String(MIN_REGION_SIZE - 1), height: '10' },
		400,
		300,
	);
	assert.equal(small.ok, false);
	if (!small.ok) assert.match(small.message, /3px以上/);
	const zero = parseRegionInput(
		{ x: '0', y: '0', width: '10', height: '0' },
		400,
		300,
	);
	assert.equal(zero.ok, false);
	const exact = parseRegionInput(
		{
			x: '0',
			y: '0',
			width: String(MIN_REGION_SIZE),
			height: String(MIN_REGION_SIZE),
		},
		400,
		300,
	);
	assert.equal(exact.ok, true);
});

test('parseRegionInput: 画像外の範囲は日本語エラー', () => {
	const result = parseRegionInput(
		{ x: '400', y: '0', width: '10', height: '10' },
		400,
		300,
	);
	assert.equal(result.ok, false);
	if (!result.ok) assert.match(result.message, /画像（400×300px）の外/);
});

test('parseRegionInput: クリップ後に最小サイズ未満になる範囲は拒否する', () => {
	const result = parseRegionInput(
		{ x: '398', y: '0', width: '10', height: '10' },
		400,
		300,
	);
	assert.equal(result.ok, false);
	if (!result.ok) assert.match(result.message, /画像内で幅・高さとも3px以上/);
});

test('describeRegion: 種類・形状・位置・サイズを日本語で表す', () => {
	const mosaic: MaskRegion = {
		id: 'a',
		rect: { x: 100, y: 75.4, width: 200, height: 150 },
		mode: 'mosaic',
		shape: 'rect',
		strength: 12,
	};
	assert.equal(
		describeRegion(mosaic, 0),
		'範囲1: モザイク・四角形（X 100, Y 75, 200×150px）',
	);
	const blur: MaskRegion = { ...mosaic, mode: 'blur', shape: 'ellipse' };
	assert.equal(
		describeRegion(blur, 1),
		'範囲2: ぼかし・円形（X 100, Y 75, 200×150px）',
	);
	const emoji: MaskRegion = {
		id: 'b',
		rect: { x: 0, y: 0, width: 10, height: 10 },
		mode: 'emoji',
		emoji: '🙈',
	};
	assert.equal(describeRegion(emoji, 2), '範囲3: 絵文字（X 0, Y 0, 10×10px）');
});
