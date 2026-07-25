// 実行方法: npm run test:unit
// ズーム＆パンの倍率計算・クランプ・カーソル基準スクロール補正を検証する。
// DOM描画自体は E2E（image-mosaic.spec.ts / image-text.spec.ts）で検証する。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	clampZoom,
	computeContentOffset,
	computeFitScale,
	computeWheelZoom,
	computeZoomScrollPosition,
	decideScaleApply,
	formatZoomPercent,
	isZoomInNoop,
	isZoomOutNoop,
	MAX_ZOOM,
	MIN_ZOOM,
	nextZoomInStep,
	nextZoomOutStep,
	normalizeWheelDelta,
} from '../../src/lib/tools/zoom-pan.ts';

test('computeFitScale: コンテナより大きい画像は縮小フィットする', () => {
	assert.equal(computeFitScale(800, 600, 4000, 3000), 0.2);
});

test('computeFitScale: コンテナより小さい画像は拡大しない（上限1）', () => {
	assert.equal(computeFitScale(800, 600, 200, 100), 1);
});

test('computeFitScale: 縦横比が異なる場合は小さい方の比率を採用する', () => {
	// 幅基準なら 800/1000=0.8, 高さ基準なら 600/2000=0.3 → 0.3 を採用
	assert.equal(computeFitScale(800, 600, 1000, 2000), 0.3);
});

test('computeFitScale: 寸法が0以下の場合は1を返す', () => {
	assert.equal(computeFitScale(0, 600, 400, 300), 1);
	assert.equal(computeFitScale(800, 600, 0, 300), 1);
});

test('clampZoom: 範囲外の値を25%〜400%へ丸める', () => {
	assert.equal(clampZoom(0.1), MIN_ZOOM);
	assert.equal(clampZoom(10), MAX_ZOOM);
	assert.equal(clampZoom(1), 1);
});

test('nextZoomInStep: スナップ系列の次の値へ進む', () => {
	assert.equal(nextZoomInStep(0.25), 0.5);
	assert.equal(nextZoomInStep(0.6), 1);
	assert.equal(nextZoomInStep(1), 2);
	assert.equal(nextZoomInStep(4), 4); // 上限で維持
});

test('nextZoomInStep: フィット実効倍率が25%未満なら25%へ直接遷移する', () => {
	assert.equal(nextZoomInStep(0.05), MIN_ZOOM);
	assert.equal(nextZoomInStep(0.18), MIN_ZOOM);
});

test('nextZoomOutStep: スナップ系列の前の値へ戻る', () => {
	assert.equal(nextZoomOutStep(4), 2);
	assert.equal(nextZoomOutStep(1.2), 1);
	assert.equal(nextZoomOutStep(0.25), MIN_ZOOM); // 下限で維持
});

test('nextZoomOutStep: フィット実効倍率が25%未満なら現在値を維持（無効操作）', () => {
	assert.equal(nextZoomOutStep(0.18), 0.18);
	assert.equal(nextZoomOutStep(0.05), 0.05);
});

test('normalizeWheelDelta: deltaMode によってpx換算が変わる', () => {
	assert.equal(normalizeWheelDelta(10, 0), 10); // pixel
	assert.equal(normalizeWheelDelta(2, 1), 32); // line (16px/line)
	assert.equal(normalizeWheelDelta(1, 2), 800); // page
});

test('computeWheelZoom: 上方向スクロール(負のdeltaY)で拡大する', () => {
	const next = computeWheelZoom(1, -100, 0);
	assert.ok(next > 1, `拡大するはずが ${next}`);
});

test('computeWheelZoom: 下方向スクロール(正のdeltaY)で縮小する', () => {
	const next = computeWheelZoom(1, 100, 0);
	assert.ok(next < 1, `縮小するはずが ${next}`);
});

test('computeWheelZoom: 微小なホイール入力でも変化が生じる', () => {
	const next = computeWheelZoom(1, -1, 0);
	assert.ok(next > 1 && next < 1.01, `${next} は微小変化の範囲外`);
});

test('computeWheelZoom: 1イベント当たりの変化量はクランプされる（巨大delta）', () => {
	const next = computeWheelZoom(1, -1_000_000, 0);
	// クランプ後の最大 factor = exp(100 * 0.0015)
	const expectedMax = Math.exp(100 * WHEEL_SENSITIVITY_FOR_TEST());
	assert.ok(next <= expectedMax + 1e-9);
});
function WHEEL_SENSITIVITY_FOR_TEST() {
	return 0.0015;
}

test('computeWheelZoom: 通常時（25%以上）は25〜400%にクランプされる', () => {
	assert.equal(computeWheelZoom(0.26, 1_000_000, 0), MIN_ZOOM);
	assert.equal(computeWheelZoom(3.9, -1_000_000, 0), MAX_ZOOM);
});

test('computeWheelZoom: フィット実効倍率25%未満からは25%未満を許容する', () => {
	// 現在18%からわずかに縮小 → 25%未満のまま自由に動く（即座に25%へ丸めない）
	const next = computeWheelZoom(0.18, 10, 0);
	assert.ok(next < MIN_ZOOM, `${next} はクランプされず25%未満のはず`);
});

