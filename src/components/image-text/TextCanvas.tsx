// TextCanvas — テキスト挿入ツールのプレビューキャンバス
// canvas の内部解像度は常に元画像サイズ。レイヤーのドラッグ移動に対応し、
// 選択レイヤーの破線バウンディングボックスは DOM オーバーレイで表示する

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	type ZoomableCanvasContext,
	ZoomableCanvasViewport,
} from '@/components/common/ZoomableCanvasViewport';
import { useGestureController } from '@/lib/hooks/useGestureController';
import type { TwoFingerMoveInfo } from '@/lib/tools/gesture-controller';
import { clientToImage } from '@/lib/tools/image-common';
import {
	BG_PADDING,
	measureTextLayer,
	renderTextLayers,
	type TextLayer,
} from '@/lib/tools/image-text';
import { computePinchZoom } from '@/lib/tools/zoom-pan';

type TextCanvasProps = {
	source: HTMLImageElement | HTMLCanvasElement;
	layers: TextLayer[];
	selectedId: string | null;
	onSelect: (id: string | null) => void;
	onMoveLayer: (id: string, x: number, y: number) => void;
	/** フルサイズ表示（ページ幅上限解除）中か */
	fullSize?: boolean;
};

type DragState = {
	pointerId: number;
	layerId: string;
	/** ポインタ位置とレイヤー左上のオフセット（元画像座標） */
	offsetX: number;
	offsetY: number;
};

/** レイヤーのヒットテスト用バウンディングボックス（背景パディング含む） */
function layerBounds(layer: TextLayer) {
	const size = measureTextLayer(layer);
	const pad = layer.backgroundColor ? BG_PADDING : 0;
	return {
		x: layer.x - pad,
		y: layer.y - pad,
		width: size.width + pad * 2,
		height: size.height + pad * 2,
	};
}

function hitTest(layers: TextLayer[], x: number, y: number): TextLayer | null {
	// 後のレイヤー（上に描画されたもの）を優先
	for (let i = layers.length - 1; i >= 0; i--) {
		const b = layerBounds(layers[i]);
		if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
			return layers[i];
		}
	}
	return null;
}

