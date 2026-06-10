// TextCanvas — テキスト挿入ツールのプレビューキャンバス
// canvas の内部解像度は常に元画像サイズ。レイヤーのドラッグ移動に対応し、
// 選択レイヤーの破線バウンディングボックスは DOM オーバーレイで表示する

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clientToImage } from '@/lib/tools/image-common';
import {
	BG_PADDING,
	measureTextLayer,
	renderTextLayers,
	type TextLayer,
} from '@/lib/tools/image-text';

type TextCanvasProps = {
	source: HTMLImageElement | HTMLCanvasElement;
	layers: TextLayer[];
	selectedId: string | null;
	onSelect: (id: string | null) => void;
	onMoveLayer: (id: string, x: number, y: number) => void;
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
			if (e.button !== 0) return;
			const canvas = canvasRef.current;
			if (!canvas) return;
			const { x, y } = clientToImage(canvas, e.clientX, e.clientY);
			const hit = hitTest(layers, x, y);
			if (!hit) {
				onSelect(null);
				return;
			}
			onSelect(hit.id);
			canvas.setPointerCapture(e.pointerId);
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
			canvas.releasePointerCapture(e.pointerId);
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			setIsDragging(false);
		},
		[],
	);

	const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;

	return (
		<div className="relative inline-block max-w-full">
			<canvas
				ref={canvasRef}
				data-testid="text-canvas"
				className={`block h-auto max-h-[60vh] w-auto max-w-full touch-none rounded-lg border border-border ${
					isDragging ? 'cursor-grabbing' : 'cursor-pointer'
				}`}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
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
}
