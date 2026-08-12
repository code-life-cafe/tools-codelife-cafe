// zoom-pan.ts — 画像編集ツール共通のズーム＆パン計算ロジック（純粋関数）
// スクロールコンテナ方式のズーム（`ZoomableCanvasViewport`）が利用する。
// DOM・React に依存しない値の計算のみを担う。

/** ＋／−ボタンのスナップ倍率系列（1 = 100%） */
export const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4] as const;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/** ホイールズームの感度定数（1イベントあたりの変化量の基準） */
export const WHEEL_SENSITIVITY = 0.0015;

/** ホイール1イベントで許容する正規化後delta絶対値の上限（過大な一回転を抑制） */
export const WHEEL_MAX_NORMALIZED_DELTA = 100;

/** WheelEvent.deltaMode ごとの1行/1ページあたりの概算px */
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 800;

export function clampZoom(scale: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * フィット倍率を算出する（コンテナより小さい画像はフィット時に拡大しない）。
 * どちらかの寸法が0以下の場合は 1（等倍）を返す。
 */
export function computeFitScale(
	containerWidth: number,
	containerHeight: number,
	contentWidth: number,
	contentHeight: number,
): number {
	if (
		containerWidth <= 0 ||
		containerHeight <= 0 ||
		contentWidth <= 0 ||
		contentHeight <= 0
	) {
		return 1;
	}
	return Math.min(
		containerWidth / contentWidth,
		containerHeight / contentHeight,
		1,
	);
}

/**
 * ＋ボタン押下時の次の倍率（現在値より大きい最初のスナップ値）。
 * 現在値が25%未満の場合は25%へ直接遷移する。
 */
export function nextZoomInStep(currentScale: number): number {
	if (currentScale < MIN_ZOOM) return MIN_ZOOM;
	const next = ZOOM_STEPS.find((step) => step > currentScale + 1e-9);
	return next ?? MAX_ZOOM;
}

/**
 * −ボタン押下時の次の倍率（現在値より小さい最初のスナップ値）。
 * 現在値が25%未満の場合は無効操作として現在値を維持する。
 */
export function nextZoomOutStep(currentScale: number): number {
	if (currentScale < MIN_ZOOM) return currentScale;
	const steps = [...ZOOM_STEPS].reverse();
	const next = steps.find((step) => step < currentScale - 1e-9);
	return next ?? MIN_ZOOM;
}

/** WheelEvent.deltaMode を考慮して deltaY をピクセル相当に正規化する */
export function normalizeWheelDelta(deltaY: number, deltaMode: number): number {
	if (deltaMode === 1) return deltaY * LINE_HEIGHT_PX;
	if (deltaMode === 2) return deltaY * PAGE_HEIGHT_PX;
	return deltaY;
}

/**
 * 修飾キー付きホイール操作による次の倍率を計算する。
 * 現在値が25%未満の場合（フィット遷移直後）は25%へクランプせず、
 * 連続ズームの結果25%へ到達するまで実効倍率を維持する。
 */
export function computeWheelZoom(
	currentScale: number,
	deltaY: number,
	deltaMode: number,
): number {
	const normalized = normalizeWheelDelta(deltaY, deltaMode);
	const clampedDelta = Math.max(
		-WHEEL_MAX_NORMALIZED_DELTA,
		Math.min(WHEEL_MAX_NORMALIZED_DELTA, normalized),
	);
	const factor = Math.exp(-clampedDelta * WHEEL_SENSITIVITY);
	const next = currentScale * factor;
	if (currentScale >= MIN_ZOOM) {
		return clampZoom(next);
	}
	// フィット実効倍率が25%未満からの遷移中: 25%へ到達するまで自由に動かす
	return Math.min(MAX_ZOOM, Math.max(0.01, next));
}

/**
 * コンテンツがコンテナより小さい場合の中央配置オフセット（px）。
 * コンテンツがコンテナ以上の場合は 0（スクロールに委ねる）。
 */
export function computeContentOffset(
	containerSize: number,
	contentDisplaySize: number,
): number {
	return Math.max(0, (containerSize - contentDisplaySize) / 2);
}

export type ZoomScrollParams = {
	/** ポインタのビューポート内座標（コンテナ左上を原点とするCSS px） */
	pointerInViewport: number;
	/** ズーム前のスクロール位置（px） */
	scrollPosition: number;
	/** ズーム前の中央配置オフセット（px） */
	oldContentOffset: number;
	/** ズーム後の中央配置オフセット（px） */
	newContentOffset: number;
	oldScale: number;
	newScale: number;
	containerSize: number;
	/** コンテンツの原寸（スケール適用前、px） */
	contentSize: number;
};

/**
 * カーソル基準ズームの補正後スクロール位置を計算する（1軸分）。
 * (1) 画像内座標を求める → (2) 倍率を更新する → (3) 同じ画像内座標が
 * 同じビューポート位置に来るようスクロール位置を補正する、という手順に対応。
 * 結果は [0, maxScroll] にクランプする。
 */
export function computeZoomScrollPosition(params: ZoomScrollParams): number {
	const {
		pointerInViewport,
		scrollPosition,
		oldContentOffset,
		newContentOffset,
		oldScale,
		newScale,
		containerSize,
		contentSize,
	} = params;
	const imagePoint =
		(pointerInViewport + scrollPosition - oldContentOffset) / oldScale;
	const rawScroll =
		imagePoint * newScale + newContentOffset - pointerInViewport;
	const maxScroll = Math.max(0, contentSize * newScale - containerSize);
	return Math.min(maxScroll, Math.max(0, rawScroll));
}

export type CenterPreservingScrollParams = {
	/** リサイズ前のコンテナサイズ（px、1軸分） */
	oldContainerSize: number;
	/** リサイズ後のコンテナサイズ（px、1軸分） */
	newContainerSize: number;
	/** リサイズ前のスクロール位置（px） */
	scrollPosition: number;
	/** リサイズ前の中央配置オフセット（px） */
	oldContentOffset: number;
	/** リサイズ後の中央配置オフセット（px） */
	newContentOffset: number;
	/** リサイズ前後で共通の倍率（呼び出し側でfitモードを対象外にすること） */
	scale: number;
	/** コンテンツの原寸（スケール適用前、px） */
	contentSize: number;
};

/**
 * コンテナサイズ変化（画面回転・iOSアドレスバー伸縮など、倍率変化を伴わない
 * リサイズ）の前後で、ビューポート中央にあった画像内座標を維持するスクロール
 * 位置を計算する。computeZoomScrollPosition と同じ「画像内座標を求めて
 * 再配置する」手順を、ポインタ位置の代わりにコンテナ中心を基準に適用する。
 */
export function computeCenterPreservingScroll(
	params: CenterPreservingScrollParams,
): number {
	const {
		oldContainerSize,
		newContainerSize,
		scrollPosition,
		oldContentOffset,
		newContentOffset,
		scale,
		contentSize,
	} = params;
	if (scale <= 0) return 0;
	const oldCenter = oldContainerSize / 2;
	const newCenter = newContainerSize / 2;
	const imagePoint = (oldCenter + scrollPosition - oldContentOffset) / scale;
	const rawScroll = imagePoint * scale + newContentOffset - newCenter;
	const maxScroll = Math.max(0, contentSize * scale - newContainerSize);
	return clampScrollPosition(rawScroll, maxScroll);
}

/** 実効倍率を表示用文字列に変換する（例: "18%", "100%"） */
export function formatZoomPercent(scale: number): string {
	return `${Math.round(scale * 100)}%`;
}

/**
 * −ボタン押下が実質的に無効（倍率が変化しない）かどうか。
 * ちょうど25%のときは `nextZoomOutStep` が同じ値を返すため、単純な
 * `scale <= MIN_ZOOM` 比較ではなく、次の値との実質的な同一性で判定する。
 */
export function isZoomOutNoop(scale: number): boolean {
	return Math.abs(nextZoomOutStep(scale) - scale) < 1e-9;
}

/** ＋ボタン押下が実質的に無効（倍率が変化しない）かどうか。400%上限で成立する。 */
export function isZoomInNoop(scale: number): boolean {
	return Math.abs(nextZoomInStep(scale) - scale) < 1e-9;
}

/**
 * 倍率変更が実質的な変化かどうかを判定する（C1修正のコア）。
 * useZoomPan の applyScale / applyPinchTransform から呼ばれる、
 * 同値なら pendingAnchorRef を破棄すべき、という判断を返す。
 */
export function decideScaleApply(
	currentScale: number,
	nextScale: number,
): { changed: boolean } {
	return { changed: Math.abs(nextScale - currentScale) >= 1e-9 };
}

export type GeometryPoint = { x: number; y: number };

/** 2点の中点を求める（2本指ジェスチャーの基準点計算に使用） */
export function computeMidpoint(
	a: GeometryPoint,
	b: GeometryPoint,
): GeometryPoint {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 2点間のユークリッド距離を求める（ピンチ倍率算出に使用） */
export function computeDistance(a: GeometryPoint, b: GeometryPoint): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * ピンチ操作による次の倍率を計算する。
 * startDistance <= 0（指がほぼ重なった状態からの開始等、ゼロ除算になる入力）
 * では倍率を変化させず startScale を返す。
 * クランプ方針は computeWheelZoom と同一の非対称ルールに従う。
 */
export function computePinchZoom(
	startScale: number,
	startDistance: number,
	currentDistance: number,
): number {
	if (startDistance <= 0) return startScale;
	const raw = startScale * (currentDistance / startDistance);
	if (startScale >= MIN_ZOOM) return clampZoom(raw);
	return Math.min(MAX_ZOOM, Math.max(startScale, raw));
}

/** スクロール位置を [0, maxScroll] にクランプする（2本指パンの直接更新で使用） */
export function clampScrollPosition(value: number, maxScroll: number): number {
	return Math.min(Math.max(0, maxScroll), Math.max(0, value));
}
