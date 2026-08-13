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
	isMaskEffectMode,
	isMaskEffectRegion,
	type MaskRegion,
	MOSAIC_BLOCK,
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
