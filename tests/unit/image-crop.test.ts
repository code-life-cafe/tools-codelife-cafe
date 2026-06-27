// 実行方法: npm run test:unit
// Canvas 描画自体はブラウザ専用のため E2E で検証する。
// ここではトリミング範囲の補正と回転後サイズ計算を対象とする。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	clampCropOptions,
	createInitialCropOptions,
	getRotatedSize,
} from '../../src/lib/tools/image-crop.ts';

test('createInitialCropOptions: 画像全体を初期範囲にする', () => {
	assert.deepEqual(createInitialCropOptions({ width: 400, height: 300 }), {
		x: 0,
		y: 0,
		width: 400,
		height: 300,
		rotate: 0,
		flipHorizontal: false,
		flipVertical: false,
	});
});

test('clampCropOptions: 範囲外の座標とサイズを画像内へ補正する', () => {
	assert.deepEqual(
		clampCropOptions(
			{
				x: 390,
				y: -10,
				width: 80,
				height: 0,
				rotate: 90,
				flipHorizontal: true,
				flipVertical: false,
			},
			{ width: 400, height: 300 },
		),
		{
			x: 320,
			y: 0,
			width: 80,
			height: 1,
			rotate: 90,
			flipHorizontal: true,
			flipVertical: false,
		},
	);
});

test('getRotatedSize: 90度/270度では幅と高さを入れ替える', () => {
	assert.deepEqual(getRotatedSize({ width: 400, height: 300, rotate: 0 }), {
		width: 400,
		height: 300,
	});
	assert.deepEqual(getRotatedSize({ width: 400, height: 300, rotate: 90 }), {
		width: 300,
		height: 400,
	});
	assert.deepEqual(getRotatedSize({ width: 400, height: 300, rotate: 270 }), {
		width: 300,
		height: 400,
	});
});
