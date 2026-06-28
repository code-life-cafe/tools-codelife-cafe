import { Download, PieChart } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {
	type Aggregation,
	buildChartSvg,
	type ChartSpec,
	type ChartType,
	type Column,
	validateChartSpec,
} from '@/lib/tools/chart-render';

interface ChartPanelProps {
	rows: string[][];
	displayIndices: number[];
	columns: Column[];
}

export function ChartPanel({ rows, displayIndices, columns }: ChartPanelProps) {
	const [chartType, setChartType] = useState<ChartType>('bar');
	const [categoryCol, setCategoryCol] = useState<string>(columns[0]?.id ?? '');
	const [valueCols, setValueCols] = useState<string[]>(
		columns[1]?.id ? [columns[1].id] : [],
	);
	const [xCol, setXCol] = useState<string>(columns[0]?.id ?? '');
	const [yCol, setYCol] = useState<string>(columns[1]?.id ?? '');
	const [aggregation, setAggregation] = useState<Aggregation>('sum');
	const [isDark, setIsDark] = useState<boolean>(false);

	const containerRef = useRef<HTMLDivElement>(null);
	const [dimensions, setDimensions] = useState({ width: 600, height: 400 });

	// 列変更時のデフォルト同期
	useEffect(() => {
		if (columns.length > 0) {
			if (!categoryCol) setCategoryCol(columns[0].id);
			if (!xCol) setXCol(columns[0].id);
			if (valueCols.length === 0 && columns[1]) setValueCols([columns[1].id]);
			if (!yCol && columns[1]) setYCol(columns[1].id);
		}
	}, [columns, categoryCol, xCol, valueCols, yCol]);

	// ダークモード自動検知
	useEffect(() => {
		const isDarkMode = document.documentElement.classList.contains('dark');
		setIsDark(isDarkMode);
	}, []);

	// レスポンシブ幅調整
	useEffect(() => {
		if (!containerRef.current) return;
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const w = Math.max(300, Math.floor(entry.contentRect.width));
				setDimensions({ width: w, height: Math.min(500, Math.floor(w * 0.6)) });
			}
		});
		observer.observe(containerRef.current);
		return () => observer.disconnect();
	}, []);

	const spec: ChartSpec = {
		type: chartType,
		categoryColumn: categoryCol,
		valueColumns: valueCols,
		aggregation,
		xColumn: xCol,
		yColumn: yCol,
	};

	const displayRows = displayIndices.map((idx) => rows[idx]).filter(Boolean);
	const err = validateChartSpec(spec);
	const svgString = err
		? ''
		: buildChartSvg(displayRows, columns, spec, {
				dark: isDark,
				width: dimensions.width,
				height: dimensions.height,
			});

	const toggleValueCol = (colId: string) => {
		if (chartType === 'pie') {
			setValueCols([colId]);
		} else {
			if (valueCols.includes(colId)) {
				setValueCols(valueCols.filter((id) => id !== colId));
			} else {
				setValueCols([...valueCols, colId]);
			}
		}
	};

	const handleDownloadSvg = () => {
		if (!svgString) return;
		const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `chart-${chartType}.svg`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const handleDownloadPng = () => {
		if (!svgString) return;
		const img = new Image();
		const svgBlob = new Blob([svgString], {
			type: 'image/svg+xml;charset=utf-8',
		});
		const url = URL.createObjectURL(svgBlob);

		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = dimensions.width * 2; // 2x高解像度
			canvas.height = dimensions.height * 2;
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.scale(2, 2);
				if (isDark) {
					ctx.fillStyle = '#0f172a';
					ctx.fillRect(0, 0, dimensions.width, dimensions.height);
				}
				ctx.drawImage(img, 0, 0);
				canvas.toBlob((pngBlob) => {
					if (!pngBlob) return;
					const pngUrl = URL.createObjectURL(pngBlob);
					const a = document.createElement('a');
					a.href = pngUrl;
					a.download = `chart-${chartType}.png`;
					document.body.appendChild(a);
					a.click();
					document.body.removeChild(a);
					URL.revokeObjectURL(pngUrl);
				}, 'image/png');
			}
			URL.revokeObjectURL(url);
		};
		img.src = url;
	};

	return (
		<div className="space-y-6">
			{/* コントロールパネル */}
			<div className="bg-muted/20 p-4 rounded-xl border space-y-4">
				<div className="flex items-center gap-2 border-b pb-3">
					<PieChart className="h-4 w-4 text-primary" />
					<h3 className="text-sm font-semibold">グラフ設定</h3>
					<span className="text-xs text-muted-foreground ml-auto">
						表示中: {displayRows.length} 行
					</span>
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
					{/* グラフ種別 */}
					<div>
						<Label className="text-xs mb-1 block">グラフ種別</Label>
						<Select
							value={chartType}
							onValueChange={(v: ChartType) => {
								setChartType(v);
								if (v === 'pie' && valueCols.length > 1) {
									setValueCols([valueCols[0]]);
								}
							}}
						>
							<SelectTrigger className="h-8">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="bar">棒グラフ (縦)</SelectItem>
								<SelectItem value="line">折れ線グラフ</SelectItem>
								<SelectItem value="pie">円グラフ</SelectItem>
								<SelectItem value="scatter">散布図</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{chartType === 'scatter' ? (
						<>
							{/* X軸 */}
							<div>
								<Label className="text-xs mb-1 block">X軸 (数値列)</Label>
								<Select value={xCol} onValueChange={setXCol}>
									<SelectTrigger className="h-8">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{columns.map((c) => (
											<SelectItem key={c.id} value={c.id}>
												{c.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							{/* Y軸 */}
							<div>
								<Label className="text-xs mb-1 block">Y軸 (数値列)</Label>
								<Select value={yCol} onValueChange={setYCol}>
									<SelectTrigger className="h-8">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{columns.map((c) => (
											<SelectItem key={c.id} value={c.id}>
												{c.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</>
					) : (
						<>
							{/* カテゴリ軸 */}
							<div>
								<Label className="text-xs mb-1 block">カテゴリ列 (X軸)</Label>
								<Select value={categoryCol} onValueChange={setCategoryCol}>
									<SelectTrigger className="h-8">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{columns.map((c) => (
											<SelectItem key={c.id} value={c.id}>
												{c.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							{/* 集計オプション */}
							<div>
								<Label className="text-xs mb-1 block">集計モード</Label>
								<Select
									value={aggregation}
									onValueChange={(v: Aggregation) => setAggregation(v)}
								>
									<SelectTrigger className="h-8">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">なし (生値)</SelectItem>
										<SelectItem value="sum">合計 (Sum)</SelectItem>
										<SelectItem value="avg">平均 (Average)</SelectItem>
										<SelectItem value="count">件数 (Count)</SelectItem>
										<SelectItem value="min">最小値 (Min)</SelectItem>
										<SelectItem value="max">最大値 (Max)</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</>
					)}
				</div>

				{/* 値軸列選択 (scatter以外) */}
				{chartType !== 'scatter' && (
					<div>
						<Label className="text-xs mb-1.5 block">
							値列 (Y軸) {chartType === 'pie' && '(1つのみ選択可)'}:
						</Label>
						<div className="flex flex-wrap gap-3 bg-background p-2 rounded-lg border">
							{columns.map((c) => (
								<div key={c.id} className="flex items-center gap-1.5 text-xs">
									<Checkbox
										id={`val-${c.id}`}
										checked={valueCols.includes(c.id)}
										onCheckedChange={() => toggleValueCol(c.id)}
									/>
									<Label
										htmlFor={`val-${c.id}`}
										className="cursor-pointer font-normal"
									>
										{c.name}
									</Label>
								</div>
							))}
						</div>
					</div>
				)}
			</div>

			{/* プレビュー & ダウンロード */}
			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<Label className="text-sm font-semibold">グラフプレビュー</Label>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={handleDownloadSvg}
							disabled={!svgString}
							className="h-8 text-xs"
						>
							<Download className="h-3.5 w-3.5 mr-1" /> SVG ダウンロード
						</Button>
						<Button
							variant="default"
							size="sm"
							onClick={handleDownloadPng}
							disabled={!svgString}
							className="h-8 text-xs"
						>
							<Download className="h-3.5 w-3.5 mr-1" /> PNG ダウンロード
						</Button>
					</div>
				</div>

				{err ? (
					<div className="p-8 border rounded-xl bg-card text-center text-red-500 text-sm">
						{err}
					</div>
				) : (
					<div
						ref={containerRef}
						className="p-4 border rounded-xl bg-card flex items-center justify-center min-h-[350px] overflow-hidden"
						// biome-ignore lint/security/noDangerouslySetInnerHtml: internal SVG string generation
						dangerouslySetInnerHTML={{ __html: svgString }}
					/>
				)}
			</div>
		</div>
	);
}
