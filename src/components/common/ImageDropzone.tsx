// ImageDropzone — 画像入力の共有コンポーネント
// ドラッグ＆ドロップ / ファイルピッカー / クリップボード貼り付けに対応。
// バリデーションは行わず、選択された File をそのまま親へ渡す（エラー表示の一元化のため）

import { Lock, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

type ImageDropzoneProps = {
	onFileAccepted: (file: File) => void;
	disabled?: boolean;
};

export function ImageDropzone({
	onFileAccepted,
	disabled,
}: ImageDropzoneProps) {
	const [isDragOver, setIsDragOver] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragOver(true);
	}, []);

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
			const file = e.dataTransfer.files[0];
			if (file) onFileAccepted(file);
		},
		[disabled, onFileAccepted],
	);

	const handleFileSelect = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) onFileAccepted(file);
			// 同じファイルの再選択を可能にする
			e.target.value = '';
		},
		[onFileAccepted],
	);

	// クリップボード貼り付け（ページ全体で受け付ける）
	useEffect(() => {
		if (disabled) return;
		const handler = (e: ClipboardEvent) => {
			const items = e.clipboardData?.items;
			if (!items) return;
			for (const item of items) {
				if (item.type.startsWith('image/')) {
					const file = item.getAsFile();
					if (file) {
						e.preventDefault();
						onFileAccepted(file);
						return;
					}
				}
			}
		};
		document.addEventListener('paste', handler);
		return () => document.removeEventListener('paste', handler);
	}, [disabled, onFileAccepted]);

	return (
		<div>
			<button
				type="button"
				disabled={disabled}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				onClick={() => fileInputRef.current?.click()}
				className={`
					w-full relative flex flex-col items-center justify-center gap-4
					rounded-xl border-2 border-dashed p-12 cursor-pointer
					transition-all duration-200 bg-transparent
					disabled:cursor-not-allowed disabled:opacity-50
					${
						isDragOver
							? 'border-primary bg-primary/5 scale-[1.01]'
							: 'border-border hover:border-primary/50 hover:bg-muted/30'
					}
				`}
			>
				<div className="rounded-full bg-primary/10 p-4">
					<Upload className="h-8 w-8 text-primary" />
				</div>
				<div className="text-center">
					<p className="text-lg font-medium">
						画像をドラッグ＆ドロップ、またはクリックして選択
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						（クリップボード貼り付け対応）PNG・JPEG・WebP、20MB以下
					</p>
				</div>
			</button>
			<p className="mt-3 flex items-center justify-center gap-1 text-xs text-muted-foreground">
				<Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
				画像はサーバーに送信されません。すべてブラウザ内で処理されます。
			</p>
			<input
				ref={fileInputRef}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				onChange={handleFileSelect}
				className="hidden"
			/>
		</div>
	);
}
