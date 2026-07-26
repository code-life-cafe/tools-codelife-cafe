// ZoomableCanvasViewport — 画像編集キャンバス共通のズーム＆パン・ビューポート
// image-mosaic / image-text の CanvasEditor / TextCanvas から利用される。
// canvas 内部解像度・座標変換（clientToImage）・%配置オーバーレイは無改修のまま、
// スクロールコンテナ＋表示幅変更（CSSスケーリング）でズーム／パンを実現する。

import { ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useZoomPan } from '@/lib/hooks/useZoomPan';
import { formatZoomPercent } from '@/lib/tools/zoom-pan';
import { cn } from '@/lib/utils';

const VIEWPORT_HEIGHT = {
	normal: 'h-[420px] max-h-[60dvh] min-h-[240px]',
	full: 'h-[70dvh] max-h-[70dvh] min-h-[320px]',
} as const;

export type ZoomableCanvasContext = {
	scale: number;
	getContainerPoint: (
		clientX: number,
		clientY: number,
	) => { x: number; y: number };
	applyPinchTransform: (
		nextScale: number,
		focalClientX: number,
		focalClientY: number,
		panDeltaX: number,
		panDeltaY: number,
	) => void;
};

type ZoomableCanvasViewportProps = {
	/** コンテンツ（canvas）の原寸幅（内部解像度、px） */
	contentWidth: number;
	/** コンテンツ（canvas）の原寸高さ（内部解像度、px） */
	contentHeight: number;
	/** 値が変わるとフィット・編集モードへ戻す（新しい画像読み込み時に変える） */
	resetKey: unknown;
	/** フルサイズ表示（ページ幅上限解除）中か */
	fullSize?: boolean;
	/**
	 * canvas とオーバーレイをレンダーする関数。
	 * 返す要素は幅・高さ100%で親（このビューポートが用意する原寸ボックス）を満たすこと。
	 */
	children: (ctx: ZoomableCanvasContext) => React.ReactNode;
};

export function ZoomableCanvasViewport({
	contentWidth,
	contentHeight,
	resetKey,
	fullSize = false,
	children,
}: ZoomableCanvasViewportProps) {
	const {
		containerRef,
		scale,
		isFit,
		displayWidth,
		displayHeight,
		offsetX,
		offsetY,
		zoomIn,
		zoomOut,
		zoomTo100,
		zoomToFit,
		isZoomOutDisabled,
		isZoomInDisabled,
		applyPinchTransform,
	} = useZoomPan({ contentWidth, contentHeight, resetKey });

	const getContainerPoint = useCallback(
		(clientX: number, clientY: number) => {
			const rect = containerRef.current?.getBoundingClientRect();
			if (!rect) return { x: clientX, y: clientY };
			return { x: clientX - rect.left, y: clientY - rect.top };
		},
		[containerRef],
	);

	const percentLabel = isFit
		? `フィット（${formatZoomPercent(scale)}）`
		: formatZoomPercent(scale);

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
				<Button
					variant={isFit ? 'secondary' : 'outline'}
					size="sm"
					onClick={zoomToFit}
				>
					フィット
				</Button>
				<Button
					variant={!isFit && scale === 1 ? 'secondary' : 'outline'}
					size="sm"
					onClick={zoomTo100}
				>
					100%
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					onClick={zoomOut}
					disabled={isZoomOutDisabled}
					aria-label="縮小"
				>
					<ZoomOut className="h-4 w-4" />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					onClick={zoomIn}
					disabled={isZoomInDisabled}
					aria-label="拡大"
				>
					<ZoomIn className="h-4 w-4" />
				</Button>
				<span
					data-testid="zoom-percent-label"
					// 最長表示（フィット（xx%））を基準に最小幅を確保し、フィット⇄数値表示の
					// 切り替えでラベル幅が変わってツールバーの折り返し行数（＝キャンバスの
					// 表示位置）が変化してしまうのを防ぐ（狭幅ビューポートで発生しうる）
					className="min-w-[100px] text-xs text-muted-foreground tabular-nums"
				>
					{percentLabel}
				</span>
			</div>

			<div
				ref={containerRef}
				data-testid="zoom-scroll-container"
				className={cn(
					'relative w-full overflow-auto rounded-lg border border-border bg-muted/10',
					fullSize ? VIEWPORT_HEIGHT.full : VIEWPORT_HEIGHT.normal,
				)}
			>
				<div
					style={{
						width: displayWidth || undefined,
						height: displayHeight || undefined,
						marginLeft: offsetX,
						marginTop: offsetY,
					}}
					className="relative"
				>
					{children({ scale, getContainerPoint, applyPinchTransform })}
				</div>
			</div>
		</div>
	);
}
