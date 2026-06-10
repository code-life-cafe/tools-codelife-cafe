// CanvasEditor — モザイクツールの編集キャンバス
// canvas の内部解像度は常に元画像サイズ（座標は元画像座標系で管理し、表示はCSS縮小のみ）。
// 選択枠・ドラッグ矩形は canvas に描かず DOM オーバーレイで表示する
// （canvas のピクセルを常に renderMasked の純粋な出力に保つため）

import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clientToImage } from '@/lib/tools/image-common';
import {
	type MaskRegion,
	type Rect,
	renderMasked,
} from '@/lib/tools/image-mosaic';

/** これ未満のドラッグ距離（CSS px）はクリック＝領域選択として扱う */
const CLICK_THRESHOLD_PX = 4;

/** 追加を受け付ける最小領域サイズ（元画像 px） */
const MIN_REGION_SIZE = 3;

type CanvasEditorProps = {
	source: HTMLImageElement | HTMLCanvasElement;
	regions: MaskRegion[];
	selectedId: string | null;
	onAddRegion: (rect: Rect) => void;
	onSelectRegion: (id: string | null) => void;
	onDeleteRegion: (id: string) => void;
};

type DragState = {
	pointerId: number;
	startClientX: number;
	startClientY: number;
	startX: number;
	startY: number;
	moved: boolean;
};

function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
	return {
		x: Math.min(x1, x2),
		y: Math.min(y1, y2),
		width: Math.abs(x2 - x1),
		height: Math.abs(y2 - y1),
	};
}

function hitTest(
	regions: MaskRegion[],
	x: number,
	y: number,
): MaskRegion | null {
	// 後の領域（上に描画されたもの）を優先
	for (let i = regions.length - 1; i >= 0; i--) {
		const { rect } = regions[i];
		if (
			x >= rect.x &&
			x <= rect.x + rect.width &&
			y >= rect.y &&
			y <= rect.y + rect.height
		) {
			return regions[i];
		}
	}
	return null;
}

