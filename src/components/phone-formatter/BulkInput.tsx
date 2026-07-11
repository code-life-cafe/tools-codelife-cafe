/**
 * 一括入力コンポーネント
 * テキスト直接入力 / CSVアップロードの2モードをタブで切り替え
 */

import { FileText, Loader2, Upload } from 'lucide-react';
import Papa from 'papaparse';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { parseCsvColumn, processBulk } from '@/lib/phone-formatter/bulk';
import type { BulkResult } from '@/lib/phone-formatter/types';
import { validateCsvFile } from '@/lib/phone-formatter/validation';

interface BulkInputProps {
	onBulkResult: (result: BulkResult) => void;
}

type InputMode = 'text' | 'csv';

export default function BulkInput({ onBulkResult }: BulkInputProps) {
	const [inputMode, setInputMode] = useState<InputMode>('text');
	const [textValue, setTextValue] = useState('');
	const [mounted, setMounted] = useState(false);

	// CSV関連
	const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
	const [csvData, setCsvData] = useState<string[][]>([]);
	const [selectedColumn, setSelectedColumn] = useState(0);
	const [csvFileName, setCsvFileName] = useState('');
	const [csvError, setCsvError] = useState('');
	const [isDragging, setIsDragging] = useState(false);

	// 処理状態
	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState({ current: 0, total: 0 });
	const [error, setError] = useState('');

	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		setMounted(true);
	}, []);

	// 行数カウント
	const lineCount = textValue.trim()
		? textValue
				.trim()
				.split('\n')
				.filter((l) => l.trim()).length
		: 0;

	// CSVファイル解析
	const parseCsvFile = useCallback((file: File) => {
		const validation = validateCsvFile(file);
		if (!validation.valid) {
			setCsvError(
				validation.error ?? 'ファイルのバリデーションに失敗しました。',
			);
			return;
		}

		setCsvFileName(file.name);
		setCsvError('');

		const reader = new FileReader();
		reader.onload = (e) => {
			const text = e.target?.result as string;
			const result = Papa.parse<string[]>(text, {
				header: false,
				skipEmptyLines: true,
			});

			const rows = result.data as string[][];
			if (rows.length === 0) {
				setCsvError('CSVファイルにデータが見つかりませんでした。');
				return;
			}

			const headers = rows[0];
			setCsvHeaders(headers ?? []);
			setCsvData(rows);

			// 電話番号カラムを自動検出
			const autoDetectedIndex = headers.findIndex((h) =>
				/電話|tel|phone|番号/i.test(h),
			);
			setSelectedColumn(autoDetectedIndex >= 0 ? autoDetectedIndex : 0);
		};

		reader.onerror = () => {
			setCsvError('ファイルの読み込みに失敗しました。');
		};

		reader.readAsText(file, 'utf-8');
	}, []);

	// ドラッグ&ドロップ
	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(true);
	};

	const handleDragLeave = () => setIsDragging(false);

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		const file = e.dataTransfer.files[0];
		if (file) parseCsvFile(file);
	};

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) parseCsvFile(file);
		// リセットして同ファイルを再選択できるようにする
		e.target.value = '';
	};

	// 一括変換処理（チャンク処理でUIをブロックしない）
	const handleConvert = useCallback(async () => {
		setError('');
		setIsProcessing(true);

		try {
			let inputs: string[];

			if (inputMode === 'text') {
				inputs = textValue
					.trim()
					.split('\n')
					.filter((l) => l.trim());
			} else {
				if (csvData.length === 0) {
					setError('CSVファイルを選択してください。');
					setIsProcessing(false);
					return;
				}
				// ヘッダー行があると仮定（1行目をスキップ）
				const hasHeader = csvHeaders.length > 0;
				inputs = parseCsvColumn(
					Papa.unparse(csvData),
					selectedColumn,
					hasHeader,
				);
			}

			if (inputs.length === 0) {
				setError('変換する電話番号が入力されていません。');
				setIsProcessing(false);
				return;
			}

			// 100件以下は同期処理
			if (inputs.length <= 100) {
				const result = processBulk(inputs);
				onBulkResult(result);
				setIsProcessing(false);
				return;
			}

			// 100件超はチャンク処理（requestAnimationFrameでUIをブロックしない）
			const CHUNK_SIZE = 500;
			const allResults: ReturnType<typeof processBulk>['results'] = [];

			setProgress({ current: 0, total: inputs.length });

			const processChunk = (startIndex: number): Promise<void> => {
				return new Promise((resolve) => {
					requestAnimationFrame(() => {
						const chunk = inputs.slice(startIndex, startIndex + CHUNK_SIZE);
						const chunkResult = processBulk(chunk);
						allResults.push(...chunkResult.results);
						setProgress({
							current: Math.min(startIndex + CHUNK_SIZE, inputs.length),
							total: inputs.length,
						});
						resolve();
					});
				});
			};

			for (let i = 0; i < inputs.length; i += CHUNK_SIZE) {
				await processChunk(i);
			}

			const validCount = allResults.filter((r) => r.valid).length;
			onBulkResult({
				results: allResults,
				summary: {
					total: allResults.length,
					valid: validCount,
					invalid: allResults.length - validCount,
				},
			});
		} catch (err) {
			setError(
				err instanceof Error ? err.message : '変換中にエラーが発生しました。',
			);
		} finally {
			setIsProcessing(false);
		}
	}, [inputMode, textValue, csvData, csvHeaders, selectedColumn, onBulkResult]);

	// CSVプレビュー（先頭3行）
	const previewRows = csvData.slice(1, 4);

	return (
		<div className="space-y-4">
			{/* テキスト / CSV タブ */}
			<div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
				<button
					type="button"
					onClick={() => setInputMode('text')}
					className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
						inputMode === 'text'
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					<FileText className="h-3.5 w-3.5" />
					テキスト入力
				</button>
				<button
					type="button"
					onClick={() => setInputMode('csv')}
					className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
						inputMode === 'csv'
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					<Upload className="h-3.5 w-3.5" />
					CSVアップロード
				</button>
			</div>

			{/* テキスト入力エリア */}
			{inputMode === 'text' && (
				<div className="space-y-2">
					<div className="relative">
						<Textarea
							value={textValue}
							onChange={(e) => setTextValue(e.target.value)}
							placeholder={`1行に1つの電話番号を入力\n03-1234-5678\n090-1234-5678\n+81312345678`}
							resize="vertical"
							className="min-h-[200px] rounded-lg border-border bg-background px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground"
							aria-label="電話番号一覧（1行1件）"
						/>
						{lineCount > 0 && (
							<div className="absolute bottom-2 left-3 text-xs text-muted-foreground">
								{lineCount.toLocaleString()}件
							</div>
						)}
					</div>
				</div>
			)}

			{/* CSVアップロードエリア */}
			{inputMode === 'csv' && (
				<div className="space-y-3">
					{mounted && (
						<button
							type="button"
							onDragOver={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
							onClick={() => fileInputRef.current?.click()}
							aria-label="CSVファイルをドラッグ＆ドロップするか、クリックして選択"
							className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
								isDragging
									? 'border-primary bg-primary/5'
									: 'border-border hover:border-primary/50 hover:bg-muted/30'
							}`}
						>
							<Upload className="h-8 w-8 text-muted-foreground" />
							<div className="text-center">
								<p className="text-sm font-medium">
									{csvFileName || 'CSVファイルをドラッグ＆ドロップ'}
								</p>
								<p className="text-xs text-muted-foreground mt-1">
									または クリックして選択（CSV/TSV/TXT、最大5MB）
								</p>
							</div>
						</button>
					)}

					<input
						ref={fileInputRef}
						type="file"
						accept=".csv,.tsv,.txt"
						onChange={handleFileChange}
						className="hidden"
					/>

					{csvError && (
						<p className="text-sm text-red-600 dark:text-red-400" role="alert">
							{csvError}
						</p>
					)}

					{/* カラム選択 */}
					{csvHeaders.length > 0 && (
						<div className="space-y-2">
							<label className="text-sm font-medium" htmlFor="column-select">
								対象カラム
							</label>
							<select
								id="column-select"
								value={selectedColumn}
								onChange={(e) => setSelectedColumn(Number(e.target.value))}
								className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
							>
								{Array.from(csvHeaders.entries()).map(([index, header]) => (
									<option key={`col-${index}`} value={index}>
										{index + 1}列目: {header || `（列${index + 1}）`}
									</option>
								))}
							</select>

							{/* プレビュー */}
							{previewRows.length > 0 && (
								<div className="overflow-x-auto rounded-lg border border-border">
									<table className="w-full text-xs">
										<thead>
											<tr className="bg-muted/50">
												{Array.from(csvHeaders.entries()).map(([i, h]) => (
													<th
														key={`th-${i}`}
														className={`px-3 py-2 text-left font-medium ${
															i === selectedColumn
																? 'text-primary bg-primary/5'
																: 'text-muted-foreground'
														}`}
													>
														{h}
													</th>
												))}
											</tr>
										</thead>
										<tbody>
											{Array.from(previewRows.entries()).map(([ri, row]) => (
												<tr
													key={`row-${ri}`}
													className="border-t border-border"
												>
													{Array.from(csvHeaders.entries()).map(([ci]) => (
														<td
															key={`cell-${ri}-${ci}`}
															className={`px-3 py-2 ${
																ci === selectedColumn
																	? 'font-medium text-primary bg-primary/5'
																	: ''
															}`}
														>
															{row[ci] ?? ''}
														</td>
													))}
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{/* エラーメッセージ */}
			{error && (
				<p className="text-sm text-red-600 dark:text-red-400" role="alert">
					{error}
				</p>
			)}

			{/* 変換ボタン */}
			<Button
				onClick={handleConvert}
				disabled={isProcessing}
				className="w-full sm:w-auto min-w-[120px]"
				size="lg"
			>
				{isProcessing ? (
					<>
						<Loader2 className="h-4 w-4 mr-2 animate-spin" />
						変換中...
						{progress.total > 100 &&
							` (${progress.current.toLocaleString()}/${progress.total.toLocaleString()}件)`}
					</>
				) : (
					'変換'
				)}
			</Button>
		</div>
	);
}
