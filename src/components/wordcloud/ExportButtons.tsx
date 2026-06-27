import { FileCode, FileSpreadsheet, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
	PlacedWord,
	WordCloudLayoutOptions,
	WordFrequency,
} from '@/lib/tools/wordcloud/index.ts';
import { toCsv, toSvg } from '@/lib/tools/wordcloud/index.ts';

interface ExportButtonsProps {
	frequencies: WordFrequency[];
	placedWords: PlacedWord[];
	layoutOptions: WordCloudLayoutOptions;
	disabled?: boolean;
}

function getFormattedTimestamp(): string {
	const now = new Date();
	const yyyy = now.getFullYear();
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	const dd = String(now.getDate()).padStart(2, '0');
	const hh = String(now.getHours()).padStart(2, '0');
	const min = String(now.getMinutes()).padStart(2, '0');
	return `${yyyy}${mm}${dd}-${hh}${min}`;
}

export function ExportButtons({
	frequencies,
	placedWords,
	layoutOptions,
	disabled,
}: ExportButtonsProps) {
	const hasData = frequencies.length > 0 && placedWords.length > 0;

	const handleDownloadCsv = () => {
		const csvContent = toCsv(frequencies);
		const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `wordcloud-${getFormattedTimestamp()}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const handleDownloadSvg = () => {
		const svgContent = toSvg(placedWords, layoutOptions);
		const blob = new Blob([svgContent], {
			type: 'image/svg+xml;charset=utf-8;',
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `wordcloud-${getFormattedTimestamp()}.svg`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const handleDownloadPng = () => {
		const svgContent = toSvg(placedWords, layoutOptions);
		const blob = new Blob([svgContent], {
			type: 'image/svg+xml;charset=utf-8;',
		});
		const url = URL.createObjectURL(blob);

		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = layoutOptions.width;
			canvas.height = layoutOptions.height;
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.drawImage(img, 0, 0);
				canvas.toBlob((pngBlob) => {
					if (pngBlob) {
						const pngUrl = URL.createObjectURL(pngBlob);
						const a = document.createElement('a');
						a.href = pngUrl;
						a.download = `wordcloud-${getFormattedTimestamp()}.png`;
						document.body.appendChild(a);
						a.click();
						document.body.removeChild(a);
						URL.revokeObjectURL(pngUrl);
					}
				}, 'image/png');
			}
			URL.revokeObjectURL(url);
		};
		img.src = url;
	};

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm">
			<div>
				<h4 className="font-semibold text-sm">結果のエクスポート</h4>
				<p className="text-xs text-muted-foreground">
					画像（PNG/SVG）または頻度一覧（CSV）として保存できます
				</p>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={handleDownloadPng}
					disabled={disabled || !hasData}
					className="h-9 gap-1.5 text-xs font-medium"
				>
					<ImageIcon className="h-4 w-4 text-blue-500" />
					PNG ダウンロード
				</Button>

				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={handleDownloadSvg}
					disabled={disabled || !hasData}
					className="h-9 gap-1.5 text-xs font-medium"
				>
					<FileCode className="h-4 w-4 text-purple-500" />
					SVG ダウンロード
				</Button>

				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={handleDownloadCsv}
					disabled={disabled || !frequencies.length}
					className="h-9 gap-1.5 text-xs font-medium"
				>
					<FileSpreadsheet className="h-4 w-4 text-emerald-500" />
					CSV ダウンロード
				</Button>
			</div>
		</div>
	);
}