export function CanvasEditor({
	source,
	regions,
	selectedId,
	onAddRegion,
	onSelectRegion,
	onDeleteRegion,
}: CanvasEditorProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const dragRef = useRef<DragState | null>(null);
	const rafRef = useRef<number | null>(null);
	const [dragRect, setDragRect] = useState<Rect | null>(null);
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	const imageSize = useMemo(
		() =>
			source instanceof HTMLImageElement
				? { width: source.naturalWidth, height: source.naturalHeight }
				: { width: source.width, height: source.height },
		[source],
	);

	// 本レンダー: regions 変更時に純粋パイプラインで再描画。
	// スライダー連続変更などをフレーム単位にまとめるため rAF でコアレスする
	useEffect(() => {
		const raf = requestAnimationFrame(() => {
			const canvas = canvasRef.current;
			if (!canvas) return;
			const rendered = renderMasked(source, regions);
			canvas.width = rendered.width;
			canvas.height = rendered.height;
			canvas.getContext('2d')?.drawImage(rendered, 0, 0);
		});
		return () => cancelAnimationFrame(raf);
	}, [source, regions]);

	const handlePointerDown = useCallback(
		(e: React.PointerEvent<HTMLCanvasElement>) => {
			if (e.button !== 0) return;
			const canvas = canvasRef.current;
			if (!canvas) return;
			canvas.setPointerCapture(e.pointerId);
			const { x, y } = clientToImage(canvas, e.clientX, e.clientY);
			dragRef.current = {
				pointerId: e.pointerId,
				startClientX: e.clientX,
				startClientY: e.clientY,
				startX: x,
				startY: y,
				moved: false,
			};
		},
		[],
	);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent<HTMLCanvasElement>) => {
			const canvas = canvasRef.current;
			if (!canvas) return;
			const drag = dragRef.current;

			if (!drag || drag.pointerId !== e.pointerId) {
				// ドラッグ中でなければホバー中の領域を更新
				const { x, y } = clientToImage(canvas, e.clientX, e.clientY);
				setHoveredId(hitTest(regions, x, y)?.id ?? null);
				return;
			}

			if (
				!drag.moved &&
				Math.hypot(
					e.clientX - drag.startClientX,
					e.clientY - drag.startClientY,
				) < CLICK_THRESHOLD_PX
			) {
				return;
			}
			drag.moved = true;

			// rAF スロットル: 1フレームにつき1回だけオーバーレイを更新
			const { clientX, clientY } = e;
			if (rafRef.current !== null) return;
			rafRef.current = requestAnimationFrame(() => {
				rafRef.current = null;
				const current = dragRef.current;
				if (!current) return;
				const { x, y } = clientToImage(canvas, clientX, clientY);
				setDragRect(normalizeRect(current.startX, current.startY, x, y));
			});
		},
		[regions],
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
			setDragRect(null);

			const { x, y } = clientToImage(canvas, e.clientX, e.clientY);
			if (!drag.moved) {
				// クリック: 領域の選択/解除
				onSelectRegion(hitTest(regions, x, y)?.id ?? null);
				return;
			}
			const rect = normalizeRect(drag.startX, drag.startY, x, y);
			if (rect.width >= MIN_REGION_SIZE && rect.height >= MIN_REGION_SIZE) {
				onAddRegion(rect);
			}
		},
		[regions, onAddRegion, onSelectRegion],
	);

	// タッチキャンセルやブラウザジェスチャでドラッグが中断された場合の後始末
	// （領域は追加せず破棄する）
	const handlePointerCancel = useCallback(
		(e: React.PointerEvent<HTMLCanvasElement>) => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== e.pointerId) return;
			dragRef.current = null;
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			setDragRect(null);
		},
		[],
	);

	// 領域選択中は Delete / Backspace キーで削除（入力欄へのタイプは除外）
	useEffect(() => {
		if (!selectedId) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key !== 'Delete' && e.key !== 'Backspace') return;
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === 'INPUT' ||
					target.tagName === 'TEXTAREA' ||
					target.isContentEditable)
			) {
				return;
			}
			e.preventDefault();
			onDeleteRegion(selectedId);
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [selectedId, onDeleteRegion]);

	// 元画像座標 → コンテナ内のパーセント座標（表示スケール非依存）
	const pctStyle = (rect: Rect): React.CSSProperties => ({
		left: `${(rect.x / imageSize.width) * 100}%`,
		top: `${(rect.y / imageSize.height) * 100}%`,
		width: `${(rect.width / imageSize.width) * 100}%`,
		height: `${(rect.height / imageSize.height) * 100}%`,
	});

	return (
		<div className="relative inline-block max-w-full">
			<canvas
				ref={canvasRef}
				data-testid="editor-canvas"
				className="block h-auto max-h-[60vh] w-auto max-w-full cursor-crosshair touch-none rounded-lg border border-border"
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerCancel}
				onPointerLeave={() => setHoveredId(null)}
			/>
			{/* 既存領域のアウトライン（DOMオーバーレイ） */}
			{regions.map((region) => {
				const isSelected = region.id === selectedId;
				const isHovered = region.id === hoveredId;
				return (
					<div
						key={region.id}
						className={`pointer-events-none absolute border border-dashed transition-colors ${
							isSelected
								? 'border-primary border-2 bg-primary/10'
								: isHovered
									? 'border-primary/70'
									: 'border-transparent'
						}`}
						style={pctStyle(region.rect)}
					>
						{isSelected && (
							<button
								type="button"
								aria-label="領域を削除"
								className="pointer-events-auto absolute -top-3 -right-3 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-white shadow-sm hover:opacity-80"
								onClick={(e) => {
									e.stopPropagation();
									onDeleteRegion(region.id);
								}}
							>
								<X className="h-4 w-4" />
							</button>
						)}
					</div>
				);
			})}
			{/* ドラッグ中の選択矩形 */}
			{dragRect && (
				<div
					className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/10"
					style={pctStyle(dragRect)}
				/>
			)}
		</div>
	);
}
