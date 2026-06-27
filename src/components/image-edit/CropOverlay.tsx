// CropOverlay — ドラッグ・ハンドル付きクロップ矩形UI
// 画像表示要素上に絶対配置し、%ベースで追従する。
// 座標系は bitmap（画像）空間。CSSスケーリングは自動補正。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CropRect } from '@/lib/tools/image-edit';

const MIN_CROP_SIZE = 10; // 画像座標での最小クロップサイズ
const HANDLE_HIT_SIZE = 22; // CSS px でのハンドル当たり判定半径

type HandleId = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'move';

interface CropOverlayProps {
	crop: CropRect;
	imageWidth: number;
	imageHeight: number;
	aspectRatio: number | null;
	onChange: (crop: CropRect) => void;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function clientToImageCoords(
	container: HTMLElement,
	clientX: number,
	clientY: number,
	imageWidth: number,
	imageHeight: number,
): { x: number; y: number } {
	const rect = container.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
	return {
		x: clamp(((clientX - rect.left) * imageWidth) / rect.width, 0, imageWidth),
		y: clamp(
			((clientY - rect.top) * imageHeight) / rect.height,
			0,
			imageHeight,
		),
	};
}

function constrainCrop(
	crop: CropRect,
	imageWidth: number,
	imageHeight: number,
	aspectRatio: number | null,
): CropRect {
	let { x, y, width, height } = crop;

	width = Math.max(MIN_CROP_SIZE, width);
	height = Math.max(MIN_CROP_SIZE, height);

	if (aspectRatio !== null && aspectRatio > 0) {
		if (width / height > aspectRatio) {
			width = Math.round(height * aspectRatio);
		} else {
			height = Math.round(width / aspectRatio);
		}
		width = Math.max(MIN_CROP_SIZE, width);
		height = Math.max(MIN_CROP_SIZE, height);
	}

	width = Math.min(width, imageWidth);
	height = Math.min(height, imageHeight);

	x = clamp(x, 0, imageWidth - width);
	y = clamp(y, 0, imageHeight - height);

	return {
		x: Math.round(x),
		y: Math.round(y),
		width: Math.round(width),
		height: Math.round(height),
	};
}

export function CropOverlay({
	crop,
	imageWidth,
	imageHeight,
	aspectRatio,
	onChange,
}: CropOverlayProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{
		handle: HandleId;
		startX: number;
		startY: number;
		startCrop: CropRect;
	} | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	const toPct = useCallback(
		(val: number, total: number) => `${(val / total) * 100}%`,
		[],
	);

	const handlePointerDown = useCallback(
		(e: React.PointerEvent, handle: HandleId) => {
			e.preventDefault();
			e.stopPropagation();
			const container = containerRef.current;
			if (!container) return;

			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			const imgCoords = clientToImageCoords(
				container,
				e.clientX,
				e.clientY,
				imageWidth,
				imageHeight,
			);
			dragRef.current = {
				handle,
				startX: imgCoords.x,
				startY: imgCoords.y,
				startCrop: { ...crop },
			};
			setIsDragging(true);
		},
		[crop, imageWidth, imageHeight],
	);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent) => {
			const drag = dragRef.current;
			const container = containerRef.current;
			if (!drag || !container) return;

			const imgCoords = clientToImageCoords(
				container,
				e.clientX,
				e.clientY,
				imageWidth,
				imageHeight,
			);
			const dx = imgCoords.x - drag.startX;
			const dy = imgCoords.y - drag.startY;
			const sc = drag.startCrop;

			let next: CropRect;

			if (drag.handle === 'move') {
				next = { ...sc, x: sc.x + dx, y: sc.y + dy };
			} else {
				let { x, y, width, height } = sc;
				const right = x + width;
				const bottom = y + height;

				if (drag.handle.includes('w')) {
					const newX = Math.min(x + dx, right - MIN_CROP_SIZE);
					width = right - newX;
					x = newX;
				}
				if (drag.handle.includes('e')) {
					width = sc.width + dx;
				}
				if (drag.handle.includes('n')) {
					const newY = Math.min(y + dy, bottom - MIN_CROP_SIZE);
					height = bottom - newY;
					y = newY;
				}
				if (drag.handle.includes('s')) {
					height = sc.height + dy;
				}

				if (aspectRatio !== null && aspectRatio > 0) {
					if (drag.handle === 'n' || drag.handle === 's') {
						width = Math.round(height * aspectRatio);
						if (drag.handle === 'n') {
							x = sc.x + sc.width / 2 - width / 2;
						}
					} else if (drag.handle === 'e' || drag.handle === 'w') {
						height = Math.round(width / aspectRatio);
						if (drag.handle === 'w') {
							y = sc.y + sc.height / 2 - height / 2;
						}
					} else {
						height = Math.round(width / aspectRatio);
					}
				}

				next = { x, y, width, height };
			}

			onChange(constrainCrop(next, imageWidth, imageHeight, aspectRatio));
		},
		[imageWidth, imageHeight, aspectRatio, onChange],
	);

	const handlePointerUp = useCallback(() => {
		dragRef.current = null;
		setIsDragging(false);
	}, []);

	useEffect(() => {
		const handler = () => {
			dragRef.current = null;
			setIsDragging(false);
		};
		window.addEventListener('pointercancel', handler);
		return () => window.removeEventListener('pointercancel', handler);
	}, []);

	const cropStyle = {
		left: toPct(crop.x, imageWidth),
		top: toPct(crop.y, imageHeight),
		width: toPct(crop.width, imageWidth),
		height: toPct(crop.height, imageHeight),
	};

	const handles: { id: HandleId; className: string; cursor: string }[] = [
		{
			id: 'nw',
			className: '-top-1.5 -left-1.5',
			cursor: 'nwse-resize',
		},
		{
			id: 'ne',
			className: '-top-1.5 -right-1.5',
			cursor: 'nesw-resize',
		},
		{
			id: 'sw',
			className: '-bottom-1.5 -left-1.5',
			cursor: 'nesw-resize',
		},
		{
			id: 'se',
			className: '-bottom-1.5 -right-1.5',
			cursor: 'nwse-resize',
		},
		{
			id: 'n',
			className: '-top-1.5 left-1/2 -translate-x-1/2',
			cursor: 'ns-resize',
		},
		{
			id: 's',
			className: '-bottom-1.5 left-1/2 -translate-x-1/2',
			cursor: 'ns-resize',
		},
		{
			id: 'w',
			className: 'top-1/2 -left-1.5 -translate-y-1/2',
			cursor: 'ew-resize',
		},
		{
			id: 'e',
			className: 'top-1/2 -right-1.5 -translate-y-1/2',
			cursor: 'ew-resize',
		},
	];

	return (
		<div
			ref={containerRef}
			className="absolute inset-0 touch-none"
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onLostPointerCapture={handlePointerUp}
		>
			{/* 暗転マスク（クロップ外領域） */}
			<div
				className="absolute inset-0 bg-black/50"
				style={{
					clipPath: `polygon(
						0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
						${cropStyle.left} ${cropStyle.top},
						${cropStyle.left} calc(${cropStyle.top} + ${cropStyle.height}),
						calc(${cropStyle.left} + ${cropStyle.width}) calc(${cropStyle.top} + ${cropStyle.height}),
						calc(${cropStyle.left} + ${cropStyle.width}) ${cropStyle.top},
						${cropStyle.left} ${cropStyle.top}
					)`,
				}}
			/>

			{/* クロップ枠 */}
			<div
				className="absolute border-2 border-white shadow-sm"
				style={cropStyle}
				onPointerDown={(e) => handlePointerDown(e, 'move')}
				data-crop-area
			>
				{/* 三分割ガイドライン */}
				{isDragging && (
					<>
						<div className="absolute left-1/3 top-0 h-full w-px bg-white/40" />
						<div className="absolute left-2/3 top-0 h-full w-px bg-white/40" />
						<div className="absolute top-1/3 left-0 h-px w-full bg-white/40" />
						<div className="absolute top-2/3 left-0 h-px w-full bg-white/40" />
					</>
				)}

				{/* サイズ表示 */}
				<div className="absolute -top-6 left-0 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white tabular-nums">
					{crop.width} × {crop.height}
				</div>

				{/* 8ハンドル */}
				{handles.map((h) => (
					<div
						key={h.id}
						className={`absolute size-3 rounded-full border-2 border-white bg-primary shadow ${h.className}`}
						style={{
							cursor: h.cursor,
							padding: `${HANDLE_HIT_SIZE}px`,
							margin: `-${HANDLE_HIT_SIZE}px`,
						}}
						onPointerDown={(e) => handlePointerDown(e, h.id)}
					/>
				))}
			</div>
		</div>
	);
}
