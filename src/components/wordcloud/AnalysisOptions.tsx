import { Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type {
	AnalyzeOptions,
	WordCloudLayoutOptions,
} from '@/lib/tools/wordcloud/index.ts';

interface AnalysisOptionsProps {
	options: AnalyzeOptions;
	layoutOptions: WordCloudLayoutOptions;
	onOptionsChange: (newOptions: AnalyzeOptions) => void;
	onLayoutOptionsChange: (newLayoutOptions: WordCloudLayoutOptions) => void;
	disabled?: boolean;
}

export function AnalysisOptions({
	options,
	layoutOptions,
	onOptionsChange,
	onLayoutOptionsChange,
	disabled,
}: AnalysisOptionsProps) {
	const [rawStopwords, setRawStopwords] = useState<string>(
		(options.customStopwords || []).join(', '),
	);

	const handleCustomStopwordsChange = (val: string) => {
		setRawStopwords(val);
		const list = val
			.split(/[,、\n]/)
			.map((s) => s.trim())
			.filter(Boolean);
		onOptionsChange({ ...options, customStopwords: list });
	};

	return (
		<div className="space-y-6 rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
			<h3 className="font-semibold text-base">解析・描画オプション</h3>

			<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
				{/* フィルタ・ストップワード設定 */}
				<div className="space-y-4">
					<h4 className="font-medium text-sm text-muted-foreground">
						抽出・単語フィルタ
					</h4>

					<div className="flex items-center justify-between">
						<Label htmlFor="use-stopwords" className="text-sm cursor-pointer">
							標準ストップワード（助詞・機能語等）を除外
						</Label>
						<Switch
							id="use-stopwords"
							checked={options.useStopwords}
							onCheckedChange={(checked: boolean) =>
								onOptionsChange({ ...options, useStopwords: checked })
							}
							disabled={disabled}
						/>
					</div>

					<div className="space-y-1.5">
						<Label
							htmlFor="custom-stopwords"
							className="text-xs text-muted-foreground"
						>
							ユーザー指定の除外語（カンマまたは改行区切り）
						</Label>
						<Input
							id="custom-stopwords"
							placeholder="例: 株式会社, テスト, 連絡"
							value={rawStopwords}
							onChange={(e) => handleCustomStopwordsChange(e.target.value)}
							disabled={disabled}
							className="text-xs"
						/>
					</div>

					<div className="grid grid-cols-2 gap-3 pt-2">
						<div className="space-y-1.5">
							<Label htmlFor="min-count" className="text-xs">
								最小出現回数
							</Label>
							<Select
								value={String(options.minCount)}
								onValueChange={(val) =>
									onOptionsChange({ ...options, minCount: Number(val) })
								}
								disabled={disabled}
							>
								<SelectTrigger id="min-count" className="h-8 text-xs">
									<SelectValue placeholder="選択" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="1">1回以上</SelectItem>
									<SelectItem value="2">2回以上</SelectItem>
									<SelectItem value="3">3回以上</SelectItem>
									<SelectItem value="5">5回以上</SelectItem>
									<SelectItem value="10">10回以上</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="max-words" className="text-xs">
								最大表示語数
							</Label>
							<Select
								value={String(options.maxWords)}
								onValueChange={(val) =>
									onOptionsChange({ ...options, maxWords: Number(val) })
								}
								disabled={disabled}
							>
								<SelectTrigger id="max-words" className="h-8 text-xs">
									<SelectValue placeholder="選択" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="30">30語</SelectItem>
									<SelectItem value="50">50語</SelectItem>
									<SelectItem value="100">100語</SelectItem>
									<SelectItem value="150">150語</SelectItem>
									<SelectItem value="200">200語</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>

				{/* デザイン・レイアウト設定 */}
				<div className="space-y-4">
					<h4 className="font-medium text-sm text-muted-foreground">
						デザイン・レイアウト
					</h4>

					<div className="grid grid-cols-3 gap-3">
						<div className="space-y-1.5">
							<Label htmlFor="scale-type" className="text-xs">
								文字スケール
							</Label>
							<Select
								value={layoutOptions.scale}
								onValueChange={(val) =>
									onLayoutOptionsChange({
										...layoutOptions,
										scale: val as WordCloudLayoutOptions['scale'],
									})
								}
								disabled={disabled}
							>
								<SelectTrigger id="scale-type" className="h-8 text-xs">
									<SelectValue placeholder="選択" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="sqrt">Square Root</SelectItem>
									<SelectItem value="linear">Linear</SelectItem>
									<SelectItem value="log">Logarithmic</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="rotation-type" className="text-xs">
								回転角度
							</Label>
							<Select
								value={layoutOptions.rotation}
								onValueChange={(val) =>
									onLayoutOptionsChange({
										...layoutOptions,
										rotation: val as WordCloudLayoutOptions['rotation'],
									})
								}
								disabled={disabled}
							>
								<SelectTrigger id="rotation-type" className="h-8 text-xs">
									<SelectValue placeholder="選択" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="orthogonal">縦横 (0/90°)</SelectItem>
									<SelectItem value="none">横のみ (0°)</SelectItem>
									<SelectItem value="random">ランダム</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="palette-type" className="text-xs">
								配色テーマ
							</Label>
							<Select
								value={layoutOptions.palette}
								onValueChange={(val) =>
									onLayoutOptionsChange({ ...layoutOptions, palette: val })
								}
								disabled={disabled}
							>
								<SelectTrigger id="palette-type" className="h-8 text-xs">
									<SelectValue placeholder="選択" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="tableau10">Tableau (標準)</SelectItem>
									<SelectItem value="category10">Category 10</SelectItem>
									<SelectItem value="dark2">Dark 2</SelectItem>
									<SelectItem value="accent">Accent</SelectItem>
									<SelectItem value="paired">Paired</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="rounded border border-dashed p-2.5 text-xs text-muted-foreground bg-muted/30">
						<p className="flex items-center gap-1 font-semibold text-foreground">
							<Lightbulb className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
							モード補足
						</p>
						<p className="mt-1">
							現在「かんたんモード
							(TinySegmenter)」で動作中です。品詞タグが付与されないため品詞フィルタは利用できませんが、完全にクライアントサイド即座に解析されます。
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