export function TextCanvas({
	source,
	layers,
	selectedId,
	onSelect,
	onMoveLayer,
	fullSize,
}: TextCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const dragRef = useRef<DragState | null>(null);
	const rafRef = useRef<number | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	const imageSize = useMemo(
		() =>
			source instanceof HTMLImageElement
				? { width: source.naturalWidth, height: source.naturalHeight }
				: { width: source.width, height: source.height },
		[source],
	);

	// 本レンダー: layers 変更時に純粋パイプラインで再描画（rAF でコアレス）
	useEffect(() => {
		const raf = requestAnimationFrame(() => {
			const canvas = canvasRef.current;
			if (!canvas) return;
			const rendered = renderTextLayers(source, layers);
			canvas.width = rendered.width;
			canvas.height = rendered.height;
			canvas.getContext('2d')?.drawImage(rendered, 0, 0);
		});
		return () => cancelAnimationFrame(raf);
	}, [source, layers]);

	const handlePointerDown = useCallback(
		(e: React.PointerEvent<HTMLCanvasElement>) => {
			const canvas = canvasRef.current;
			if (!canvas) return;
			const { x, y } = clientToImage(canvas, e.clientX, e.clientY);
			const hit = hitTest(layers, x, y);
			if (!hit) {
				onSelect(null);
				return;
			}
			onSelect(hit.id);
			dragRef.current = {
				pointerId: e.pointerId,
				layerId: hit.id,
				offsetX: x - hit.x,
				offsetY: y - hit.y,
			};
			setIsDragging(true);
		},
		[layers, onSelect],
	);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent<HTMLCanvasElement>) => {
			const canvas = canvasRef.current;
			const drag = dragRef.current;
			if (!canvas || !drag || drag.pointerId !== e.pointerId) return;

			// rAF スロットル: 1フレームにつき1回だけ位置を更新
			const { clientX, clientY } = e;
			if (rafRef.current !== null) return;
			rafRef.current = requestAnimationFrame(() => {
				rafRef.current = null;
				const current = dragRef.current;
				if (!current) return;
				const { x, y } = clientToImage(canvas, clientX, clientY);
				onMoveLayer(
					current.layerId,
					Math.round(x - current.offsetX),
					Math.round(y - current.offsetY),
				);
			});
		},
		[onMoveLayer],
	);

	const handlePointerUp = useCallback(
		(e: React.PointerEvent<HTMLCanvasElement>) => {
			const canvas = canvasRef.current;
			const drag = dragRef.current;
			if (!canvas || !drag || drag.pointerId !== e.pointerId) return;
			dragRef.current = null;
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			// pending rAF を破棄した分を含め、リリース座標で最終位置を確定する
			const { x, y } = clientToImage(canvas, e.clientX, e.clientY);
			onMoveLayer(
				drag.layerId,
				Math.round(x - drag.offsetX),
				Math.round(y - drag.offsetY),
			);
			setIsDragging(false);
		},
		[onMoveLayer],
	);

	// タッチキャンセルやブラウザジェスチャでドラッグが中断された場合の後始末
	const handlePointerCancel = useCallback(
		(e: React.PointerEvent<HTMLCanvasElement>) => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== e.pointerId) return;
			dragRef.current = null;
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			setIsDragging(false);
		},
		[],
	);

	const zoomBridgeRef = useRef<ZoomableCanvasContext | null>(null);
	const startScaleRef = useRef(1);
	const pinchAccumRef = useRef({ panX: 0, panY: 0 });
	const pinchLatestRef = useRef<{
		nextScale: number;
		focalX: number;
		focalY: number;
	} | null>(null);
	const pinchRafRef = useRef<number | null>(null);

	const handleSingleInterrupted = useCallback(() => {
		dragRef.current = null;
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		setIsDragging(false);
	}, []);

	const handleTwoFingerStart = useCallback(() => {
		startScaleRef.current = zoomBridgeRef.current?.scale ?? 1;
		pinchAccumRef.current = { panX: 0, panY: 0 };
	}, []);

	const handleTwoFingerMove = useCallback((info: TwoFingerMoveInfo) => {
		const bridge = zoomBridgeRef.current;
		if (!bridge) return;
		const nextScale = computePinchZoom(
			startScaleRef.current,
			info.startDistance,
			info.distance,
		);
		const focal = bridge.getContainerPoint(info.midpoint.x, info.midpoint.y);
		pinchAccumRef.current.panX += info.midpoint.x - info.previousMidpoint.x;
		pinchAccumRef.current.panY += info.midpoint.y - info.previousMidpoint.y;
		pinchLatestRef.current = { nextScale, focalX: focal.x, focalY: focal.y };
		if (pinchRafRef.current !== null) return;
		pinchRafRef.current = requestAnimationFrame(() => {
			pinchRafRef.current = null;
			const latest = pinchLatestRef.current;
			const { panX, panY } = pinchAccumRef.current;
			pinchAccumRef.current = { panX: 0, panY: 0 };
			if (!latest) return;
			bridge.applyPinchTransform(
				latest.nextScale,
				latest.focalX,
				latest.focalY,
				panX,
				panY,
			);
		});
	}, []);

	const gesture = useGestureController({
		onSinglePointerDown: handlePointerDown,
		onSinglePointerMove: handlePointerMove,
		onSinglePointerUp: handlePointerUp,
		onSinglePointerCancel: handlePointerCancel,
		onSinglePointerInterrupted: handleSingleInterrupted,
		onTwoFingerStart: handleTwoFingerStart,
		onTwoFingerMove: handleTwoFingerMove,
	});

	const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;

	return (
		<ZoomableCanvasViewport
			contentWidth={imageSize.width}
			contentHeight={imageSize.height}
			resetKey={source}
			fullSize={fullSize}
		>
			{(ctx) => {
				zoomBridgeRef.current = ctx;
				return (
					<div className="relative h-full w-full">
						<canvas
							ref={canvasRef}
							data-testid="text-canvas"
							className={`block h-full w-full touch-none rounded-lg border border-border ${isDragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
							onPointerDown={gesture.onPointerDown}
							onPointerMove={gesture.onPointerMove}
							onPointerUp={gesture.onPointerUp}
							onPointerCancel={gesture.onPointerCancel}
							onLostPointerCapture={gesture.onLostPointerCapture}
						/>
						{/* 選択レイヤーの破線バウンディングボックス（DOMオーバーレイ） */}
						{selectedLayer &&
							(() => {
								const b = layerBounds(selectedLayer);
								return (
									<div
										className="pointer-events-none absolute border-2 border-dashed border-primary"
										style={{
											left: `${(b.x / imageSize.width) * 100}%`,
											top: `${(b.y / imageSize.height) * 100}%`,
											width: `${(b.width / imageSize.width) * 100}%`,
											height: `${(b.height / imageSize.height) * 100}%`,
										}}
									/>
								);
							})()}
					</div>
				);
			}}
		</ZoomableCanvasViewport>
	);
}
