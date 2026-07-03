import { AlertTriangle, Loader2, Upload, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { decodeImageFile } from '@/lib/tools/qr-reader';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 1ファイルあたり15MB
const MAX_TOTAL_SIZE = 80 * 1024 * 1024; // バッチ合計80MB
const MAX_FILES = 30;

interface ImageUploaderProps {
	onDecoded: (fileName: string, values: string[]) => void;
}

type BatchState = {
	total: number;
	done: number;
	currentFileName: string | null;
} | null;

export default function ImageUploader({ onDecoded }: ImageUploaderProps) {
	const [isDragOver, setIsDragOver] = useState(false);
	const [batch, setBatch] = useState<BatchState>(null);
	const [error, setError] = useState<string | null>(null);
	const [zeroDetectHint, setZeroDetectHint] = useState(false);
	const cancelRef = useRef(false);
	const runIdRef = useRef(0); // 実行中バッチを識別し、古いバッチの結果混入を防ぐ
	const fileInputRef = useRef<HTMLInputElement>(null);

	const validateBatch = useCallback((files: File[]): string | null => {
		if (files.length === 0) return null;
		if (files.length > MAX_FILES) {
			return `一度に読み込めるのは${MAX_FILES}ファイルまでです`;
		}
		const invalid = files.find((f) => !ACCEPTED_TYPES.includes(f.type));
		if (invalid) {
			return '対応形式: PNG、JPG、WEBP、GIF のみ';
		}
		const tooLarge = files.find((f) => f.size > MAX_FILE_SIZE);
		if (tooLarge) {
			return `ファイルサイズは1件あたり${MAX_FILE_SIZE / 1024 / 1024}MB以下にしてください`;
		}
		const totalSize = files.reduce((sum, f) => sum + f.size, 0);
		if (totalSize > MAX_TOTAL_SIZE) {
			return `合計ファイルサイズは${MAX_TOTAL_SIZE / 1024 / 1024}MB以下にしてください`;
		}
		return null;
	}, []);

	const processFiles = useCallback(
		async (files: File[]) => {
			const validationError = validateBatch(files);
			if (validationError) {
				setError(validationError);
				return;
			}
			setError(null);
			setZeroDetectHint(false);
			cancelRef.current = false;
			// 実行中バッチがあれば無効化し、新しいバッチだけが結果を反映できるようにする
			const runId = ++runIdRef.current;
			const isCurrentRun = () =>
				runIdRef.current === runId && !cancelRef.current;
			setBatch({ total: files.length, done: 0, currentFileName: null });

			let detectedAny = false;

			for (const file of files) {
				if (!isCurrentRun()) break;

				setBatch((prev) =>
					prev ? { ...prev, currentFileName: file.name } : prev,
				);

				try {
					const symbols = await decodeImageFile(file.name, file);
					// デコード待ちの間にキャンセル/新バッチ開始された場合は結果を破棄する
					if (!isCurrentRun()) break;
					if (symbols.length > 0) {
						detectedAny = true;
						onDecoded(
							file.name,
							symbols.map((s) => s.text),
						);
					}
				} catch {
					// 破損ファイル等はスキップして続行
					if (!isCurrentRun()) break;
				}

				setBatch((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
			}

			if (runIdRef.current === runId) {
				setBatch(null);
				if (!detectedAny && !cancelRef.current) {
					setZeroDetectHint(true);
				}
			}
		},
		[validateBatch, onDecoded],
	);

	const handleFileSelect = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const files = Array.from(e.target.files ?? []);
			e.target.value = '';
			if (files.length > 0) processFiles(files);
		},
		[processFiles],
	);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setIsDragOver(false);
			const files = Array.from(e.dataTransfer.files);
			if (files.length > 0) processFiles(files);
		},
		[processFiles],
	);

	const handleCancel = useCallback(() => {
		cancelRef.current = true;
		setBatch(null);
	}, []);

	return (
		<div className="space-y-3">
			<button
				type="button"
				onDragOver={(e) => {
					e.preventDefault();
					setIsDragOver(true);
				}}
				onDragLeave={(e) => {
					e.preventDefault();
					setIsDragOver(false);
				}}
				onDrop={handleDrop}
				onClick={() => fileInputRef.current?.click()}
				className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
					isDragOver
						? 'border-primary bg-primary/5'
						: 'border-border hover:border-primary/50'
				}`}
			>
				<Upload className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
				<p className="text-sm font-medium">
					画像をドラッグ＆ドロップ、またはクリックして選択
				</p>
				<p className="text-xs text-muted-foreground">
					複数ファイル選択可能・PNG/JPG/WEBP/GIF・1件
					{MAX_FILE_SIZE / 1024 / 1024}
					MBまで
				</p>
				<input
					ref={fileInputRef}
					type="file"
					accept={ACCEPTED_TYPES.join(',')}
					multiple
					className="sr-only"
					onChange={handleFileSelect}
					aria-label="QRコード画像を選択"
				/>
			</button>

			{batch && (
				<div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-sm">
					<Loader2
						className="h-4 w-4 shrink-0 animate-spin text-primary"
						aria-hidden="true"
					/>
					<div className="flex-1 min-w-0">
						<p className="truncate">
							処理中: {batch.currentFileName ?? ''}（{batch.done}/{batch.total}
							）
						</p>
						<div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div
								className="h-full bg-primary transition-all"
								style={{
									width: `${batch.total > 0 ? (batch.done / batch.total) * 100 : 0}%`,
								}}
							/>
						</div>
					</div>
					<Button variant="ghost" size="sm" onClick={handleCancel}>
						キャンセル
					</Button>
				</div>
			)}

			{error && (
				<div className="flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
					<AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
					<span>{error}</span>
					<Button
						variant="ghost"
						size="sm"
						className="ml-auto"
						onClick={() => setError(null)}
					>
						<X className="h-4 w-4" />
					</Button>
				</div>
			)}

			{zeroDetectHint && (
				<div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
					QRコードが見つかりませんでした。画像がはっきり写っているか、QRコードが画像内に含まれているかご確認ください。
				</div>
			)}
		</div>
	);
}
