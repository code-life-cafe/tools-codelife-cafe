// useZoomPan — ZoomableCanvasViewport 用のズーム＆パン状態管理フック
// 純粋な倍率計算は src/lib/tools/zoom-pan.ts に委譲し、ここでは
// DOM参照（ResizeObserver・スクロール位置）と状態遷移のみを扱う。

import type React from 'react';
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
	MAX_ZOOM,
	MIN_ZOOM,
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

	const anchorAt = useCallback(
		(pointerX: number, pointerY: number) => {
			const el = containerRef.current;
			if (!el) return;
			pendingAnchorRef.current = {
				pointerX,
				pointerY,
				scrollLeft: el.scrollLeft,
				scrollTop: el.scrollTop,
				oldScale: scale,
			};
		},
		[scale],
	);

	const centerAnchor = useCallback(() => {
		const el = containerRef.current;
		if (!el) return;
		anchorAt(el.clientWidth / 2, el.clientHeight / 2);
	}, [anchorAt]);

	const zoomIn = useCallback(() => {
		centerAnchor();
		setMode(nextZoomInStep(scale));
	}, [scale, centerAnchor]);

	const zoomOut = useCallback(() => {
		centerAnchor();
		setMode(nextZoomOutStep(scale));
	}, [scale, centerAnchor]);

	const zoomTo100 = useCallback(() => {
		centerAnchor();
		setMode(1);
	}, [centerAnchor]);

	const zoomToFit = useCallback(() => {
		setMode('fit');
	}, []);

	const handleWheel = useCallback(
		(e: React.WheelEvent<HTMLDivElement>) => {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			const el = containerRef.current;
			if (!el) return;
			const rect = el.getBoundingClientRect();
			anchorAt(e.clientX - rect.left, e.clientY - rect.top);
			setMode(computeWheelZoom(scale, e.deltaY, e.deltaMode));
		},
		[scale, anchorAt],
	);

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
		handleWheel,
		isZoomOutDisabled: scale < MIN_ZOOM,
		isZoomInDisabled: scale >= MAX_ZOOM,
	};
}
