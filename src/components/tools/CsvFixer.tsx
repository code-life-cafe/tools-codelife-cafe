import Encoding from 'encoding-japanese';
import {
	AlertCircle,
	AlertTriangle,
	CheckCircle2,
	Download,
	FileText,
	Info,
	Loader2,
	UploadCloud,
	Zap,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { parsePreview } from '@/lib/csv/preview';
import type { PreviewResult } from '@/lib/csv/types';
import { convertEncoding } from '@/lib/encoding/convert';
import { detectEncoding } from '@/lib/encoding/detect';
import { detectLineEnding } from '@/lib/encoding/lineEndings';
import type {
	DetectionResult,
	ConversionOptions as EncodingConversionOptions,
	EncodingType,
} from '@/lib/encoding/types';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { loadSettings, saveSettings } from '@/lib/settings/storage';
import type { UserSettings } from '@/lib/settings/types';
import { cn } from '@/lib/utils';
import { validateFile } from '@/lib/validation/fileValidator';

// --- Interfaces ---

interface FileInfo {
	name: string;
	size: number;
	lineEnding: 'CRLF' | 'LF' | 'CR' | 'MIXED' | 'NONE';
	hasBom: boolean;
	lineCount: number;
}

export interface FileLoadedEvent {
	file: File;
	buffer: ArrayBuffer;
	detection: DetectionResult;
}

// --- Internal Components ---

interface InstantModeToggleProps {
	enabled: boolean;
	onToggle: (enabled: boolean) => void;
}

function InstantModeToggle({ enabled, onToggle }: InstantModeToggleProps) {
	return (
		<div className="flex items-center space-x-4 border rounded-lg p-4 bg-muted/30">
			<div className="bg-primary/10 p-2 rounded-full">
				<Zap className="w-5 h-5 text-primary" />
			</div>
			<div className="flex-1 space-y-1">
				<Label htmlFor="instant-mode" className="text-base font-medium">
					即時変換モード
				</Label>
				{enabled && (
					<p className="text-sm text-muted-foreground">
						D&amp;Dで即座に変換・ダウンロード（信頼度が高い場合のみ）
					</p>
				)}
			</div>
			<Switch id="instant-mode" checked={enabled} onCheckedChange={onToggle} />
		</div>
	);
}

interface FileDropZoneProps {
	onFileLoaded: (event: FileLoadedEvent) => void;
	disabled?: boolean;
}

function FileDropZone({ onFileLoaded, disabled }: FileDropZoneProps) {
	const [isDragging, setIsDragging] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isShaking, setIsShaking] = useState(false);
	const [mounted, setMounted] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		setMounted(true);
	}, []);

	const triggerError = (msg: string) => {
		setError(msg);
		setIsShaking(true);
		setTimeout(() => setIsShaking(false), 500);
	};

	const handleFile = async (file: File) => {
		if (disabled || isProcessing) return;

		setError(null);
		setIsProcessing(true);

		const validation = validateFile(file);
		if (!validation.valid) {
			if (validation.error === 'INVALID_EXTENSION') {
				triggerError('CSV、TSV、TXTファイルのみ対応しています。');
			} else if (validation.error === 'FILE_TOO_LARGE') {
				triggerError(
					`ファイルサイズが大きすぎます（上限: ${Math.round(validation.maxSize / 1024 / 1024)}MB）。`,
				);
			} else if (validation.error === 'EMPTY_FILE') {
				triggerError('ファイルが空です。');
			}
			setIsProcessing(false);
			if (fileInputRef.current) fileInputRef.current.value = '';
			return;
		}

		try {
			const buffer = await file.arrayBuffer();
			const detection = detectEncoding(buffer);

			onFileLoaded({ file, buffer, detection });
		} catch (err) {
			console.error(err);
			triggerError('ファイルの読み込みに失敗しました。');
		} finally {
			setIsProcessing(false);
			if (fileInputRef.current) fileInputRef.current.value = '';
		}
	};

	const onDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		if (!disabled && !isProcessing) {
			setIsDragging(true);
		}
	};

	const onDragLeave = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
	};

	const onDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);

		if (disabled || isProcessing) return;

		if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
			handleFile(e.dataTransfer.files[0]);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			fileInputRef.current?.click();
		}
	};

	return (
		<div className="w-full">
			{/* biome-ignore lint/a11y/useSemanticElements: file drop zone needs drag events */}
			<div
				role="button"
				tabIndex={disabled || isProcessing ? -1 : 0}
				aria-label="CSVファイルを選択またはドラッグ＆ドロップ"
				className={cn(
					'relative w-full rounded-xl border-2 border-dashed p-12 transition-all duration-200 flex flex-col items-center justify-center text-center outline-none focus-visible:ring-2 focus-visible:ring-primary',
					isDragging
						? 'border-primary bg-primary/5 scale-[1.02]'
						: 'border-muted-foreground/25 bg-muted/20 hover:bg-muted/40',
					disabled && 'opacity-50 cursor-not-allowed',
					isProcessing && 'animate-pulse',
				)}
				onDragOver={onDragOver}
				onDragLeave={onDragLeave}
				onDrop={onDrop}
				onClick={() =>
					!disabled && !isProcessing && fileInputRef.current?.click()
				}
				onKeyDown={handleKeyDown}
			>
				<UploadCloud
					className={cn(
						'w-12 h-12 mb-4 text-muted-foreground',
						isDragging && 'text-primary',
					)}
				/>

				<h3 className="text-lg font-medium tracking-tight">
					CSVファイルをドラッグ＆ドロップ
				</h3>

				<div className="mt-4 flex items-center justify-center w-full max-w-xs opacity-50">
					<div className="h-px bg-border flex-1"></div>
					<span className="px-3 text-xs uppercase tracking-wider">or</span>
					<div className="h-px bg-border flex-1"></div>
				</div>

				<button
					type="button"
					disabled={disabled || isProcessing}
					className="mt-6 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
					onClick={(e) => {
						e.stopPropagation();
						fileInputRef.current?.click();
					}}
				>
					{isProcessing ? '読み込み中...' : 'ファイルを選択'}
				</button>

				{mounted && (
					<input
						ref={fileInputRef}
						type="file"
						accept=".csv,.tsv,.txt"
						className="hidden"
						onChange={(e) => {
							if (e.target.files && e.target.files.length > 0) {
								handleFile(e.target.files[0]);
							}
						}}
					/>
				)}
			</div>

			{error && (
				<div
					role="alert"
					className={cn(
						'mt-3 flex items-center text-sm text-destructive',
						isShaking && 'animate-shake',
					)}
				>
					<AlertCircle className="w-4 h-4 mr-2" />
					{error}
				</div>
			)}

			<p className="mt-4 text-xs text-center text-muted-foreground flex items-center justify-center gap-1.5">
				<Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
				このツールは完全にブラウザ上で動作します。ファイルはサーバーに送信されません。
			</p>
		</div>
	);
}

