import { AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import type { PreviewResult } from '@/lib/csv/types';

interface CsvPreviewProps {
	preview: PreviewResult | null;
	isLoading: boolean;
}

export function CsvPreview({ preview, isLoading }: CsvPreviewProps) {
	if (isLoading) {
		return (
			<Card className="w-full">
				<CardContent className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-4">
					<Loader2 className="w-8 h-8 animate-spin" />
					<p role="status" className="text-sm">
						2/2 プレビューを解析中...
					</p>
				</CardContent>
			</Card>
		);
	}

	if (!preview) {
		return null;
	}

	let hasMojibake = false;
	if (preview.rows.length > 0) {
		const textSample = preview.rows
			.slice(0, 5)
			.map((r) => r.join(' '))
			.join(' ');
		const replacementRatio =
			(textSample.match(/\uFFFD/g) || []).length /
			Math.max(textSample.length, 1);
		if (replacementRatio > 0.05) hasMojibake = true;
	}

	const { headers, rows, totalRowEstimate } = preview;
	const isTruncated = totalRowEstimate > rows.length + (headers ? 1 : 0);

	return (
		<Card className="w-full shadow-sm overflow-hidden flex flex-col">
			<CardHeader className="pb-3 border-b bg-muted/20 shrink-0">
				<CardTitle className="text-sm font-medium flex items-center justify-between">
					<span>プレビュー</span>
					<span
						role="status"
						className="text-xs font-normal text-muted-foreground"
					>
						解析完了
					</span>
					<span className="text-xs font-normal text-muted-foreground">
						{isTruncated
							? `先頭 ${headers ? rows.length + 1 : rows.length}行を表示中（全 ${totalRowEstimate} 行）`
							: `全 ${totalRowEstimate} 行`}
					</span>
				</CardTitle>
			</CardHeader>

			<CardContent className="p-0 flex flex-col overflow-hidden relative">
				{hasMojibake && (
					<div className="absolute top-0 inset-x-0 z-10 flex items-center justify-center p-2 bg-destructive/90 text-destructive-foreground text-xs shadow-md">
						<AlertCircle className="w-4 h-4 mr-2" />
						<span>
							プレビューに文字化けが見つかりました。エンコーディングの選択を確認してください。
						</span>
					</div>
				)}

				<div className="overflow-auto border-b" style={{ maxHeight: '400px' }}>
					<Table className="whitespace-nowrap text-xs">
						{headers && (
							<TableHeader className="bg-muted/50 sticky top-0 z-0">
								<TableRow>
									<TableHead className="w-10 text-center sticky left-0 bg-muted/80 z-10 before:absolute before:inset-y-0 before:right-0 before:w-px before:bg-border">
										行
									</TableHead>
									{Array.from(headers.entries()).map(([i, h]) => (
										<TableHead
											key={`th-${i}`}
											className="max-w-[200px] truncate"
										>
											{h}
										</TableHead>
									))}
								</TableRow>
							</TableHeader>
						)}
						<TableBody>
							{Array.from(rows.entries()).map(([rowIndex, row]) => (
								<TableRow
									key={`row-${rowIndex}`}
									className="border-b last:border-0 hover:bg-muted/30"
								>
									<TableCell className="w-10 text-center text-muted-foreground sticky left-0 bg-background/95 z-0 before:absolute before:inset-y-0 before:right-0 before:w-px before:bg-border">
										{rowIndex + (headers ? 2 : 1)}
									</TableCell>
									{Array.from(row.entries()).map(([colIndex, cell]) => (
										<TableCell
											key={`cell-${colIndex}`}
											className="max-w-[300px] truncate py-2"
											title={cell}
										>
											{cell}
										</TableCell>
									))}
								</TableRow>
							))}
							{rows.length === 0 && (
								<TableRow>
									<TableCell
										colSpan={headers ? headers.length + 1 : 2}
										className="h-24 text-center text-muted-foreground"
									>
										データがありません
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			</CardContent>
		</Card>
	);
}
