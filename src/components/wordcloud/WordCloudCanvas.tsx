import { useMemo } from 'react';
import type {
	PlacedWord,
	WordCloudLayoutOptions,
} from '@/lib/tools/wordcloud/index.ts';
import { toSvg } from '@/lib/tools/wordcloud/index.ts';

interface WordCloudCanvasProps {
	placedWords: PlacedWord[];
	layoutOptions: WordCloudLayoutOptions;
	isLoading?: boolean;
	/** 解析は完了したが足切り条件で全語が除外された場合 */
	allWordsFiltered?: boolean;
}

export function WordCloudCanvas({
	placedWords,
	layoutOptions,
	isLoading,
	allWordsFiltered,
}: WordCloudCanvasProps) {
	// 初回描画から結果SVGを出し、空カードを経由する1フレームを作らない
	const svgHtml = useMemo(
		() => (placedWords.length === 0 ? '' : toSvg(placedWords, layoutOptions)),
		[placedWords, layoutOptions],
	);
	// 結果カード（SVG高さ + p-4 上下32px + border 2px）と同じ高さを全状態で確保し、
	// 生成中・結果表示の切替で後続コンテンツがずれないようにする
	const cardHeight = { minHeight: layoutOptions.height + 34 };

	if (isLoading) {
		return (
			<div
				className="flex w-full flex-col items-center justify-center rounded-lg border bg-card p-6 text-center shadow-sm"
				style={cardHeight}
				data-testid="wordcloud-canvas"
			>
				<div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
				<p className="mt-4 text-sm text-muted-foreground">
					テキストを解析しワードクラウドを生成中...
				</p>
			</div>
		);
	}

	if (placedWords.length === 0) {
		if (allWordsFiltered) {
			return (
				<div
					className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-amber-400/60 bg-amber-50/30 dark:bg-amber-900/10 p-6 text-center text-muted-foreground"
					style={cardHeight}
					data-testid="wordcloud-canvas"
				>
					<p className="text-base font-medium text-amber-700 dark:text-amber-400">
						足切り条件で描画対象の単語が0件になりました
					</p>
					<p className="mt-1 text-xs">
						「最低出現回数」を下げるか、テキストを増やすと表示されます。
					</p>
				</div>
			);
		}
		return (
			<div
				className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center text-muted-foreground"
				style={cardHeight}
				data-testid="wordcloud-canvas"
			>
				<p className="text-base font-medium">ワードクラウドが表示されます</p>
				<p className="mt-1 text-xs">
					上のエリアにテキストを入力するかファイルを読み込んで解析を開始してください
				</p>
			</div>
		);
	}

	return (
		<div
			className="flex flex-col items-center rounded-lg border bg-card p-4 shadow-sm overflow-hidden"
			style={cardHeight}
			data-testid="wordcloud-canvas"
		>
			<div
				className="w-full flex justify-center items-center overflow-auto max-h-[500px]"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: SVG sanitized during generation
				dangerouslySetInnerHTML={{ __html: svgHtml }}
			/>
		</div>
	);
}
