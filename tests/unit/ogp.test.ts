// 実行方法: node --test tests/unit/ogp.test.ts
//
// Canvas 依存の renderOgp は Node では実行できないため、
// ここでは DOM 非依存の純関数（wrapText / fitFontSize）のみを検証する。
// 描画系は tests/e2e/ogp.spec.ts で実ブラウザ検証する。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	FONT_FAMILIES,
	fitFontSize,
	LINE_HEIGHT,
	OGP_HEIGHT,
	OGP_WIDTH,
	PADDING,
	TEMPLATES,
	wrapText,
} from '../../src/lib/tools/ogp.ts';

// ---------------------------------------------------------------------------
// Mock measureFn: 1文字 = fontSize × 0.6 幅
// ---------------------------------------------------------------------------
const mockMeasureFn = (text: string, fontSize: number) =>
	Array.from(text).length * fontSize * 0.6;

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

test('OGP 画像サイズは 1200×630', () => {
	assert.equal(OGP_WIDTH, 1200);
	assert.equal(OGP_HEIGHT, 630);
});

test('TEMPLATES は 3 種類以上', () => {
	assert.ok(TEMPLATES.length >= 3);
	const values = TEMPLATES.map((t) => t.value);
	assert.ok(values.includes('simple'));
	assert.ok(values.includes('band'));
	assert.ok(values.includes('photo'));
});

test('FONT_FAMILIES は 3 種類', () => {
	assert.equal(FONT_FAMILIES.length, 3);
	const values = FONT_FAMILIES.map((f) => f.value);
	assert.ok(values.includes('sans-serif'));
	assert.ok(values.includes('serif'));
	assert.ok(values.includes('monospace'));
});

// ---------------------------------------------------------------------------
// wrapText
// ---------------------------------------------------------------------------

test('wrapText: 空文字列は空配列を返す', () => {
	assert.deepEqual(wrapText('', 100, 3, mockMeasureFn, 20), []);
});

test('wrapText: maxLines=0 は空配列を返す', () => {
	assert.deepEqual(wrapText('ABC', 100, 0, mockMeasureFn, 20), []);
});

test('wrapText: maxWidth=0 は空配列を返す', () => {
	assert.deepEqual(wrapText('ABC', 0, 3, mockMeasureFn, 20), []);
});

test('wrapText: 短いテキストは 1 行に収まる', () => {
	// 'ABC' = 3文字 × 20 × 0.6 = 36 ≤ 100
	assert.deepEqual(wrapText('ABC', 100, 3, mockMeasureFn, 20), ['ABC']);
});

test('wrapText: 文字境界で折り返す', () => {
	// 6文字 × 20 × 0.6 = 72 が maxWidth → ちょうど 6 文字で折り返し
	// 'ABCDEFGHIJ' → ['ABCDEF', 'GHIJ']
	const result = wrapText('ABCDEFGHIJ', 72, 3, mockMeasureFn, 20);
	assert.deepEqual(result, ['ABCDEF', 'GHIJ']);
});

test('wrapText: maxLines を超える分は省略記号', () => {
	// 15文字、6文字/行、maxLines=2
	// Line 1: 'ABCDEF', Line 2: 'GHIJKL' → 残り 'MNO' → 省略
	// 'GHIJK…' = 6文字 × 12 = 72 でちょうど収まる
	const result = wrapText('ABCDEFGHIJKLMNO', 72, 2, mockMeasureFn, 20);
	assert.equal(result.length, 2);
	assert.equal(result[0], 'ABCDEF');
	assert.ok(result[1].endsWith('…'), `"${result[1]}" should end with …`);
	assert.equal(result[1], 'GHIJK…');
});

test('wrapText: 改行で行を分割する', () => {
	assert.deepEqual(wrapText('A\nB', 100, 3, mockMeasureFn, 20), ['A', 'B']);
});

test('wrapText: 改行が maxLines を超える場合は省略', () => {
	const result = wrapText('A\nB\nC\nD', 100, 2, mockMeasureFn, 20);
	assert.equal(result.length, 2);
	assert.equal(result[0], 'A');
	assert.ok(result[1].endsWith('…'));
});