interface EncodingDetectorProps {
	detection: DetectionResult;
	fileInfo: FileInfo;
	onEncodingOverride: (enc: EncodingType) => void;
}

const ENCODINGS: { value: EncodingType; label: string }[] = [
	{ value: 'UTF8', label: 'UTF-8' },
	{ value: 'SJIS', label: 'Shift_JIS' },
	{ value: 'EUCJP', label: 'EUC-JP' },
	{ value: 'UTF16LE', label: 'UTF-16 (LE)' },
	{ value: 'UTF16BE', label: 'UTF-16 (BE)' },
	{ value: 'ASCII', label: 'ASCII' },
];

function EncodingDetector({
	detection,
	fileInfo,
	onEncodingOverride,
}: EncodingDetectorProps) {
	const formatSize = (bytes: number) => {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
	};

	return (
		<Card className="w-full shadow-sm">
			<CardHeader className="pb-3 border-b bg-muted/20">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<FileText className="w-4 h-4 text-primary" />
						<span
							className="font-medium text-sm truncate max-w-[200px] sm:max-w-[300px]"
							title={fileInfo.name}
						>
							{fileInfo.name}
						</span>
					</div>
					<span className="text-xs text-muted-foreground">
						{formatSize(fileInfo.size)}
					</span>
				</div>
			</CardHeader>
			<CardContent className="pt-4 space-y-4">
				{detection.confidence === 'low' && (
					<div className="flex items-start text-xs rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-500 p-3">
						<AlertTriangle className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
						<p>
							エンコーディングの自動検出の信頼度が低いです。手動で選択してください。
						</p>
					</div>
				)}

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mt-2">
					<div className="space-y-1.5">
						<p className="text-xs font-medium text-muted-foreground">
							現在のエンコーディング
						</p>
						<Select
							value={detection.encoding}
							onValueChange={(val) => onEncodingOverride(val as EncodingType)}
						>
							<SelectTrigger className="w-full h-8 text-sm">
								<SelectValue placeholder="エンコード" />
							</SelectTrigger>
							<SelectContent>
								{ENCODINGS.map((enc) => (
									<SelectItem key={enc.value} value={enc.value}>
										{enc.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid grid-cols-3 gap-2">
						<div className="space-y-1">
							<span className="text-xs font-medium text-muted-foreground block">
								改行コード
							</span>
							<span className="block truncate font-mono text-xs">
								{fileInfo.lineEnding}
							</span>
						</div>
						<div className="space-y-1">
							<span className="text-xs font-medium text-muted-foreground block">
								BOM
							</span>
							<span className="block truncate">
								{fileInfo.hasBom ? 'あり' : 'なし'}
							</span>
						</div>
						<div className="space-y-1">
							<span className="text-xs font-medium text-muted-foreground block">
								推定行数
							</span>
							<span className="block truncate">
								{fileInfo.lineCount.toLocaleString()}
							</span>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

interface CsvPreviewProps {
	preview: PreviewResult | null;
	isLoading: boolean;
}

function CsvPreview({ preview, isLoading }: CsvPreviewProps) {
	if (isLoading) {
		return (
			<Card className="w-full">
				<CardContent className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-4">
					<Loader2 className="w-8 h-8 animate-spin" />
					<p className="text-sm">プレビューを作成中...</p>
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

interface ConversionOptionsProps {
	settings: UserSettings;
	onSettingsChange: (settings: UserSettings) => void;
}

function ConversionOptions({
	settings,
	onSettingsChange,
}: ConversionOptionsProps) {
	const handleUpdate = (updates: Partial<UserSettings>) => {
		let newAddBom =
			updates.addBom !== undefined ? updates.addBom : settings.addBom;

		if (
			updates.outputEncoding &&
			(updates.outputEncoding === 'SJIS' || updates.outputEncoding === 'EUCJP')
		) {
			newAddBom = false;
		} else if (
			updates.outputEncoding === 'UTF8' &&
			settings.outputEncoding !== 'UTF8'
		) {
			newAddBom = true;
		}

		onSettingsChange({
			...settings,
			...updates,
			addBom: newAddBom,
		});
	};

	return (
		<Card className="w-full shadow-sm">
			<CardHeader className="pb-3 border-b bg-muted/20">
				<CardTitle className="text-sm font-medium">出力オプション</CardTitle>
			</CardHeader>
			<CardContent className="pt-4 space-y-5">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
					<div className="space-y-2">
						<Label
							htmlFor="output-encoding"
							className="text-xs font-medium text-muted-foreground"
						>
							出力エンコーディング
						</Label>
						<Select
							value={settings.outputEncoding}
							onValueChange={(val) =>
								handleUpdate({ outputEncoding: val as EncodingType })
							}
						>
							<SelectTrigger id="output-encoding" className="h-9">
								<SelectValue placeholder="エンコード" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="UTF8">UTF-8 (推奨)</SelectItem>
								<SelectItem value="SJIS">Shift_JIS</SelectItem>
								<SelectItem value="EUCJP">EUC-JP</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-[10px] text-muted-foreground mt-1 text-balance">
							{settings.outputEncoding === 'UTF8'
								? 'Excelで開く場合はBOM付与を推奨します。'
								: 'レガシーシステム向けの形式です。'}
						</p>
					</div>

					<div className="space-y-2">
						<Label
							htmlFor="line-ending"
							className="text-xs font-medium text-muted-foreground"
						>
							改行コード
						</Label>
						<Select
							value={settings.lineEnding}
							onValueChange={(val) =>
								handleUpdate({ lineEnding: val as 'CRLF' | 'LF' | 'CR' })
							}
						>
							<SelectTrigger id="line-ending" className="h-9">
								<SelectValue placeholder="改行コード" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="CRLF">CR+LF (Windows)</SelectItem>
								<SelectItem value="LF">LF (Mac/Linux)</SelectItem>
								<SelectItem value="CR">CR (Classic Mac)</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>

				<div className="flex items-center space-x-2 pt-1">
					<Checkbox
						id="add-bom"
						checked={settings.addBom}
						onCheckedChange={(checked) =>
							handleUpdate({ addBom: checked === true })
						}
						disabled={
							settings.outputEncoding === 'SJIS' ||
							settings.outputEncoding === 'EUCJP'
						}
					/>
					<Label
						htmlFor="add-bom"
						className={`text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${
							settings.outputEncoding === 'SJIS' ||
							settings.outputEncoding === 'EUCJP'
								? 'text-muted-foreground'
								: ''
						}`}
					>
						BOM (バイトオーダーマーク) を付与する
					</Label>
				</div>
			</CardContent>
		</Card>
	);
}

interface DownloadButtonProps {
	buffer: ArrayBuffer;
	originalFilename: string;
	sourceEncoding: EncodingType;
	options: EncodingConversionOptions;
	disabled: boolean;
	onConverted?: () => void;
	globalStatus?:
		| 'idle'
		| 'detecting'
		| 'ready'
		| 'converting'
		| 'done'
		| 'error';
}

function DownloadButton({
	buffer,
	originalFilename,
	sourceEncoding,
	options,
	disabled,
	onConverted,
	globalStatus,
}: DownloadButtonProps) {
	const [status, setStatus] = useState<
		'idle' | 'converting' | 'success' | 'error'
	>('idle');
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	useEffect(() => {
		setStatus('idle');
		setErrorMessage(null);
	}, []);

	const handleDownload = async () => {
		if (disabled || status === 'converting') return;

		setStatus('converting');
		setErrorMessage(null);

		try {
			await new Promise((res) =>
				requestAnimationFrame(() => requestAnimationFrame(res)),
			);

			const { blob, fileName } = convertEncoding(
				buffer,
				sourceEncoding,
				options,
				originalFilename,
			);

			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = fileName;
			a.dataset.astroReload = 'true';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);

			setTimeout(() => URL.revokeObjectURL(url), 1000);

			setStatus('success');
			onConverted?.();

			setTimeout(() => {
				setStatus((prev) => (prev === 'success' ? 'idle' : prev));
			}, 3000);
		} catch (e: unknown) {
			console.error('Conversion error:', e);
			setStatus('error');

			if (
				e instanceof RangeError ||
				e instanceof TypeError ||
				String(e).includes('memory')
			) {
				setErrorMessage(
					'ファイルが大きすぎます。より小さいファイルでお試しください。',
				);
			} else {
				setErrorMessage(
					'変換中にエラーが発生しました。エンコーディングを変更して再度お試しください。',
				);
			}
		}
	};

	return (
		<div className="w-full flex flex-col items-center">
			<Button
				onClick={handleDownload}
				disabled={disabled || status === 'converting'}
				size="lg"
				className={cn(
					'w-full max-w-sm h-14 text-base font-semibold shadow-md transition-all',
					status === 'success' && 'bg-green-600 hover:bg-green-700 text-white',
				)}
			>
				{status === 'converting' || globalStatus === 'converting' ? (
					<>
						<Loader2 className="mr-2 h-5 w-5 animate-spin" />
						変換中...
					</>
				) : status === 'success' || globalStatus === 'done' ? (
					<>
						<CheckCircle2 className="mr-2 h-5 w-5 animate-in zoom-in" />
						ダウンロード完了
					</>
				) : (
					<>
						<Download className="mr-2 h-5 w-5" />
						変換してダウンロード
					</>
				)}
			</Button>

			{status === 'error' && errorMessage && (
				<div className="mt-3 text-sm text-destructive flex items-center bg-destructive/10 px-3 py-2 rounded-md">
					<AlertCircle className="w-4 h-4 mr-2 shrink-0" />
					<p>{errorMessage}</p>
				</div>
			)}
		</div>
	);
}

// --- Main Exported Component ---

export default function CsvFixer() {
	const { trackRun } = useToolAnalytics('csv-fixer');
	const [file, setFile] = useState<File | null>(null);
	const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
	const [detection, setDetection] = useState<DetectionResult | null>(null);
	const [effectiveEncoding, setEffectiveEncoding] =
		useState<EncodingType>('UTF8');
	const [preview, setPreview] = useState<PreviewResult | null>(null);
	const [settings, setSettings] = useState<UserSettings>(loadSettings());
	const [status, setStatus] = useState<
		'idle' | 'detecting' | 'ready' | 'converting' | 'done' | 'error'
	>('idle');
	const [isPreviewLoading, setIsPreviewLoading] = useState(false);

	const [fileInfo, setFileInfo] = useState<{
		name: string;
		size: number;
		lineEnding: 'CRLF' | 'LF' | 'CR' | 'MIXED' | 'NONE';
		hasBom: boolean;
		lineCount: number;
	} | null>(null);

	const analyzeBuffer = useCallback((buf: ArrayBuffer, enc: EncodingType) => {
		setIsPreviewLoading(true);

		requestAnimationFrame(() => {
			try {
				const bytes = new Uint8Array(buf);

				let hasBom = false;
				if (
					bytes.length >= 3 &&
					bytes[0] === 0xef &&
					bytes[1] === 0xbb &&
					bytes[2] === 0xbf
				) {
					hasBom = true;
				} else if (
					bytes.length >= 2 &&
					((bytes[0] === 0xff && bytes[1] === 0xfe) ||
						(bytes[0] === 0xfe && bytes[1] === 0xff))
				) {
					hasBom = true;
				}

				const decodedStringArray = Encoding.convert(bytes, {
					to: 'UNICODE',
					from: enc,
					type: 'array',
				});
				const decodedStr = Encoding.codeToString(decodedStringArray);

				const lineEnding = detectLineEnding(decodedStr);
				const previewResult = parsePreview(decodedStr, 10);

				setPreview(previewResult);
				setFileInfo((prev) =>
					prev
						? {
								...prev,
								lineEnding,
								hasBom,
								lineCount: previewResult.totalRowEstimate,
							}
						: null,
				);
			} catch (e) {
				console.error('Failed to parse preview', e);
				setPreview(null);
			} finally {
				setIsPreviewLoading(false);
			}
		});
	}, []);

	const handleFileLoaded = (event: FileLoadedEvent) => {
		setFile(event.file);
		setBuffer(event.buffer);
		setDetection(event.detection);
		setEffectiveEncoding(event.detection.encoding);
		setStatus('ready');

		setFileInfo({
			name: event.file.name,
			size: event.file.size,
			lineEnding: 'NONE',
			hasBom: false,
			lineCount: 0,
		});

		analyzeBuffer(event.buffer, event.detection.encoding);

		if (
			settings.instantMode &&
			event.detection.encoding &&
			event.detection.confidence !== 'low'
		) {
			setTimeout(() => {
				executeInstantDownload(
					event.buffer,
					event.detection.encoding,
					event.file.name,
				);
			}, 100);
		}
	};

	const handleSettingsChange = (newSettings: UserSettings) => {
		setSettings(newSettings);
		saveSettings(newSettings);
	};

	const handleEncodingOverride = (enc: EncodingType) => {
		setEffectiveEncoding(enc);
		if (buffer) {
			analyzeBuffer(buffer, enc);
		}
	};

	const executeInstantDownload = (
		buf: ArrayBuffer,
		sourceEnc: EncodingType,
		fileName: string,
	) => {
		if (status === 'converting') return;
		setStatus('converting');
		try {
			const { blob, fileName: outName } = convertEncoding(
				buf,
				sourceEnc,
				settings,
				fileName,
			);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = outName;
			a.dataset.astroReload = 'true';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			setStatus('done');
			trackRun();
		} catch (e) {
			console.error(e);
			setStatus('error');
		}
	};

	const resetState = () => {
		setFile(null);
		setBuffer(null);
		setDetection(null);
		setPreview(null);
		setFileInfo(null);
		setStatus('idle');
	};

	return (
		<div className="w-full max-w-4xl mx-auto space-y-8">
			{!file ? (
				<div className="space-y-6">
					<div className="max-w-md mx-auto">
						<InstantModeToggle
							enabled={settings.instantMode}
							onToggle={(enabled) =>
								handleSettingsChange({ ...settings, instantMode: enabled })
							}
						/>
					</div>
					<FileDropZone
						onFileLoaded={handleFileLoaded}
						disabled={status === 'detecting'}
					/>
				</div>
			) : (
				<div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
					<div className="flex justify-between items-center bg-muted/30 p-4 rounded-lg border">
						<div className="flex items-center space-x-3">
							<div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
								<span className="text-primary text-xl font-bold">1</span>
							</div>
							<div>
								<h3 className="font-semibold leading-none">ファイルの確認</h3>
								<p className="text-xs text-muted-foreground mt-1 text-balance">
									元のエンコーディングとプレビューを確認します。
								</p>
							</div>
						</div>
						<button
							type="button"
							onClick={resetState}
							className="text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-4"
						>
							別のファイルを変換
						</button>
					</div>

					{detection && fileInfo && (
						<EncodingDetector
							detection={{ ...detection, encoding: effectiveEncoding }}
							fileInfo={fileInfo}
							onEncodingOverride={handleEncodingOverride}
						/>
					)}

					<CsvPreview preview={preview} isLoading={isPreviewLoading} />

					<div className="bg-muted/30 p-4 rounded-lg border flex items-center space-x-3 mt-8">
						<div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
							<span className="text-primary text-xl font-bold">2</span>
						</div>
						<div>
							<h3 className="font-semibold leading-none">出力とダウンロード</h3>
							<p className="text-xs text-muted-foreground mt-1">
								希望のエンコード形式を選択してダウンロードします。
							</p>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-start">
						<div className="md:col-span-3">
							<ConversionOptions
								settings={settings}
								onSettingsChange={handleSettingsChange}
							/>
						</div>
						<div className="md:col-span-2 flex items-center justify-center h-full min-h-[140px] border rounded-lg bg-card shadow-sm p-4">
							{buffer && (
								<DownloadButton
									buffer={buffer}
									originalFilename={file.name}
									sourceEncoding={effectiveEncoding}
									options={settings}
									disabled={isPreviewLoading || status === 'error'}
									onConverted={trackRun}
									globalStatus={status}
								/>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
