// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/image-text.test.ts
//
// Canvas 描画・計測（measureTextLayer/drawTextLayer/renderTextLayers、
// CanvasRenderingContext2D 依存）はブラウザ専用のため E2E で検証する。
// ここではレイヤー生成ロジックと定数を対象とする。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	BG_PADDING,
	createTextLayer,
	FONT_FAMILIES,
	FONT_SIZE,
	LINE_HEIGHT,
	OPACITY,
	STROKE_WIDTH,
} from '../../src/lib/tools/image-text.ts';

// ============================================================
// 定数
// ============================================================

test('FONT_SIZE / STROKE_WIDTH / OPACITY: min <= default <= max', () => {
	assert.ok(FONT_SIZE.min <= FONT_SIZE.default);
	assert.ok(FONT_SIZE.default <= FONT_SIZE.max);
	assert.ok(STROKE_WIDTH.min <= STROKE_WIDTH.default);
	assert.ok(STROKE_WIDTH.default <= STROKE_WIDTH.max);
	assert.ok(OPACITY.min <= OPACITY.default);
	assert.ok(OPACITY.default <= OPACITY.max);
});

test('LINE_HEIGHT / BG_PADDING: 正の数である', () => {
	assert.ok(LINE_HEIGHT > 0);
	assert.ok(BG_PADDING >= 0);
});

test('FONT_FAMILIES: 3種のフォントを持ち value が一意である', () => {
	assert.equal(FONT_FAMILIES.length, 3);
	const values = FONT_FAMILIES.map((f) => f.value);
	assert.deepEqual(new Set(values).size, values.length);
	for (const f of FONT_FAMILIES) {
		assert.ok(f.label.length > 0);
	}
});

// ============================================================
// createTextLayer
// ============================================================

test('createTextLayer: デフォルト値でレイヤーを生成する', () => {
	const layer = createTextLayer(10, 20);
	assert.equal(layer.x, 10);
	assert.equal(layer.y, 20);
	assert.equal(layer.text, 'テキスト');
	assert.equal(layer.fontSize, FONT_SIZE.default);
	assert.equal(layer.fontFamily, 'sans-serif');
	assert.equal(layer.color, '#ff0000');
	assert.equal(layer.strokeColor, undefined);
	assert.equal(layer.strokeWidth, STROKE_WIDTH.default);
	assert.equal(layer.backgroundColor, undefined);
	assert.equal(layer.opacity, OPACITY.default);
	assert.ok(layer.id.length > 0);
});

test('createTextLayer: overrides で値を上書きできる', () => {
	const layer = createTextLayer(0, 0, {
		text: 'カスタム',
		fontSize: 64,
		color: '#00ff00',
		strokeColor: '#000000',
		strokeWidth: 2,
		backgroundColor: '#ffffff',
		opacity: 0.5,
	});
	assert.equal(layer.text, 'カスタム');
	assert.equal(layer.fontSize, 64);
	assert.equal(layer.color, '#00ff00');
	assert.equal(layer.strokeColor, '#000000');
	assert.equal(layer.strokeWidth, 2);
	assert.equal(layer.backgroundColor, '#ffffff');
	assert.equal(layer.opacity, 0.5);
});

test('createTextLayer: 呼び出しごとに一意なidを生成する', () => {
	const a = createTextLayer(0, 0);
	const b = createTextLayer(0, 0);
	assert.notEqual(a.id, b.id);
});
