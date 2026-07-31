/**
 * エクスポートボタンコンポーネント
 * CSVダウンロード / クリップボードコピー + カラム選択設定
 */

import { Check, Clipboard, Download, Settings2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';
import { generateCsvOutput } from '@/lib/phone-formatter/bulk';
import type { ParseResult } from '@/lib/phone-formatter/types';

interface ExportButtonsProps {
	results: ParseResult[];
	visibleColumns: string[];
}

const EXPORT_COLUMNS = [
	{ id: 'input', label: '入力' },
	{ id: 'e164', label: 'E.164' },
	{ id: 'international', label: '国際表記' },
	{ id: 'national', label: '国内表記' },
	{ id: 'rfc3966', label: 'RFC3966' },
	{ id: 'type', label: '種別' },
	{ id: 'region', label: '地域' },
	{ id: 'valid', label: '有効' },
];

export default function ExportButtons({
	results,
	visibleColumns: _visibleColumns,
}: ExportButtonsProps) {
	const [copiedCSV, setCopiedCSV] = useState(false);
	const [copiedClip, setCopiedClip] = useState(false);
	const [copyClipFailed, setCopyClipFailed] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const [exportColumns, setExportColumns] = useState<string[]>([
		'input',
		'e164',
		'national',
		'type',
		'valid',
	]);
	const [validOnly, setValidOnly] = useState(false);
	const settingsRef = useRef<HTMLDivElement>(null);

	// クリック外でポップオーバーを閉じる
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (
				settingsRef.current &&
				!settingsRef.current.contains(e.target as Node)
			) {
				setShowSettings(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	const getExportResults = () => {
		return validOnly ? results.filter((r) => r.valid) : results;
	};

	// CSVダウンロード
	const handleDownloadCsv = () => {
		const exportResults = getExportResults();
		const csv = generateCsvOutput(exportResults, exportColumns);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'phone-numbers.csv';
		a.dataset.astroReload = 'true'; // Astroルーター誤認防止
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		setCopiedCSV(true);
		setTimeout(() => setCopiedCSV(false), 2000);
	};

	// クリップボードへE.164をコピー
	const handleCopyClipboard = async () => {
		const exportResults = getExportResults();
		const e164List = exportResults
			.filter((r) => r.valid && r.formats?.e164)
			.map((r) => r.formats?.e164)
			.join('\n');

		const ok = await copyText(e164List);
		if (ok) {
			setCopyClipFailed(false);
			setCopiedClip(true);
			setTimeout(() => setCopiedClip(false), 2000);
		} else {
			setCopiedClip(false);
			setCopyClipFailed(true);
			setTimeout(() => setCopyClipFailed(false), 2000);
		}
	};

	const toggleExportColumn = (colId: string) => {
		if (exportColumns.includes(colId)) {
			setExportColumns(exportColumns.filter((c) => c !== colId));
		} else {
			// EXPORT_COLUMNS順を維持
			const ordered = EXPORT_COLUMNS.map((c) => c.id).filter(
				(id) => exportColumns.includes(id) || id === colId,
			);
			setExportColumns(ordered);
		}
	};

	return (
		<div className="flex flex-wrap items-center gap-2">
			{/* CSVダウンロード */}
			<Button
				onClick={handleDownloadCsv}
				variant="outline"
				className="gap-2"
				aria-label="CSVをダウンロード"
			>
				{copiedCSV ? (
					<>
						<Check className="h-4 w-4 text-green-500" />
						ダウンロード完了
					</>
				) : (
					<>
						<Download className="h-4 w-4" />
						CSVダウンロード
					</>
				)}
			</Button>

			{/* クリップボードコピー */}
			<Button
				onClick={handleCopyClipboard}
				variant="outline"
				className={`gap-2 ${copyClipFailed ? 'text-destructive border-destructive/50' : ''}`}
				aria-label="E.164番号一覧をクリップボードにコピー"
			>
				{copyClipFailed ? (
					<>
						<X className="h-4 w-4" />
						コピーに失敗しました
					</>
				) : copiedClip ? (
					<>
						<Check className="h-4 w-4 text-green-500" />
						コピー完了
					</>
				) : (
					<>
						<Clipboard className="h-4 w-4" />
						クリップボードにコピー
					</>
				)}
			</Button>

			{/* 設定ポップオーバー */}
			<div className="relative" ref={settingsRef}>
				<Button
					variant="ghost"
					size="icon"
					onClick={() => setShowSettings(!showSettings)}
					aria-label="エクスポート設定"
					aria-expanded={showSettings}
				>
					<Settings2 className="h-4 w-4" />
				</Button>

				{showSettings && (
					<div className="absolute left-0 mt-2 w-64 rounded-xl border border-border bg-card shadow-lg p-4 z-20 animate-in fade-in zoom-in-95 duration-150">
						<p className="text-sm font-semibold mb-3">エクスポート設定</p>

						{/* カラム選択 */}
						<div className="space-y-2 mb-4">
							<p className="text-xs text-muted-foreground">含めるカラム</p>
							{EXPORT_COLUMNS.map((col) => (
								<label
									key={col.id}
									className="flex items-center gap-2 text-sm cursor-pointer"
								>
									<input
										type="checkbox"
										checked={exportColumns.includes(col.id)}
										onChange={() => toggleExportColumn(col.id)}
										className="rounded border-border"
									/>
									{col.label}
								</label>
							))}
						</div>

						{/* 有効な番号のみ */}
						<label className="flex items-center gap-2 text-sm cursor-pointer border-t border-border pt-3">
							<input
								type="checkbox"
								checked={validOnly}
								onChange={(e) => setValidOnly(e.target.checked)}
								className="rounded border-border"
							/>
							有効な番号のみ
						</label>
					</div>
				)}
			</div>
		</div>
	);
}