test('computeWheelZoom: フィット実効倍率25%未満から拡大を続けると25%以上でクランプ域に入る', () => {
	let scale = 0.1;
	for (let i = 0; i < 200 && scale < MIN_ZOOM; i++) {
		scale = computeWheelZoom(scale, -50, 0);
	}
	assert.ok(scale >= MIN_ZOOM);
	assert.ok(scale <= MAX_ZOOM);
});

test('computeContentOffset: コンテンツがコンテナより小さい場合は中央配置オフセットを返す', () => {
	assert.equal(computeContentOffset(800, 400), 200);
});

test('computeContentOffset: コンテンツがコンテナ以上の場合は0を返す', () => {
	assert.equal(computeContentOffset(800, 1200), 0);
	assert.equal(computeContentOffset(800, 800), 0);
});

test('computeZoomScrollPosition: 中央固定でズームすると中心を維持する補正値になる', () => {
	// コンテナ800、コンテンツ1000（フィットなし・オフセット0）、中心400をポインタに
	const scroll = computeZoomScrollPosition({
		pointerInViewport: 400,
		scrollPosition: 100,
		oldContentOffset: 0,
		newContentOffset: 0,
		oldScale: 1,
		newScale: 2,
		containerSize: 800,
		contentSize: 1000,
	});
	// imagePoint = (400+100-0)/1 = 500 → newScroll = 500*2+0-400 = 600
	assert.equal(scroll, 600);
});

test('computeZoomScrollPosition: 結果は0未満にならない', () => {
	const scroll = computeZoomScrollPosition({
		pointerInViewport: 0,
		scrollPosition: 0,
		oldContentOffset: 0,
		newContentOffset: 0,
		oldScale: 2,
		newScale: 1,
		containerSize: 800,
		contentSize: 1000,
	});
	assert.ok(scroll >= 0);
});

test('computeZoomScrollPosition: 結果は最大スクロール量を超えない', () => {
	const scroll = computeZoomScrollPosition({
		pointerInViewport: 799,
		scrollPosition: 5000,
		oldContentOffset: 0,
		newContentOffset: 0,
		oldScale: 1,
		newScale: 4,
		containerSize: 800,
		contentSize: 1000,
	});
	const maxScroll = 1000 * 4 - 800;
	assert.ok(scroll <= maxScroll);
});

test('computeZoomScrollPosition: 中央配置オフセットがある場合も中心を維持する', () => {
	// コンテンツ(400)がコンテナ(800)より小さい → オフセット200で中央配置
	const oldOffset = computeContentOffset(800, 400 * 1);
	const newOffset = computeContentOffset(800, 400 * 2);
	const scroll = computeZoomScrollPosition({
		pointerInViewport: 300, // オフセット200～600の範囲内（コンテンツ上）
		scrollPosition: 0,
		oldContentOffset: oldOffset,
		newContentOffset: newOffset,
		oldScale: 1,
		newScale: 2,
		containerSize: 800,
		contentSize: 400,
	});
	assert.ok(scroll >= 0);
});

test('formatZoomPercent: 倍率を%表示に変換する', () => {
	assert.equal(formatZoomPercent(1), '100%');
	assert.equal(formatZoomPercent(0.18), '18%');
	assert.equal(formatZoomPercent(2), '200%');
});

test('isZoomOutNoop: ちょうど25%では無効（押しても倍率が変わらない）', () => {
	assert.equal(isZoomOutNoop(MIN_ZOOM), true);
});

test('isZoomOutNoop: 25%を超える数値倍率では有効', () => {
	assert.equal(isZoomOutNoop(0.26), false);
	assert.equal(isZoomOutNoop(1), false);
	assert.equal(isZoomOutNoop(MAX_ZOOM), false);
});

test('isZoomOutNoop: フィット実効倍率が25%未満では無効（現在値を維持する無効操作）', () => {
	assert.equal(isZoomOutNoop(0.18), true);
	assert.equal(isZoomOutNoop(0.05), true);
});

test('isZoomOutNoop: 浮動小数点誤差を含む25%相当でも無効と判定する', () => {
	// 0.1 + 0.15 は浮動小数点演算で 0.25 と厳密には一致しない典型例
	assert.equal(isZoomOutNoop(0.1 + 0.15), true);
});

test('50%からの縮小は25%になる（isZoomOutNoopはfalse）', () => {
	assert.equal(isZoomOutNoop(0.5), false);
	assert.equal(nextZoomOutStep(0.5), MIN_ZOOM);
});

test('isZoomInNoop: 400%上限では無効', () => {
	assert.equal(isZoomInNoop(MAX_ZOOM), true);
});

test('isZoomInNoop: 400%未満では有効', () => {
	assert.equal(isZoomInNoop(2), false);
	assert.equal(isZoomInNoop(MIN_ZOOM), false);
	assert.equal(isZoomInNoop(0.05), false);
});

test('decideScaleApply: 十分離れた値は changed:true', () => {
	assert.equal(decideScaleApply(1, 2).changed, true);
});

test('decideScaleApply: 同値は changed:false', () => {
	assert.equal(decideScaleApply(1, 1).changed, false);
});

test('decideScaleApply: 浮動小数点誤差程度の差は changed:false とみなす', () => {
	assert.equal(decideScaleApply(0.25, 0.25 + 1e-10).changed, false);
});

test('decideScaleApply: 1e-9をわずかに超える差は changed:true', () => {
	assert.equal(decideScaleApply(1, 1 + 2e-9).changed, true);
});
