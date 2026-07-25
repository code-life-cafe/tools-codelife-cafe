// useZoomPan — ZoomableCanvasViewport 用のズーム＆パン状態管理フック
// 純粋な倍率計算は src/lib/tools/zoom-pan.ts に委譲し、ここでは
// DOM参照（ResizeObserver・スクロール位置）と状態遷移のみを扱う。

import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import {
	computeContentOffset,
	computeFitScale,
	computeWheelZoom,
	computeZoomScrollPosition,
	decideScaleApply,
	isZoomInNoop,
	isZoomOutNoop,
	nextZoomInStep,
	nextZoomOutStep,
} from '@/lib/tools/zoom-pan';

export type MobilePanMode = 'edit' | 'pan';

type ContainerSize = { width: number; height: number };

type PendingAnchor = {
	pointerX: number;
	pointerY: number;
	scrollLeft: number;
	scrollTop: number;
	oldScale: number;
} | null;

export function useZoomPan(params: {
	contentWidth: number;
	contentHeight: number;
	/** 値が変わるとフィット・編集モードへ戻す（新しい画像の読み込み時） */
	resetKey: unknown;
}) {
	const { contentWidth, contentHeight, resetKey } = params;
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [containerSize, setContainerSize] = useState<ContainerSize>({
		width: 0,
		height: 0,
	});
	const [mode, setMode] = useState<'fit' | number>('fit');
	const [mobileMode, setMobileMode] = useState<MobilePanMode>('edit');
	const pendingAnchorRef = useRef<PendingAnchor>(null);

	// resetKey の変化のみを契機とする（本文内では参照しない）
	// biome-ignore lint/correctness/useExhaustiveDependencies: resetKeyは識別子変更の検知にのみ使う
	useEffect(() => {
		setMode('fit');
		setMobileMode('edit');
		pendingAnchorRef.current = null;
	}, [resetKey]);

	useEffect(() => {
		const el = containerRef.current;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			setContainerSize({
				width: entry.contentRect.width,
				height: entry.contentRect.height,
			});
		});
		observer.observe(el);
		setContainerSize({ width: el.clientWidth, height: el.clientHeight });
		return () => observer.disconnect();
	}, []);

	const fitScale = computeFitScale(
		containerSize.width,
		containerSize.height,
		contentWidth,
		contentHeight,
	);
	const scale = mode === 'fit' ? fitScale : mode;
	const isFit = mode === 'fit';

	// ホイールイベントは短時間に連続発火しうる。クロージャに閉じ込めた scale を
	// 参照すると、React の再レンダー（＝リスナー再登録）が追いつかない間に
	// 古い scale のまま計算し続けてしまい、25%クランプ後も倍率が下がり続ける
	// といった不整合が生じる。ref には毎レンダー最新値を同期し、常に最新の
	// scale を読めるようにする。
	const scaleRef = useRef(scale);
	scaleRef.current = scale;

	const displayWidth = contentWidth * scale;
	const displayHeight = contentHeight * scale;
	const offsetX = computeContentOffset(containerSize.width, displayWidth);
	const offsetY = computeContentOffset(containerSize.height, displayHeight);

	// カーソル/中心基準ズーム: スケール変更後にスクロール位置を補正して同じ画像内座標を維持する
	useLayoutEffect(() => {
		const anchor = pendingAnchorRef.current;
		const el = containerRef.current;
		if (!anchor || !el) return;
		pendingAnchorRef.current = null;
		const oldOffsetX = computeContentOffset(
			containerSize.width,
			contentWidth * anchor.oldScale,
		);
		const oldOffsetY = computeContentOffset(
			containerSize.height,
			contentHeight * anchor.oldScale,
		);
		el.scrollLeft = computeZoomScrollPosition({
			pointerInViewport: anchor.pointerX,
			scrollPosition: anchor.scrollLeft,
			oldContentOffset: oldOffsetX,
			newContentOffset: offsetX,
			oldScale: anchor.oldScale,
			newScale: scale,
			containerSize: containerSize.width,
			contentSize: contentWidth,
		});
		el.scrollTop = computeZoomScrollPosition({
			pointerInViewport: anchor.pointerY,
			scrollPosition: anchor.scrollTop,
			oldContentOffset: oldOffsetY,
			newContentOffset: offsetY,
			oldScale: anchor.oldScale,
			newScale: scale,
			containerSize: containerSize.height,
			contentSize: contentHeight,
		});
		// scale 変化のたびに保留中の補正があれば適用する
	}, [
		scale,
		containerSize.width,
		containerSize.height,
		contentWidth,
		contentHeight,
		offsetX,
		offsetY,
	]);

	// scaleRef を参照するため scale/mode に依存しない安定した関数にする
	const anchorAt = useCallback((pointerX: number, pointerY: number) => {
		const el = containerRef.current;
		if (!el) return;
		pendingAnchorRef.current = {
			pointerX,
			pointerY,
			scrollLeft: el.scrollLeft,
			scrollTop: el.scrollTop,
			oldScale: scaleRef.current,
		};
	}, []);

	const centerPoint = useCallback(() => {
		const el = containerRef.current;
		return el
			? { x: el.clientWidth / 2, y: el.clientHeight / 2 }
			: { x: 0, y: 0 };
	}, []);

	const applyScale = useCallback(
		(next: number, px: number, py: number) => {
			if (!decideScaleApply(scaleRef.current, next).changed) {
				pendingAnchorRef.current = null;
			} else {
				anchorAt(px, py);
			}
			setMode(next);
		},
		[anchorAt],
	);

	const zoomIn = useCallback(() => {
		const { x, y } = centerPoint();
		applyScale(nextZoomInStep(scaleRef.current), x, y);
	}, [applyScale, centerPoint]);

	const zoomOut = useCallback(() => {
		const { x, y } = centerPoint();
		applyScale(nextZoomOutStep(scaleRef.current), x, y);
	}, [applyScale, centerPoint]);

	const zoomTo100 = useCallback(() => {
		const { x, y } = centerPoint();
		applyScale(1, x, y);
	}, [applyScale, centerPoint]);

	const zoomToFit = useCallback(() => {
		// フィット遷移はアンカー無しの既存仕様を維持しつつ、遷移前に残留アンカーを明示的に破棄する
		pendingAnchorRef.current = null;
		setMode('fit');
	}, []);

	// 修飾キー付きホイールでズームする。React の合成 onWheel は passive
	// リスナーとして登録されるため e.preventDefault() が効かず、ブラウザの
	// 既定スクロール（あるいはページ全体のピンチズーム）が同時に発生してしまう。
	// そのためネイティブの非passiveリスナーを直接addEventListenerする。
	// scaleRef を参照することで、連続したホイールイベントが再レンダーより
	// 速く発火しても常に最新の scale を基準に計算する（登録は初回のみでよい）。
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const listener = (e: WheelEvent) => {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			const rect = el.getBoundingClientRect();
			applyScale(
				computeWheelZoom(scaleRef.current, e.deltaY, e.deltaMode),
				e.clientX - rect.left,
				e.clientY - rect.top,
			);
		};
		el.addEventListener('wheel', listener, { passive: false });
		return () => el.removeEventListener('wheel', listener);
	}, [applyScale]);

	return {
		containerRef,
		scale,
		isFit,
		displayWidth,
		displayHeight,
		offsetX,
		offsetY,
		mobileMode,
		setMobileMode,
		zoomIn,
		zoomOut,
		zoomTo100,
		zoomToFit,
		isZoomOutDisabled: isZoomOutNoop(scale),
		isZoomInDisabled: isZoomInNoop(scale),
	};
}
