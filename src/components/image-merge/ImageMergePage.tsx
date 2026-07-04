// ImageMergePage — 画像連結・コンタクトシートツールのオーケストレーター
// すべてブラウザ内（Canvas API）で処理し、画像はサーバーに送信されない。
// プレビューと出力は同一の computeLayout / mergeImages から生成し乖離させない。

import { Download, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { useSingleResultProcessing } from '@/lib/hooks/useSingleResultProcessing.ts';
import { createId, downloadBlob } from '@/lib/tools/image-common';
import {
	buildMergedFilename,
	computeLayout,
	DEFAULT_MERGE_OPTIONS,
	exportCanvas,
	type ImageSize,
	loadImageBitmap,
	MAX_FILE_COUNT,
	type MergeOptions,
	mergeImages,
	validateBatch,
	validateImageFile,
} from '@/lib/tools/image-merge';
import { MergeOptionsPanel } from './MergeOptionsPanel';
import { type MergeImageItem, SortableImageList } from './SortableImageList';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

type LoadedItem = MergeImageItem & { bitmap: ImageBitmap };

export function ImageMergePage() {
	const [items, setItems] = useState<LoadedItem[]>([]);
	const [options, setOptions] = useState<MergeOptions>(DEFAULT_MERGE_OPTIONS);
	const [outputSize, setOutputSize] = useState<{
		width: number;
		height: number;
	} | null>(null);
	// 画像の読み込み中フラグ（結合結果の生成・ダウンロードは useSingleResultProcessing が管理）
	const [loadingFiles, setLoadingFiles] = useState(false);
	const { processing, error, setError, run } = useSingleResultProcessing<Blob>({
		fallbackErrorMessage: '画像の書き出しに失敗しました。',
	});
	const busy = loadingFiles || processing;

	const canvasRef = useRef<HTMLCanvasElement>(null);
	const itemsRef = useRef<LoadedItem[]>([]);
	itemsRef.current = items;

	// アンマウント時に object URL と ImageBitmap を解放する
	useEffect(() => {
		return () => {
			for (const it of itemsRef.current) {
				URL.revokeObjectURL(it.previewUrl);
				it.bitmap.close();
			}
		};
	}, []);

	// プレビュー（= 出力）を再描画する。items / options 変更時に走る。
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		if (items.length === 0) {
			const ctx = canvas.getContext('2d');
			canvas.width = 0;
			canvas.height = 0;
			ctx?.clearRect(0, 0, canvas.width, canvas.height);
			setOutputSize(null);
			setError(null);
			return;
		}

		const sizes: ImageSize[] = items.map((it) => ({
			width: it.width,
			height: it.height,
		}));
		const layout = computeLayout(sizes, options);
		try {
			const merged = mergeImages(
				items.map((it) => it.bitmap),
				layout,
				options,
			);
			canvas.width = merged.width;
			canvas.height = merged.height;
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				ctx.drawImage(merged, 0, 0);
			}
			setOutputSize({ width: merged.width, height: merged.height });
			setError(null);
		} catch (err) {
			setOutputSize(null);
			setError(
				err instanceof Error ? err.message : 'プレビューの生成に失敗しました。',
			);
		}
	}, [items, options, setError]);

	const handleFilesSelect = useCallback(
		async (files: File[]) => {
			const existing = itemsRef.current;
			const totalCount = existing.length + files.length;
			const totalSize =
				existing.reduce((sum, it) => sum + it.file.size, 0) +
				files.reduce((sum, f) => sum + f.size, 0);
			const batchCheck = validateBatch(totalCount, totalSize);
			if (!batchCheck.ok) {
				setError(batchCheck.message);
				return;
			}

			const valid: File[] = [];
			const errors: string[] = [];
			for (const file of files) {
				const v = validateImageFile(file);
				if (v.ok) valid.push(file);
				else errors.push(`${file.name}: ${v.message}`);
			}
			if (valid.length === 0) {
				setError(errors.join('\n'));
				return;
			}

			setLoadingFiles(true);
			const loaded: LoadedItem[] = [];
			for (const file of valid) {
				try {
					const bitmap = await loadImageBitmap(file);
					loaded.push({
						id: createId(),
						file,
						previewUrl: URL.createObjectURL(file),
						width: bitmap.width,
						height: bitmap.height,
						bitmap,
					});
				} catch {
					errors.push(`${file.name}: 画像の読み込みに失敗しました。`);
				}
			}
			setLoadingFiles(false);
			setError(errors.length > 0 ? errors.join('\n') : null);
			if (loaded.length > 0) {
				setItems((prev) => [...prev, ...loaded]);
			}
		},
		[setError],
	);

	const handleReorder = useCallback((from: number, to: number) => {
		setItems((prev) => {
			if (to < 0 || to >= prev.length) return prev;
			const next = [...prev];
			const [moved] = next.splice(from, 1);
			next.splice(to, 0, moved);
			return next;
		});
	}, []);

	const handleRemove = useCallback((id: string) => {
		setItems((prev) => {
			const target = prev.find((it) => it.id === id);
			if (target) {
				URL.revokeObjectURL(target.previewUrl);
				target.bitmap.close();
			}
			return prev.filter((it) => it.id !== id);
		});
	}, []);

	const handleClear = useCallback(() => {
		for (const it of itemsRef.current) {
			URL.revokeObjectURL(it.previewUrl);
			it.bitmap.close();
		}
		setItems([]);
		setError(null);
		setOutputSize(null);
	}, [setError]);

	const handleDownload = useCallback(async () => {
		const canvas = canvasRef.current;
		if (!canvas || items.length === 0) return;

		await run(1, async () => {
			const sizes: ImageSize[] = items.map((it) => ({
				width: it.width,
				height: it.height,
			}));
			const layout = computeLayout(sizes, options);
			const merged = mergeImages(
				items.map((it) => it.bitmap),
				layout,
				options,
			);
			const blob = await exportCanvas(merged, options);
			downloadBlob(blob, buildMergedFilename(options.output));
			return blob;
		});
	}, [items, options, run]);

	return (
		<div className="space-y-6">
			<FileDropzone
				multiple
				onFileSelect={() => {}}
				onFilesSelect={(files) => void handleFilesSelect(files)}
				onValidationError={(msg) => setError(msg)}
				accept={ACCEPT}
				disabled={busy}
				label="画像をドラッグ＆ドロップ"
				description={`またはクリックして画像を選択（最大${MAX_FILE_COUNT}枚）`}
				privacyNote="画像はサーバーに送信されません。すべてブラウザ内で処理されます。"
				inputAriaLabel="結合する画像を選択"
				data-testid="image-merge-input"
			/>

			{error && (
				<div
					role="alert"
					className="whitespace-pre-wrap rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
				>
					{error}
				</div>
			)}

			{items.length > 0 && (
				<>
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<p className="text-sm font-semibold">
								画像一覧（{items.length}枚 / ドラッグまたは矢印で並び替え）
							</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={handleClear}
								disabled={busy}
							>
								<Trash2 className="mr-1 h-4 w-4" />
								すべてクリア
							</Button>
						</div>
						<SortableImageList
							items={items}
							disabled={busy}
							onReorder={handleReorder}
							onRemove={handleRemove}
						/>
					</div>

					<MergeOptionsPanel
						options={options}
						disabled={busy}
						onChange={setOptions}
					/>

					<div className="space-y-2">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<p className="text-sm font-semibold">
								プレビュー
								{outputSize && (
									<span className="ml-2 font-normal text-muted-foreground">
										（出力サイズ: {outputSize.width}×{outputSize.height}px）
									</span>
								)}
							</p>
							<Button
								type="button"
								onClick={() => void handleDownload()}
								disabled={busy || items.length === 0 || !outputSize}
							>
								{busy ? (
									<Loader2 className="mr-1 h-4 w-4 animate-spin" />
								) : (
									<Download className="mr-1 h-4 w-4" />
								)}
								結合画像をダウンロード
							</Button>
						</div>
						<div className="overflow-auto rounded-lg border border-border bg-[repeating-conic-gradient(#0001_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-4">
							<canvas
								ref={canvasRef}
								data-testid="merge-preview-canvas"
								aria-label="結合プレビュー"
								className="mx-auto block h-auto max-w-full"
							/>
						</div>
					</div>
				</>
			)}
		</div>
	);
}

export default ImageMergePage;
