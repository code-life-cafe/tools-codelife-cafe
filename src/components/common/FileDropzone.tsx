import { Lock, Upload, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface FileDropzoneProps {
	/** 検証を通過したファイルのみ通知される（単一選択時） */
	onFileSelect: (file: File) => void;
	/** 複数選択を許可する（デフォルト false）。既存の単一選択挙動は不変 */
	multiple?: boolean;
	/** multiple 時に選択された全ファイルを通知する（ドメイン検証は呼び出し側で行う） */
	onFilesSelect?: (files: File[]) => void;
	/** 検証失敗時のエラーメッセージ通知（表示は呼び出し側で行う） */
	onValidationError?: (message: string) => void;
	/** input の accept 属性（例: '.json,.csv,.txt'）。未指定は任意ファイル */
	accept?: string;
	/** ファイルサイズ上限（バイト）。超過時は validationMessage を通知 */
	maxSizeBytes?: number;
	/** maxSizeBytes 超過時のメッセージ */
	validationMessage?: string;
	/** 追加の検証フック。エラーメッセージを返すと選択を拒否（null = OK） */
	validate?: (file: File) => string | null;
	label?: string;
	description?: string;
	privacyNote?: string;
	/** 選択中ファイル名の表示（controlled） */
	selectedFileName?: string | null;
	/** 指定時のみクリアボタンを表示 */
	onClear?: () => void;
	disabled?: boolean;
	inputAriaLabel?: string;
	className?: string;
	'data-testid'?: string;
}

function matchesAccept(file: File, accept?: string): boolean {
	if (!accept) return true;
	const fileName = file.name.toLowerCase();
	const fileType = file.type.toLowerCase();
	return accept
		.split(',')
		.map((token) => token.trim().toLowerCase())
		.filter(Boolean)
		.some((token) => {
			if (token.startsWith('.')) return fileName.endsWith(token);
			if (token.endsWith('/*')) {
				return fileType.startsWith(token.slice(0, -1));
			}
			return fileType === token;
		});
}

export function FileDropzone({
	onFileSelect,
	multiple = false,
	onFilesSelect,
	onValidationError,
	accept,
	maxSizeBytes,
	validationMessage = 'ファイルサイズが上限を超えています。',
	validate,
	label = 'ファイルをドラッグ＆ドロップ',
	description = 'またはクリックしてファイルを選択',
	privacyNote = 'ファイルはサーバーに送信されません。すべてブラウザ内で処理されます。',
	selectedFileName,
	onClear,
	disabled = false,
	inputAriaLabel = 'ファイルを選択',
	className,
	'data-testid': dataTestId,
}: FileDropzoneProps) {
	const [isDragOver, setIsDragOver] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleFile = useCallback(
		(file: File) => {
			if (!matchesAccept(file, accept)) {
				onValidationError?.('対応していないファイル形式です。');
				return;
			}
			if (maxSizeBytes != null && file.size > maxSizeBytes) {
				onValidationError?.(validationMessage);
				return;
			}
			const customError = validate?.(file);
			if (customError) {
				onValidationError?.(customError);
				return;
			}
			onFileSelect(file);
		},
		[
			accept,
			maxSizeBytes,
			validationMessage,
			validate,
			onFileSelect,
			onValidationError,
		],
	);

	const handleDragOver = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (!disabled) setIsDragOver(true);
		},
		[disabled],
	);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragOver(false);
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setIsDragOver(false);
			if (disabled) return;
			const files = e.dataTransfer.files;
			if (multiple) {
				if (files.length > 0) onFilesSelect?.(Array.from(files));
				return;
			}
			const file = files[0];
			if (file) handleFile(file);
		},
		[disabled, handleFile, multiple, onFilesSelect],
	);

	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files;
			if (multiple) {
				if (files && files.length > 0) onFilesSelect?.(Array.from(files));
			} else {
				const file = files?.[0];
				if (file) handleFile(file);
			}
			// 同じファイルの再選択を可能にする
			e.target.value = '';
		},
		[handleFile, multiple, onFilesSelect],
	);

	return (
		<div className={className}>
			<button
				type="button"
				disabled={disabled}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				onClick={() => fileInputRef.current?.click()}
				className={cn(
					'w-full relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-all duration-200 bg-transparent',
					isDragOver
						? 'border-primary bg-primary/5 scale-[1.01]'
						: 'border-border hover:border-primary/50 hover:bg-muted/30',
					disabled && 'opacity-50 cursor-not-allowed',
				)}
			>
				<div className="rounded-full bg-primary/10 p-3">
					<Upload className="h-6 w-6 text-primary" />
				</div>
				<div className="text-center">
					<p className="text-sm font-medium">{label}</p>
					<p className="mt-1 text-xs text-muted-foreground">{description}</p>
					<p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
						<Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
						{privacyNote}
					</p>
				</div>
				<input
					ref={fileInputRef}
					type="file"
					accept={accept}
					multiple={multiple}
					aria-label={inputAriaLabel}
					data-testid={dataTestId}
					onChange={handleInputChange}
					className="hidden"
				/>
			</button>
			{selectedFileName && (
				<div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
					<span className="truncate font-mono" title={selectedFileName}>
						{selectedFileName}
					</span>
					{onClear && (
						<Button
							variant="ghost"
							size="icon"
							className="ml-auto h-6 w-6 shrink-0"
							onClick={onClear}
							aria-label="選択をクリア"
						>
							<X className="h-4 w-4" />
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
