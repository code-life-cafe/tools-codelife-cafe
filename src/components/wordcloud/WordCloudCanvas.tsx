import { useEffect, useState } from 'react';
import type {
	PlacedWord,
	WordCloudLayoutOptions,
} from '@/lib/tools/wordcloud/index.ts';
import { toSvg } from '@/lib/tools/wordcloud/index.ts';

interface WordCloudCanvasProps {
	placedWords: PlacedWord[];
	layoutOptions: WordCloudLayoutOptions;
	isLoading?: boolean;
}

export function WordCloudCanvas({
	placedWords,
	layoutOptions,
	isLoading,
}: WordCloudCanvasProps) {
	const [svgHtml, setSvgHtml] = useState<string>('');

	useEffect(() => {
		if (placedWords.length === 0) {
			setSvgHtml('');
			return;
		}
		const svg = toSvg(placedWords, layoutOptions);
		setSvgHtml(svg);
	}, [placedWords, layoutOptions]);

	if (isLoading) {
		return (
			<div className="flex h-[360px] w-full flex-col items-center justify-center rounded-lg border bg-card p-6 text-center shadow-sm">
				<div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
				<p className="mt-4 text-sm text-muted-foreground">
					テキストを解析しワードクラウドを生成中...
				</p>
			</div>
		);
	}

	if (placedWords.length === 0) {
		return (
			<div className="flex h-[360px] w-full flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center text-muted-foreground">
				<p className="text-base font-medium">ワードクラウドが表示されます</p>
				<p className="mt-1 text-xs">
					上のエリアにテキストを入力するかファイルを読み込んで解析を開始してください
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center rounded-lg border bg-card p-4 shadow-sm overflow-hidden">
			<div
				className="w-full flex justify-center items-center overflow-auto max-h-[500px]"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: SVG sanitized during generation
				dangerouslySetInnerHTML={{ __html: svgHtml }}
			/>
		</div>
	);
}
