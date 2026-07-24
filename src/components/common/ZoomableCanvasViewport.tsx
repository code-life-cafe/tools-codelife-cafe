// ZoomableCanvasViewport — 画像編集キャンバス共通のズーム＆パン・ビューポート
// image-mosaic / image-text の CanvasEditor / TextCanvas から利用される。
// canvas 内部解像度・座標変換（clientToImage）・%配置オーバーレイは無改修のまま、
// スクロールコンテナ＋表示幅変更（CSSスケーリング）でズーム／パンを実現する。

import { Hand, MousePointer2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MobilePanMode } from '@/lib/hooks/useZoomPan';
import { useZoomPan } from '@/lib/hooks/useZoomPan';
import { formatZoomPercent } from '@/lib/tools/zoom-pan';
import { cn } from '@/lib/utils';

const VIEWPORT_HEIGHT = {
	normal: 'h-[420px] max-h-[60dvh] min-h-[240px]',
	full: 'h-[70dvh] max-h-[70dvh] min-h-[320px]',
} as const;

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
	children: (ctx: { mobileMode: MobilePanMode }) => React.ReactNode;
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
		mobileMode,
		setMobileMode,
		zoomIn,
		zoomOut,
		zoomTo100,
		zoomToFit,
		handleWheel,
		isZoomOutDisabled,
		isZoomInDisabled,
	} = useZoomPan({ contentWidth, contentHeight, resetKey });

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
					className="text-xs text-muted-foreground tabular-nums"
				>
					{percentLabel}
				</span>

				{/* モバイル: 編集／パン切替（デスクトップでは常時ドラッグ選択のため非表示） */}
				<div className="ml-auto flex items-center gap-1 sm:hidden">
					<Button
						type="button"
						variant="outline"
						size="sm"
						aria-pressed={mobileMode === 'edit'}
						aria-label="編集モード（ドラッグで選択・移動）"
						className={cn(
							mobileMode === 'edit' && 'border-primary text-primary',
						)}
						onClick={() => setMobileMode('edit')}
					>
						<MousePointer2 className="h-4 w-4" />
						編集
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						aria-pressed={mobileMode === 'pan'}
						aria-label="パンモード（ドラッグで画像内を移動）"
						className={cn(
							mobileMode === 'pan' && 'border-primary text-primary',
						)}
						onClick={() => setMobileMode('pan')}
					>
						<Hand className="h-4 w-4" />
						パン
					</Button>
				</div>
			</div>

			<div
				ref={containerRef}
				onWheel={handleWheel}
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
					{children({ mobileMode })}
				</div>
			</div>
		</div>
	);
}
