import {
	Braces,
	Copy,
	Download,
	FileSpreadsheet,
	Plus,
	Trash2,
	Upload,
} from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
	type CsvData,
	exportCsv,
	getColumnLabel,
	parseCsv,
} from '@/lib/tools/csv-editor';

const ROWS_PER_PAGE = 50;

export default function CsvEditor() {
	const [activeTab, setActiveTab] = useState('input');
	const [inputText, setInputText] = useState('');
	const [delimiter, setDelimiter] = useState(',');

	const [csvData, setCsvData] = useState<CsvData | null>(null);
	const [error, setError] = useState<string>('');
	const [hasHeader, setHasHeader] = useState(true);

	const [currentPage, setCurrentPage] = useState(1);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Sync table edits to text area
	useEffect(() => {
		if (csvData && activeTab === 'edit') {
			setInputText(exportCsv(csvData, delimiter));
		}
	}, [csvData, delimiter, activeTab]);

	// Apply CSV parsing
	const handleParse = () => {
		if (!inputText.trim()) {
			setCsvData(null);
			setError('');
			return;
		}
		const { data, error: err } = parseCsv(inputText, delimiter);
		if (err) {
			setError(err);
			setCsvData(null);
		} else {
			setCsvData(data);
			setError('');
			setActiveTab('edit');
			setCurrentPage(1);
		}
	};

	// Upload file
	const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (evt) => {
			const text = evt.target?.result as string;
			setInputText(text);
			// Auto-detect TSV vs CSV poorly by extension, default to comma
			const mappedDelim = file.name.endsWith('.tsv') ? '\t' : ',';
			setDelimiter(mappedDelim);

			const { data, error: err } = parseCsv(text, mappedDelim);
			if (err) {
				setError(err);
			} else {
				setCsvData(data);
				setError('');
				setActiveTab('edit');
				setCurrentPage(1);
			}
		};
		reader.readAsText(file);
		// Reset input
		if (fileInputRef.current) fileInputRef.current.value = '';
	};

	// Download Output
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
		a.download = `exported.json`;
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

	// Editor Actions
	const updateCell = (rIdx: number, cIdx: number, value: string) => {
		if (!csvData) return;
		const newRows = [...csvData.rows];
		newRows[rIdx] = [...newRows[rIdx]];
		newRows[rIdx][cIdx] = value;
		setCsvData({ ...csvData, rows: newRows });
	};

	const addRow = () => {
		if (!csvData) return;
		const newRow = Array(csvData.colCount).fill('');
		const newRows = [...csvData.rows, newRow];
		setCsvData({ ...csvData, rows: newRows });
		// Go to last page
		setCurrentPage(Math.ceil(newRows.length / ROWS_PER_PAGE));
	};

	const removeRow = (rIdx: number) => {
		if (!csvData) return;
		const newRows = [...csvData.rows];
		newRows.splice(rIdx, 1);

		// If no rows left, add one empty row to prevent complete break
		if (newRows.length === 0) {
			newRows.push(Array(csvData.colCount).fill(''));
		}

		setCsvData({ ...csvData, rows: newRows });
		const totalPages = Math.ceil(newRows.length / ROWS_PER_PAGE);
		if (currentPage > totalPages) setCurrentPage(Math.max(1, totalPages));
	};

	const addColumn = () => {
		if (!csvData) return;
		const newColCount = csvData.colCount + 1;
		const newRows = csvData.rows.map((r, rIdx) => {
			if (rIdx === 0 && hasHeader) {
				return [...r, getColumnLabel(newColCount - 1)];
			}
			return [...r, ''];
		});
		setCsvData({ rows: newRows, colCount: newColCount });
	};

	const removeColumn = (cIdx: number) => {
		if (!csvData) return;
		if (csvData.colCount <= 1) return; // Cannot remove last column
		const newColCount = csvData.colCount - 1;
		const newRows = csvData.rows.map((r) => {
			const nr = [...r];
			nr.splice(cIdx, 1);
			return nr;
		});
		setCsvData({ rows: newRows, colCount: newColCount });
	};

	const clearData = () => {
		setCsvData(null);
		setInputText('');
		setActiveTab('input');
	};

	// Pagination logic
	const totalRows = csvData ? csvData.rows.length : 0;
	const totalPages = Math.ceil(totalRows / ROWS_PER_PAGE) || 1;
	const startIndex = (currentPage - 1) * ROWS_PER_PAGE;
	const endIndex = Math.min(startIndex + ROWS_PER_PAGE, totalRows);
	const currentRows = csvData ? csvData.rows.slice(startIndex, endIndex) : [];

	return (
		<div className="space-y-6">
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
							accept=".csv,.tsv,.txt"
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
							<span className="hidden sm:inline">読込</span>
						</Button>
					</div>
				</div>

				<div className="flex gap-2 w-full sm:w-auto">
					{csvData && (
						<>
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
								<span className="hidden sm:inline">CSV</span>
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

			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList className="grid w-full grid-cols-2 max-w-[400px]">
					<TabsTrigger value="input">テキスト入力</TabsTrigger>
					<TabsTrigger value="edit" disabled={!csvData}>
						テーブル編集
					</TabsTrigger>
				</TabsList>

				<TabsContent value="input" className="mt-4 space-y-4">
					<div className="flex items-center justify-between">
						<Label>テキストデータ</Label>
						<Button size="sm" onClick={handleParse} disabled={!inputText}>
							パースして編集へ
						</Button>
					</div>
					<Textarea
						value={inputText}
						onChange={(e) => setInputText(e.target.value)}
						placeholder={'A,B,C\n1,2,3\n4,5,6'}
						className="min-h-[400px] font-mono-tool text-sm leading-5 rounded-xl border"
						spellCheck={false}
					/>
					{error && <p className="text-red-500 text-sm mt-2">{error}</p>}
				</TabsContent>

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
							{/* Pagination Top Bar */}
							<div className="border-b bg-muted/20 p-2 flex items-center justify-between">
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
									<span className="text-muted-foreground">
										全 {totalRows} 行
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
											<th className="border bg-muted/50 w-10 sticky top-0 left-0 z-20"></th>
											{Array.from({ length: csvData.colCount }).map(
												(_, cIdx) => (
													<th
														// biome-ignore lint/suspicious/noArrayIndexKey: column indices are the identifier
														key={`h-${cIdx}`}
														className="border bg-muted/50 p-1 min-w-[120px] sticky top-0 z-10 group"
													>
														<div className="flex items-center justify-between px-2">
															<span className="font-semibold text-muted-foreground">
																{getColumnLabel(cIdx)}
															</span>
															{csvData.colCount > 1 && (
																<button
																	type="button"
																	onClick={() => removeColumn(cIdx)}
																	className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 hover:text-red-600 rounded text-muted-foreground transition-opacity"
																	title="列を削除"
																>
																	<Trash2 className="h-3 w-3" />
																</button>
															)}
														</div>
													</th>
												),
											)}
										</tr>
									</thead>
									<tbody>
										{currentRows.map((row, relativeIndex) => {
											const absoluteIndex = startIndex + relativeIndex;
											return (
												<tr
													key={`r-${absoluteIndex}`}
													className="group hover:bg-muted/10"
												>
													<td className="border bg-muted/30 text-center sticky left-0 z-10 w-10 p-0">
														<div className="flex items-center justify-center relative w-full h-full min-h-[36px]">
															<span className="text-xs text-muted-foreground group-hover:opacity-0 transition-opacity absolute">
																{absoluteIndex + 1}
															</span>
															<button
																type="button"
																onClick={() => removeRow(absoluteIndex)}
																className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 hover:text-red-600 rounded text-muted-foreground transition-opacity absolute"
																title="行を削除"
															>
																<Trash2 className="h-3 w-3" />
															</button>
														</div>
													</td>
													{row.map((cell, cIdx) => (
														<td
															// biome-ignore lint/suspicious/noArrayIndexKey: grid cell position is the identifier
															key={`c-${absoluteIndex}-${cIdx}`}
															className="border p-0 min-w-[120px]"
														>
															<input
																type="text"
																value={cell}
																onChange={(e) =>
																	updateCell(
																		absoluteIndex,
																		cIdx,
																		e.target.value,
																	)
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
			</Tabs>
		</div>
	);
}
