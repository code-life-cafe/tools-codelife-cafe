// ExportBar — 画像エクスポートの共有コンポーネント
// 形式選択（PNG/JPEG）+ JPEG品質スライダー + ダウンロードボタン。
// ダウンロード時に getCanvas() で最新のレンダー結果を取得することで
// 「プレビュー＝エクスポート」の単一ソースを保証する

import { Download } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
	buildExportFilename,
	DEFAULT_JPEG_QUALITY,
	downloadBlob,
	type ExportFormat,
	exportCanvas,
} from '@/lib/tools/image-common';

type ExportBarProps = {
	/** ダウンロード時に呼ばれ、エクスポート対象の Canvas を返す */
	getCanvas: () => HTMLCanvasElement | null;
	/** 元ファイル名（`{basename}_edited.{ext}` の生成に使用） */
	baseName: string;
	disabled?: boolean;
};

export function ExportBar({ getCanvas, baseName, disabled }: ExportBarProps) {
	const [format, setFormat] = useState<ExportFormat>('png');
	const [quality, setQuality] = useState(DEFAULT_JPEG_QUALITY);
	const [error, setError] = useState<string | null>(null);

	const handleDownload = useCallback(async () => {
		const canvas = getCanvas();
		if (!canvas) return;
		setError(null);
		try {
			const blob = await exportCanvas(canvas, { format, quality });
			downloadBlob(blob, buildExportFilename(baseName, format));
		} catch (err) {
			setError(
				err instanceof Error ? err.message : '画像の書き出しに失敗しました',
			);
		}
	}, [getCanvas, baseName, format, quality]);

	return (
		<div className="flex flex-wrap items-end gap-4 rounded-xl border border-border p-4">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="export-format" className="text-xs">
					形式
				</Label>
				<Select
					value={format}
					onValueChange={(value) => setFormat(value as ExportFormat)}
				>
					<SelectTrigger id="export-format" className="w-28">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="png">PNG</SelectItem>
						<SelectItem value="jpeg">JPEG</SelectItem>
					</SelectContent>
				</Select>
			</div>
			{format === 'jpeg' && (
				<div className="flex w-44 flex-col gap-1.5">
					<Label htmlFor="export-quality" className="text-xs">
						品質: {Math.round(quality * 100)}%
					</Label>
					<Slider
						id="export-quality"
						min={0.1}
						max={1}
						step={0.01}
						value={[quality]}
						onValueChange={([value]) => setQuality(value)}
					/>
				</div>
			)}
			<Button onClick={handleDownload} disabled={disabled} className="ml-auto">
				<Download className="h-4 w-4" />
				ダウンロード
			</Button>
			{error && (
				<p className="w-full text-sm text-destructive" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}
