// BulkConvertPanel — Excel列の貼り付け（1行1郵便番号）→ 一括変換 → CSVダウンロード

import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import Papa from 'papaparse';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { downloadBlob } from '@/lib/tools/image-common';
import { buildCsvBlob } from '@/lib/tools/json-csv';
import {
	type BulkResult,
	bulkConvert,
	MAX_BULK_LINES,
} from '@/lib/tools/zipcode';
import { fetchZipChunk } from './fetchChunk';

const CSV_HEADER = ['入力', '郵便番号', '都道府県', '市区町村', '町域', '備考'];
const MAX_TABLE_ROWS = 1000;

function remarkOf(r: BulkResult): string {
	if (r.error === 'format-error') return '形式エラー';
	if (r.error === 'not-found') return '該当なし';
	if (r.error === 'fetch-error') return 'ネットワークエラー';
	if (r.candidates && r.candidates > 1) return `他${r.candidates - 1}件`;
	return '';
}

function toCsvRow(r: BulkResult): string[] {
	return [
		r.input,
		r.zip ?? '',
		r.prefecture ?? '',
		r.city ?? '',
		r.town ?? '',
		remarkOf(r),
	];
}

export function BulkConvertPanel() {
	const [text, setText] = useState('');
	const [results, setResults] = useState<BulkResult[] | null>(null);
	const [converting, setConverting] = useState(false);
	const [progress, setProgress] = useState({ done: 0, total: 0 });

	const lineCount =
		text === '' ? 0 : text.split(/\r?\n/).filter(Boolean).length;
	const overLimit = lineCount > MAX_BULK_LINES;

	const handleConvert = useCallback(async () => {
		const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
		if (lines.length === 0 || lines.length > MAX_BULK_LINES) return;
		setConverting(true);
		setResults(null);
		setProgress({ done: 0, total: lines.length });
		try {
			const out = await bulkConvert(
				lines,
				fetchZipChunk,
				async (done, total) => {
					setProgress({ done, total });
					// 1,000行ごとにイベントループへ yield して UI フリーズを防ぐ
					await new Promise((resolve) => setTimeout(resolve, 0));
				},
			);
			setResults(out);
		} finally {
			setConverting(false);
		}
	}, [text]);

	const handleDownloadCsv = useCallback(() => {
		if (!results) return;
		const csv = Papa.unparse([CSV_HEADER, ...results.map(toCsvRow)]);
		downloadBlob(buildCsvBlob(csv, true), 'zipcode_converted.csv');
	}, [results]);

	const successCount = results?.filter((r) => r.zip && !r.error).length ?? 0;

	return (
		<div className="space-y-4">
			<div>
				<Textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder={
						'郵便番号を1行に1件貼り付け（Excelの列をそのままコピー可）\n例:\n100-0001\n0600000'
					}
					className="min-h-40 font-mono"
					aria-label="一括変換する郵便番号"
					disabled={converting}
				/>
				<div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
					<span>
						{lineCount.toLocaleString()} 行
						{overLimit && (
							<span className="ml-2 text-destructive">
								（上限 {MAX_BULK_LINES.toLocaleString()} 行を超えています）
							</span>
						)}
					</span>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<Button
					onClick={handleConvert}
					disabled={converting || lineCount === 0 || overLimit}
				>
					{converting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
					<span className="ml-1">住所に変換</span>
				</Button>
				{results && (
					<Button variant="outline" onClick={handleDownloadCsv}>
						<Download className="h-4 w-4" />
						<span className="ml-1">CSVダウンロード（BOM付きUTF-8）</span>
					</Button>
				)}
			</div>

			{converting && (
				<div className="space-y-2" aria-live="polite">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin text-primary" />
						<span>
							変換中… {progress.done.toLocaleString()} /{' '}
							{progress.total.toLocaleString()}
						</span>
					</div>
					<div
						className="h-2 w-full overflow-hidden rounded-full bg-muted"
						role="progressbar"
						aria-valuenow={progress.done}
						aria-valuemin={0}
						aria-valuemax={progress.total}
					>
						<div
							className="h-full rounded-full bg-primary transition-all duration-200"
							style={{
								width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
							}}
						/>
					</div>
				</div>
			)}

			{results && (
				<div className="space-y-2">
					<p className="text-sm text-muted-foreground">
						{results.length.toLocaleString()} 行中{' '}
						{successCount.toLocaleString()} 件を変換しました。
					</p>
					<div className="overflow-x-auto rounded-lg border border-border">
						<Table>
							<TableHeader>
								<TableRow>
									{CSV_HEADER.map((h) => (
										<TableHead key={h} className="whitespace-nowrap">
											{h}
										</TableHead>
									))}
								</TableRow>
							</TableHeader>
							<TableBody>
								{results.slice(0, MAX_TABLE_ROWS).map((r, i) => {
									const remark = remarkOf(r);
									return (
										// biome-ignore lint/suspicious/noArrayIndexKey: 入力行は重複しうるため index で一意化（変換後は並び替わらない）
										<TableRow key={`${r.input}-${i}`}>
											<TableCell className="font-mono">{r.input}</TableCell>
											<TableCell className="font-mono">{r.zip ?? ''}</TableCell>
											<TableCell>{r.prefecture ?? ''}</TableCell>
											<TableCell>{r.city ?? ''}</TableCell>
											<TableCell>{r.town ?? ''}</TableCell>
											<TableCell
												className={
													r.error
														? 'text-destructive whitespace-nowrap'
														: 'text-muted-foreground whitespace-nowrap'
												}
											>
												{remark}
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>
					{results.length > MAX_TABLE_ROWS && (
						<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
							表示は先頭 {MAX_TABLE_ROWS.toLocaleString()} 件までです（全
							{results.length.toLocaleString()} 件はCSVに出力されます）。
						</p>
					)}
				</div>
			)}
		</div>
	);
}
