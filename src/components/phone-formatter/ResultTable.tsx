/**
 * 一括変換結果テーブルコンポーネント
 * カラム表示切替・ページネーション・無効行ハイライト
 */

import { CheckCircle2, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { getNumberTypeLabel } from '@/lib/phone-formatter/classify';
import type { BulkResult, ParseResult } from '@/lib/phone-formatter/types';

interface ResultTableProps {
	results: ParseResult[];
	summary: BulkResult['summary'];
	visibleColumns: string[];
	onVisibleColumnsChange: (columns: string[]) => void;
}

const COLUMNS = [
	{ id: '#', label: '#' },
	{ id: 'input', label: '入力' },
	{ id: 'e164', label: 'E.164' },
	{ id: 'international', label: '国際表記' },
	{ id: 'national', label: '国内表記' },
	{ id: 'type', label: '種別' },
	{ id: 'region', label: '地域' },
	{ id: 'status', label: '状態' },
];

const PAGE_SIZE = 100;

export default function ResultTable({
	results,
	summary,
	visibleColumns,
	onVisibleColumnsChange,
}: ResultTableProps) {
	const [page, setPage] = useState(1);

	const totalPages = Math.ceil(results.length / PAGE_SIZE);
	const pageResults = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

	const toggleColumn = (colId: string) => {
		if (colId === '#' || colId === 'status') return; // # と状態は必須
		if (visibleColumns.includes(colId)) {
			onVisibleColumnsChange(visibleColumns.filter((c) => c !== colId));
		} else {
			// COLUMNS順を維持
			const ordered = COLUMNS.map((c) => c.id).filter(
				(id) => visibleColumns.includes(id) || id === colId,
			);
			onVisibleColumnsChange(ordered);
		}
	};

	const getCellValue = (result: ParseResult, colId: string) => {
		switch (colId) {
			case 'input':
				return result.input;
			case 'e164':
				return result.formats?.e164 ?? '';
			case 'international':
				return result.formats?.international ?? '';
			case 'national':
				return result.formats?.national ?? '';
			case 'type':
				return result.valid ? getNumberTypeLabel(result.numberType) : '';
			case 'region':
				return result.regionName ?? '';
			default:
				return '';
		}
	};

	return (
		<div className="space-y-4">
			{/* サマリーバー */}
			<section
				className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-4 py-3"
				aria-label="変換結果サマリー"
			>
				<span className="text-sm">
					<span className="font-semibold text-green-600 dark:text-green-400">
						有効: {summary.valid.toLocaleString()}件
					</span>
				</span>
				<span className="text-sm">
					<span className="font-semibold text-red-600 dark:text-red-400">
						無効: {summary.invalid.toLocaleString()}件
					</span>
				</span>
				<span className="text-sm text-muted-foreground">
					合計: {summary.total.toLocaleString()}件
				</span>
			</section>

			{/* カラム表示切替 */}
			<fieldset
				className="flex flex-wrap items-center gap-2"
				aria-label="表示カラムの選択"
			>
				<span className="text-xs text-muted-foreground">表示カラム:</span>
				{COLUMNS.map((col) => {
					const isRequired = col.id === '#' || col.id === 'status';
					const isChecked = visibleColumns.includes(col.id);
					return (
						<label
							key={col.id}
							className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border cursor-pointer transition-colors ${
								isChecked
									? 'border-primary bg-primary/5 text-primary'
									: 'border-border text-muted-foreground hover:border-primary/50'
							} ${isRequired ? 'opacity-60 cursor-not-allowed' : ''}`}
						>
							<input
								type="checkbox"
								checked={isChecked}
								onChange={() => toggleColumn(col.id)}
								disabled={isRequired}
								className="sr-only"
								aria-label={`${col.label}カラムを表示`}
							/>
							{col.label}
						</label>
					);
				})}
			</fieldset>

			{/* テーブル */}
			<div className="overflow-x-auto rounded-xl border border-border">
				<table className="w-full text-sm" aria-label="変換結果一覧">
					<thead>
						<tr className="bg-muted/50">
							{COLUMNS.filter((c) => visibleColumns.includes(c.id)).map(
								(col) => (
									<th
										key={col.id}
										scope="col"
										className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap"
									>
										{col.label}
									</th>
								),
							)}
						</tr>
					</thead>
					<tbody>
						{pageResults.map((result, index) => {
							const rowIndex = (page - 1) * PAGE_SIZE + index + 1;
							return (
								<tr
									key={rowIndex}
									className={`border-t border-border transition-colors ${
										!result.valid
											? 'bg-red-50/50 dark:bg-red-950/20'
											: 'hover:bg-muted/20'
									}`}
								>
									{visibleColumns.includes('#') && (
										<td className="px-3 py-2 text-xs text-muted-foreground font-mono">
											{rowIndex}
										</td>
									)}
									{COLUMNS.filter(
										(c) =>
											c.id !== '#' &&
											c.id !== 'status' &&
											visibleColumns.includes(c.id),
									).map((col) => (
										<td key={col.id} className="px-3 py-2 font-mono text-xs">
											{getCellValue(result, col.id)}
										</td>
									))}
									{visibleColumns.includes('status') && (
										<td className="px-3 py-2 text-xs">
											{result.valid ? (
												<span className="inline-flex text-green-600 dark:text-green-400 font-medium">
													<CheckCircle2 className="h-4 w-4" aria-label="有効" />
												</span>
											) : (
												<span
													className="inline-flex text-red-600 dark:text-red-400 font-medium"
													title={result.error}
												>
													<XCircle className="h-4 w-4" aria-label="無効" />
												</span>
											)}
										</td>
									)}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>

			{/* ページネーション */}
			{totalPages > 1 && (
				<nav
					className="flex items-center justify-between"
					aria-label="ページネーション"
				>
					<span className="text-xs text-muted-foreground">
						{((page - 1) * PAGE_SIZE + 1).toLocaleString()}〜
						{Math.min(page * PAGE_SIZE, results.length).toLocaleString()}件（全
						{results.length.toLocaleString()}件）
					</span>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => setPage((p) => Math.max(1, p - 1))}
							disabled={page === 1}
							aria-label="前のページ"
						>
							<ChevronLeft className="h-4 w-4" />
						</Button>
						<span className="text-sm">
							{page} / {totalPages}
						</span>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
							disabled={page === totalPages}
							aria-label="次のページ"
						>
							<ChevronRight className="h-4 w-4" />
						</Button>
					</div>
				</nav>
			)}
		</div>
	);
}
