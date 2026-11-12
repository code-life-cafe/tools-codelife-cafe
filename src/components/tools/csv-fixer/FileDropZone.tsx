import { AlertCircle, Info, UploadCloud } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { detectEncoding } from '@/lib/encoding/detect';
import { cn } from '@/lib/utils';
import {
	getMaxFileSize,
	validateFile,
} from '@/lib/validation/fileValidator.ts';
import type { FileLoadedEvent } from './shared';

interface FileDropZoneProps {
	onFileLoaded: (event: FileLoadedEvent) => void;
	disabled?: boolean;
}

export function FileDropZone({ onFileLoaded, disabled }: FileDropZoneProps) {
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
					`ファイルサイズが大きすぎます（上限: ${validation.maxSize / 1024 / 1024}MiB）。ファイルを分割してお試しください。`,
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
				<p className="mt-2 text-sm text-muted-foreground">
					上限{getMaxFileSize() / 1024 / 1024}MiB（
					{getMaxFileSize().toLocaleString('ja-JP')}
					バイト）。大きなファイルは分割してから選択してください。
				</p>
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

			{isProcessing && (
				<p role="status" className="mt-2 text-sm text-center">
					1/2 読み込み・文字コード判定中...
				</p>
			)}

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
