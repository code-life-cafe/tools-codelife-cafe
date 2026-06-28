import {
	Braces,
	Copy,
	Download,
	FileSpreadsheet,
	Filter,
	PieChart,
	Plus,
	RotateCcw,
	Table,
	Trash2,
	Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChartPanel } from '@/components/csv-editor/ChartPanel';
import { FilterPanel } from '@/components/csv-editor/FilterPanel';
import { SheetPicker } from '@/components/csv-editor/SheetPicker';
import { SortPanel } from '@/components/csv-editor/SortPanel';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
	type CsvData,
	exportCsv,
	getColumnLabel,
	parseCsv,
} from '@/lib/tools/csv-editor';
import {
	type Column,
	type FilterGroup,
	inferColumnType,
	queryRows,
	type SortKey,
} from '@/lib/tools/table-query';
import {
	isDecompressionStreamSupported,
	parseXlsx,
	type SheetData,
} from '@/lib/tools/xlsx-reader';

const ROWS_PER_PAGE = 50;

export default function CsvEditor() {
	const [activeTab, setActiveTab] = useState('input');
	const [inputText, setInputText] = useState('');
	const [delimiter, setDelimiter] = useState(',');
	const [hasHeader, setHasHeader] = useState(true);

	// Multi-sheet XLSX support
	const [sheets, setSheets] = useState<SheetData[]>([]);
	const [activeSheetIdx, setActiveSheetIdx] = useState(0);

	// Source of truth table data
	const [csvData, setCsvData] = useState<CsvData | null>(null);
	const [error, setError] = useState<string>('');
	const [currentPage, setCurrentPage] = useState(1);

	// Query pipeline states
	const [filterGroup, setFilterGroup] = useState<FilterGroup>({
		combinator: 'and',
		conditions: [],
	});
	const [sortKeys, setSortKeys] = useState<SortKey[]>([]);

	// Undo stack for row/cell edits only
	const [undoStack, setUndoStack] = useState<string[][][]>([]);

	const fileInputRef = useRef<HTMLInputElement>(null);

	// Columns definition with type inference
	const columns: Column[] = useMemo(() => {
		if (!csvData || csvData.colCount === 0) return [];
		const result: Column[] = [];
		const headerRow =
			hasHeader && csvData.rows.length > 0 ? csvData.rows[0] : null;
		const sampleRows = hasHeader ? csvData.rows.slice(1) : csvData.rows;

		for (let c = 0; c < csvData.colCount; c++) {
			const colId = `c${c}`;
			const name =
				headerRow?.[c] && headerRow[c].trim() !== ''
					? headerRow[c]
					: `列 ${getColumnLabel(c)}`;
			const samples = sampleRows.map((r) => r[c] ?? '');
			const colType = inferColumnType(samples);
			result.push({ id: colId, name, type: colType });
		}
		return result;
	}, [csvData, hasHeader]);

	// Display indices after filtering & sorting
	const displayIndices = useMemo(() => {
		if (!csvData) return [];
		// If header is enabled, row index 0 is header row
		const dataIndices = hasHeader
			? Array.from(
					{ length: Math.max(0, csvData.rows.length - 1) },
					(_, i) => i + 1,
				)
			: Array.from({ length: csvData.rows.length }, (_, i) => i);

		return queryRows(csvData.rows, columns, {
			filter: filterGroup,
			sortKeys,
		}).filter((idx) => dataIndices.includes(idx));
	}, [csvData, columns, filterGroup, sortKeys, hasHeader]);

	// Sync table edits to text area when on input tab
	useEffect(() => {
		if (csvData && activeTab === 'edit') {
			setInputText(exportCsv(csvData, delimiter));
		}
	}, [csvData, delimiter, activeTab]);

	// Push current state to undo stack before mutation
	const pushUndo = useCallback(() => {
		if (!csvData) return;
		setUndoStack((prev) => [...prev.slice(-19), csvData.rows]);
	}, [csvData]);

	const handleUndo = () => {
		if (undoStack.length === 0) return;
		const previousRows = undoStack[undoStack.length - 1];
		setUndoStack((prev) => prev.slice(0, -1));
		if (previousRows) {
			const maxCols = Math.max(...previousRows.map((r) => r.length), 1);
			setCsvData({ rows: previousRows, colCount: maxCols });
		}
	};

	const resetQueryState = useCallback(() => {
		setFilterGroup({ combinator: 'and', conditions: [] });
		setSortKeys([]);
	}, []);

	// Parse CSV text input
	const handleParse = () => {
		if (!inputText.trim()) {
			setCsvData(null);
			setSheets([]);
			setError('');
			return;
		}
		const { data, error: err } = parseCsv(inputText, delimiter);
		if (err) {
			setError(err);
			setCsvData(null);
		} else {
			setCsvData(data);
			setSheets([{ name: 'Sheet1', rows: data.rows }]);
			setActiveSheetIdx(0);
			setError('');
			setActiveTab('edit');
			setCurrentPage(1);
			setUndoStack([]);
			resetQueryState();
		}
	};

	// File Upload Handler (.csv, .tsv, .xlsx)
	const processFile = async (file: File) => {
		setError('');
		const fileNameLower = file.name.toLowerCase();
		const isXlsx = fileNameLower.endsWith('.xlsx');
		const isTsv = fileNameLower.endsWith('.tsv');

		if (isXlsx) {
			if (!isDecompressionStreamSupported()) {
				setError(
					'お使いのブラウザは .xlsx ファイルの直接読み込みに対応していません。Excel で CSV としてエクスポートしてからお試しください。Chrome / Edge / Safari の最新版であれば直接読み込めます。',
				);
				return;
			}
			try {
				const res = await parseXlsx(file);
				if (res.sheets.length === 0) {
					setError('有効なシートが見つかりませんでした。');
					return;
				}
				setSheets(res.sheets);
				setActiveSheetIdx(0);
				const activeRows = res.sheets[0].rows;
				const maxCols = Math.max(...activeRows.map((r) => r.length), 1);
				setCsvData({ rows: activeRows, colCount: maxCols });
				setInputText(
					exportCsv({ rows: activeRows, colCount: maxCols }, delimiter),
				);
				setActiveTab('edit');
				setCurrentPage(1);
				setUndoStack([]);
				resetQueryState();
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		} else {
			// CSV / TSV
			const mappedDelim = isTsv ? '\t' : delimiter;
			if (isTsv) setDelimiter('\t');

			const reader = new FileReader();
			reader.onload = (evt) => {
				const text = evt.target?.result as string;
				setInputText(text);
				const { data, error: err } = parseCsv(text, mappedDelim);
				if (err) {
					setError(err);
				} else {
					setCsvData(data);
					setSheets([{ name: file.name, rows: data.rows }]);
					setActiveSheetIdx(0);
					setError('');
					setActiveTab('edit');
					setCurrentPage(1);
					setUndoStack([]);
					resetQueryState();
				}
			};
			reader.readAsText(file);
		}
	};

	const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		processFile(file);
		if (fileInputRef.current) fileInputRef.current.value = '';
	};

	const handleSelectSheet = (idx: number) => {
		if (!sheets[idx]) return;
		if (csvData) {
			setSheets((prev) =>
				prev.map((s, i) =>
					i === activeSheetIdx ? { ...s, rows: csvData.rows } : s,
				),
			);
		}
		setActiveSheetIdx(idx);
		const targetRows = sheets[idx].rows;
		const maxCols = Math.max(...targetRows.map((r) => r.length), 1);
		setCsvData({ rows: targetRows, colCount: maxCols });
		setInputText(exportCsv({ rows: targetRows, colCount: maxCols }, delimiter));
		setCurrentPage(1);
		setUndoStack([]);
	};

	// Downloads
	const handleDownload = () => {
		if (!csvData) return;
		const result = exportCsv(csvData, delimiter);
		const blob = new Blob([result], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `edited.${delimiter === '\t' ? 'tsv' : 'csv'}`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const handleDownloadJson = () => {
		if (!csvData) return;
		let resultStr = '';
		if (hasHeader && csvData.rows.length > 1) {
			const headers = csvData.rows[0];
			const jsonArray = csvData.rows.slice(1).map((row) => {
				const obj: Record<string, string> = {};
				headers.forEach((h, i) => {
					obj[h || `Column${i + 1}`] = row[i];
				});
				return obj;
			});
			resultStr = JSON.stringify(jsonArray, null, 2);
		} else {
			resultStr = JSON.stringify(csvData.rows, null, 2);
		}

		const blob = new Blob([resultStr], {
			type: 'application/json;charset=utf-8',
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'exported.json';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const handleCopy = () => {
		if (!csvData) return;
		const result = exportCsv(csvData, delimiter);
		navigator.clipboard.writeText(result);
	};

	// Editor Cell / Row Mutations
	const updateCell = (
		originalRowIdx: number,
		colIdx: number,
		value: string,
	) => {
		if (!csvData) return;
		pushUndo();
		const newRows = [...csvData.rows];
		newRows[originalRowIdx] = [...newRows[originalRowIdx]];
		newRows[originalRowIdx][colIdx] = value;
		setCsvData({ ...csvData, rows: newRows });
	};

	const addRow = () => {
		if (!csvData) return;
		pushUndo();
		const newRow = Array(csvData.colCount).fill('');
		const newRows = [...csvData.rows, newRow];
		setCsvData({ ...csvData, rows: newRows });
		setCurrentPage(Math.ceil((displayIndices.length + 1) / ROWS_PER_PAGE));
	};

	const removeRow = (originalRowIdx: number) => {
		if (!csvData) return;
		pushUndo();
		const newRows = [...csvData.rows];
		newRows.splice(originalRowIdx, 1);

		if (newRows.length === 0) {
			newRows.push(Array(csvData.colCount).fill(''));
		}
		setCsvData({ ...csvData, rows: newRows });
	};

	const addColumn = () => {
		if (!csvData) return;
		pushUndo();
		const newColCount = csvData.colCount + 1;
		const newRows = csvData.rows.map((r, rIdx) => {
			if (rIdx === 0 && hasHeader) {
				return [...r, getColumnLabel(newColCount - 1)];
			}
			return [...r, ''];
		});
		setCsvData({ rows: newRows, colCount: newColCount });
	};

	const removeColumn = (colIdx: number) => {
		if (!csvData) return;
		if (csvData.colCount <= 1) return;
		pushUndo();
		const newColCount = csvData.colCount - 1;
		const newRows = csvData.rows.map((r) => {
			const nr = [...r];
			nr.splice(colIdx, 1);
			return nr;
		});
		setCsvData({ rows: newRows, colCount: newColCount });
	};

	// Column Header Click Sort Helper
	const handleHeaderClick = (colId: string) => {
		const existing = sortKeys.find((k) => k.columnId === colId);
		if (!existing) {
			setSortKeys([{ columnId: colId, direction: 'asc' }]);
		} else if (existing.direction === 'asc') {
			setSortKeys([{ columnId: colId, direction: 'desc' }]);
		} else {
			setSortKeys([]);
		}
	};

	const clearData = () => {
		setCsvData(null);
		setSheets([]);
		setInputText('');
		setActiveTab('input');
		setFilterGroup({ combinator: 'and', conditions: [] });
		setSortKeys([]);
		setUndoStack([]);
	};

	// Pagination Math
	const totalDisplayRows = displayIndices.length;
	const totalPages = Math.ceil(totalDisplayRows / ROWS_PER_PAGE) || 1;

	useEffect(() => {
		if (currentPage > totalPages) {
			setCurrentPage(totalPages);
		}
	}, [currentPage, totalPages]);

	const startIndex = (currentPage - 1) * ROWS_PER_PAGE;
	const endIndex = Math.min(startIndex + ROWS_PER_PAGE, totalDisplayRows);
	const currentPageIndices = displayIndices.slice(startIndex, endIndex);

	return (
		<div className="space-y-6">
			{/* Top Control Bar */}
			<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-muted/30 p-4 rounded-xl border">
				<div className="flex items-center gap-4 flex-wrap">
					<div>
						<Label className="text-xs mb-1 block text-muted-foreground">
							区切り文字
						</Label>
						<Select value={delimiter} onValueChange={setDelimiter}>
							<SelectTrigger className="w-[140px] h-8 rounded-lg bg-background">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value=",">カンマ (CSV)</SelectItem>
								<SelectItem value="\t">タブ (TSV)</SelectItem>
								<SelectItem value=";">セミコロン</SelectItem>
								<SelectItem value="|">パイプ (|)</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="pt-5 hidden sm:flex items-center gap-2">
						<Checkbox
							id="has-header"
							checked={hasHeader}
							onCheckedChange={(v) => setHasHeader(!!v)}
						/>
						<Label
							htmlFor="has-header"
							className="text-sm cursor-pointer whitespace-nowrap"
						>
							1行目をヘッダーとする
						</Label>
					</div>

					<div className="pt-5">
						<input
							type="file"
							accept=".csv,.tsv,.xlsx,.txt"
							className="hidden"
							ref={fileInputRef}
							onChange={handleFileUpload}
						/>
						<Button
							variant="outline"
							size="sm"
							onClick={() => fileInputRef.current?.click()}
							className="h-8"
						>
							<Upload className="h-4 w-4 sm:mr-2" />
							<span className="hidden sm:inline">
								ファイル読込 (.csv / .tsv / .xlsx)
							</span>
						</Button>
					</div>
				</div>

				<div className="flex gap-2 w-full sm:w-auto">
					{csvData && (
						<>
							<Button
								variant="outline"
								size="sm"
								onClick={handleUndo}
								disabled={undoStack.length === 0}
								className="h-8 flex-1 sm:flex-none"
								title="元に戻す (Undo)"
							>
								<RotateCcw className="h-4 w-4 sm:mr-2" />
								<span className="hidden sm:inline">Undo</span>
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={handleCopy}
								className="h-8 flex-1 sm:flex-none"
							>
								<Copy className="h-4 w-4 sm:mr-2" />
								<span className="hidden sm:inline">コピー</span>
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={handleDownloadJson}
								className="h-8 flex-1 sm:flex-none"
							>
								<Braces className="h-4 w-4 sm:mr-2" />
								<span className="hidden sm:inline">JSON</span>
							</Button>
							<Button
								variant="default"
								size="sm"
								onClick={handleDownload}
								className="h-8 flex-1 sm:flex-none"
							>
								<Download className="h-4 w-4 sm:mr-2" />
								<span className="hidden sm:inline">エクスポート</span>
							</Button>
						</>
					)}
					<Button
						variant="ghost"
						size="sm"
						onClick={clearData}
						disabled={!inputText && !csvData}
						className="h-8 text-muted-foreground"
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			</div>

			{/* Main Tabs */}
			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList className="grid w-full grid-cols-4 max-w-[600px]">
					<TabsTrigger value="input">テキスト</TabsTrigger>
					<TabsTrigger value="edit" disabled={!csvData}>
						<Table className="h-3.5 w-3.5 mr-1 hidden sm:inline" /> テーブル
					</TabsTrigger>
					<TabsTrigger value="filter-sort" disabled={!csvData}>
						<Filter className="h-3.5 w-3.5 mr-1 hidden sm:inline" />{' '}
						絞込・ソート
					</TabsTrigger>
					<TabsTrigger value="chart" disabled={!csvData}>
						<PieChart className="h-3.5 w-3.5 mr-1 hidden sm:inline" /> グラフ
					</TabsTrigger>
				</TabsList>

				{/* Text Input Tab */}
				<TabsContent value="input" className="mt-4 space-y-4">
					<div className="flex items-center justify-between">
						<Label>CSV / TSV テキストデータ</Label>
						<Button size="sm" onClick={handleParse} disabled={!inputText}>
							パースして編集へ
						</Button>
					</div>
					<Textarea
						value={inputText}
						onChange={(e) => setInputText(e.target.value)}
						placeholder="名前,年齢,部署&#10;田中,25,開発&#10;佐藤,30,営業"
						className="min-h-[400px] font-mono-tool text-sm leading-5 rounded-xl border"
						spellCheck={false}
					/>
					{error && <p className="text-red-500 text-sm mt-2">{error}</p>}
				</TabsContent>

				{/* Table Edit Tab */}
				<TabsContent
					value="edit"
					className="mt-4 border rounded-xl bg-card overflow-hidden flex flex-col min-h-[500px]"
				>
					{!csvData ? (
						<div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
							<FileSpreadsheet className="h-12 w-12 mb-4 opacity-20" />
							<p>
								データがありません。テキスト入力またはファイル読み込みを行ってください。
							</p>
						</div>
					) : (
						<div className="flex flex-col h-full w-full overflow-hidden">
							<SheetPicker
								sheets={sheets}
								activeSheet={activeSheetIdx}
								onSelectSheet={handleSelectSheet}
							/>

							{/* Pagination & Stats Top Bar */}
							<div className="border-b bg-muted/20 p-2 flex items-center justify-between flex-wrap gap-2">
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={addRow}
										className="h-8 text-xs"
									>
										<Plus className="h-3 w-3 mr-1" /> 行を追加
									</Button>
									<Button
										variant="outline"
										size="sm"
										onClick={addColumn}
										className="h-8 text-xs"
									>
										<Plus className="h-3 w-3 mr-1" /> 列を追加
									</Button>
								</div>

								<div className="flex items-center gap-4 text-sm">
									<span className="text-muted-foreground text-xs">
										全 {csvData.rows.length - (hasHeader ? 1 : 0)} 行中{' '}
										{totalDisplayRows} 行表示 ({csvData.colCount} 列)
									</span>
									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="sm"
											disabled={currentPage === 1}
											onClick={() => setCurrentPage((p) => p - 1)}
											className="h-8 px-2"
										>
											前へ
										</Button>
										<span className="w-20 text-center text-xs">
											{currentPage} / {totalPages}
										</span>
										<Button
											variant="ghost"
											size="sm"
											disabled={currentPage === totalPages}
											onClick={() => setCurrentPage((p) => p + 1)}
											className="h-8 px-2"
										>
											次へ
										</Button>
									</div>
								</div>
							</div>

							{/* Table Container */}
							<div className="flex-1 overflow-auto bg-background p-4 relative">
								<table className="w-max border-collapse font-mono-tool text-sm min-w-full">
									<thead>
										<tr>
											<th className="border bg-muted/50 w-10 sticky top-0 left-0 z-20" />
											{columns.map((col, cIdx) => {
												const activeSort = sortKeys.find(
													(k) => k.columnId === col.id,
												);
												return (
													<th
														key={col.id}
														className="border bg-muted/50 p-1.5 min-w-[140px] sticky top-0 z-10 group select-none cursor-pointer hover:bg-muted/70 transition-colors"
														onClick={() => handleHeaderClick(col.id)}
													>
														<div className="flex items-center justify-between px-1">
															<div className="flex items-center gap-1 overflow-hidden">
																<span className="font-semibold text-foreground truncate">
																	{col.name}
																</span>
																<span className="text-[10px] text-muted-foreground font-normal">
																	({col.type})
																</span>
															</div>
															<div className="flex items-center gap-1">
																{activeSort && (
																	<span className="text-primary text-xs font-bold">
																		{activeSort.direction === 'asc' ? '↑' : '↓'}
																	</span>
																)}
																{csvData.colCount > 1 && (
																	<button
																		type="button"
																		onClick={(e) => {
																			e.stopPropagation();
																			removeColumn(cIdx);
																		}}
																		className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 hover:text-red-600 rounded text-muted-foreground transition-opacity"
																		title="列を削除"
																	>
																		<Trash2 className="h-3 w-3" />
																	</button>
																)}
															</div>
														</div>
													</th>
												);
											})}
										</tr>
									</thead>
									<tbody>
										{currentPageIndices.map((origRowIdx, relativeIndex) => {
											const rowData = csvData.rows[origRowIdx] ?? [];
											return (
												<tr
													key={`r-${origRowIdx}`}
													className="group hover:bg-muted/10"
												>
													<td className="border bg-muted/30 text-center sticky left-0 z-10 w-10 p-0">
														<div className="flex items-center justify-center relative w-full h-full min-h-[36px]">
															<span className="text-xs text-muted-foreground group-hover:opacity-0 transition-opacity absolute">
																{startIndex + relativeIndex + 1}
															</span>
															<button
																type="button"
																onClick={() => removeRow(origRowIdx)}
																className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 hover:text-red-600 rounded text-muted-foreground transition-opacity absolute"
																title="行を削除"
															>
																<Trash2 className="h-3 w-3" />
															</button>
														</div>
													</td>
													{columns.map((col, cIdx) => (
														<td
															key={`c-${origRowIdx}-${col.id}`}
															className="border p-0 min-w-[140px]"
														>
															<input
																type="text"
																value={rowData[cIdx] ?? ''}
																onChange={(e) =>
																	updateCell(origRowIdx, cIdx, e.target.value)
																}
																className="w-full h-full min-h-[36px] px-2 py-1 bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-primary focus:bg-background transition-colors"
															/>
														</td>
													))}
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						</div>
					)}
				</TabsContent>

				{/* Filter & Sort Tab */}
				<TabsContent value="filter-sort" className="mt-4 space-y-4">
					<FilterPanel
						columns={columns}
						filterGroup={filterGroup}
						onChangeFilterGroup={(fg) => {
							setFilterGroup(fg);
							setCurrentPage(1);
						}}
					/>
					<SortPanel
						columns={columns}
						sortKeys={sortKeys}
						onChangeSortKeys={(sk) => {
							setSortKeys(sk);
							setCurrentPage(1);
						}}
					/>
				</TabsContent>

				{/* Chart Tab */}
				<TabsContent value="chart" className="mt-4">
					{csvData && (
						<ChartPanel
							rows={csvData.rows}
							displayIndices={displayIndices}
							columns={columns}
						/>
					)}
				</TabsContent>
			</Tabs>

			{/* Privacy Note */}
			<div className="text-center text-xs text-muted-foreground pt-4 border-t">
				🔒 データはサーバーに送信されません。すべてブラウザ内で処理されます。
			</div>
		</div>
	);
}