test('wrapText: サロゲートペア（絵文字）を正しく扱う', () => {
	// 🎉🎊🎋 = 3文字（Array.from で正しく分割）
	const result = wrapText('🎉🎊🎋', 100, 3, mockMeasureFn, 20);
	assert.equal(result.length, 1);
	assert.equal(result[0], '🎉🎊🎋');
});

test('wrapText: 絵文字を含むテキストの折り返し', () => {
	// 🎉 は 1 文字としてカウント
	// 6文字幅 = 72 で折り返し
	const result = wrapText('🎉BCDEFGHIJ', 72, 3, mockMeasureFn, 20);
	assert.deepEqual(result, ['🎉BCDEF', 'GHIJ']);
});

test('wrapText: 1 文字が maxWidth を超えても最低 1 文字は出力する', () => {
	// fontSize=20, 1文字幅=12 だが maxWidth=5 にすると 1 文字でも超える
	const result = wrapText('AB', 5, 3, mockMeasureFn, 20);
	// 'A' 単独でも 12 > 5 だが current === '' なので追加される
	// 次の 'B' で current='A' ≠ '' かつ 'AB'=24 > 5 → push 'A', current='B'
	assert.equal(result.length, 2);
	assert.equal(result[0], 'A');
	assert.equal(result[1], 'B');
});

test('wrapText: 全量が収まる場合は省略記号なし', () => {
	const result = wrapText('ABCDEF', 72, 1, mockMeasureFn, 20);
	assert.deepEqual(result, ['ABCDEF']);
	assert.ok(!result[0].includes('…'));
});

test('wrapText: 日本語テキストの折り返し', () => {
	const text = 'あいうえおかきくけこ';
	// 10文字 × 20 × 0.6 = 120、maxWidth=72 → 6文字/行
	const result = wrapText(text, 72, 3, mockMeasureFn, 20);
	assert.deepEqual(result, ['あいうえおか', 'きくけこ']);
});

// ---------------------------------------------------------------------------
// fitFontSize
// ---------------------------------------------------------------------------

test('fitFontSize: 結果は min–max の範囲内', () => {
	const size = fitFontSize('テスト', 500, 200, 3, mockMeasureFn, 16, 120);
	assert.ok(size >= 16, `${size} >= 16`);
	assert.ok(size <= 120, `${size} <= 120`);
});

test('fitFontSize: 長いテキストほどフォントサイズが小さくなる', () => {
	const short = fitFontSize('ABC', 300, 200, 3, mockMeasureFn, 16, 120);
	const long = fitFontSize(
		'あいうえおかきくけこさしすせそたちつてと',
		300,
		200,
		3,
		mockMeasureFn,
		16,
		120,
	);
	assert.ok(short >= long, `short(${short}) >= long(${long})`);
});

test('fitFontSize: 小さいボックスでは小さいサイズになる', () => {
	const large = fitFontSize('テスト', 500, 300, 3, mockMeasureFn, 16, 120);
	const small = fitFontSize('テスト', 200, 100, 3, mockMeasureFn, 16, 120);
	assert.ok(large >= small, `large(${large}) >= small(${small})`);
});

test('fitFontSize: 結果のフォントサイズでテキストがボックスに収まる', () => {
	const boxWidth = 400;
	const boxHeight = 150;
	const maxLines = 3;
	const text = 'ブラウザだけでOGP画像を作成';

	const fontSize = fitFontSize(
		text,
		boxWidth,
		boxHeight,
		maxLines,
		mockMeasureFn,
		16,
		120,
	);
	const lines = wrapText(text, boxWidth, maxLines, mockMeasureFn, fontSize);
	const totalHeight = lines.length * fontSize * LINE_HEIGHT;

	assert.ok(
		totalHeight <= boxHeight,
		`totalHeight(${totalHeight}) <= boxHeight(${boxHeight})`,
	);
});

test('fitFontSize: min === max のとき min を返す', () => {
	const size = fitFontSize('ABC', 500, 200, 3, mockMeasureFn, 48, 48);
	assert.equal(size, 48);
});

// ---------------------------------------------------------------------------
// LINE_HEIGHT / PADDING 定数の妥当性
// ---------------------------------------------------------------------------

test('LINE_HEIGHT は 1 より大きい', () => {
	assert.ok(LINE_HEIGHT > 1);
});

test('PADDING は正の値', () => {
	assert.ok(PADDING > 0);
});
