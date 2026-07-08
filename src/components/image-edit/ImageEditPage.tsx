// ImageEditPage — 画像クロップ・回転・反転ツールのオーケストレーター
// FileDropzone で受け取り → CropOverlay + EditToolbar で操作 → EditPreview で確認 → DL/ZIP

import { CheckCircle2, Download, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { useBatchProcessing } from '@/lib/hooks/useBatchProcessing';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { createId } from '@/lib/tools/image-common';
import {
	applyEdit,
	type CropRect,
	computeCenterCrop,
	DEFAULT_EDIT_OPS,
	downloadEditedFile,
	downloadEditedZip,
	type EditOps,
	type EditResult,
	loadBitmap,
	MAX_FILE_COUNT,
	validateEditBatch,
	validateEditImageFile,
} from '@/lib/tools/image-edit';
import { CropOverlay } from './CropOverlay';
import { EditPreview } from './EditPreview';
import {
	type AspectPreset,
	aspectPresetToRatio,
	EditToolbar,
} from './EditToolbar';

const ACCEPT = 'image/jpeg,image/png,image/webp';

type EditItem = {
	id: string;
	status: 'pending' | 'done' | 'error';
	error?: string;
	file: File;
	previewUrl: string;
	bitmap: ImageBitmap | null;
};

function releaseEditItem(item: EditItem): void {
	URL.revokeObjectURL(item.previewUrl);
	item.bitmap?.close();
}

export default function ImageEditPage() {
	const { trackRun } = useToolAnalytics('image-edit');
	const [editOps, setEditOps] = useState<EditOps>(DEFAULT_EDIT_OPS);
	const [aspectPreset, setAspectPreset] = useState<AspectPreset>('free');
	const [crop, setCrop] = useState<CropRect | null>(null);
	// 実行中に生成された結果を直接蓄積する（itemsのstate反映を待たずに完了時点でダウンロードするため）
	const resultsRef = useRef<EditResult[]>([]);

	const {
		items,
		processing,
		progress,
		completion,
		error,
		setError,
		hold,
		startHeld,
		clear: clearBatch,
	} = useBatchProcessing<EditItem>({
		fallbackErrorMessage: '処理に失敗しました',
		releaseItem: releaseEditItem,
		onRunComplete: () => {
			trackRun();
			const results = resultsRef.current;
			resultsRef.current = [];
			if (results.length === 1) {
				downloadEditedFile(results[0]);
			} else if (results.length > 1) {
				void downloadEditedZip(results);
			}
		},
	});

	const isBatch = items.length > 1;
	const singleItem = items.length === 1 ? items[0] : null;
	const singleBitmap = singleItem?.bitmap ?? null;

	const initCrop = useCallback((bitmap: ImageBitmap, preset: AspectPreset) => {
		const ratio = aspectPresetToRatio(preset);
		if (ratio !== null) {
			const centered = computeCenterCrop(bitmap.width, bitmap.height, ratio);
			setCrop(centered ?? null);
		} else {
			setCrop({
				x: 0,
				y: 0,
				width: bitmap.width,
				height: bitmap.height,
			});
		}
	}, []);

	const handleFilesSelect = useCallback(
		async (files: File[]) => {
			const batchCheck = validateEditBatch(files);
			if (!batchCheck.ok) {
				setError(batchCheck.message);
				return;
			}

			const valid: File[] = [];
			const errors: string[] = [];
			for (const file of files) {
				const v = validateEditImageFile(file);
				if (v.ok) valid.push(file);
				else errors.push(`${file.name}: ${v.message}`);
			}
			setError(errors.length > 0 ? errors.join('\n') : null);
			if (valid.length === 0) return;

			const next: EditItem[] = [];
			for (const file of valid) {
				let bitmap: ImageBitmap | null = null;
				try {
					bitmap = await loadBitmap(file);
				} catch {
					errors.push(`${file.name}: 画像の読み込みに失敗しました`);
				}
				next.push({
					id: createId(),
					status: 'pending',
					file,
					previewUrl: URL.createObjectURL(file),
					bitmap,
				});
			}
			if (errors.length > 0) {
				setError(errors.join('\n'));
			}
			// ここでは保持のみ行い、処理（applyEdit）は「ダウンロード」ボタン押下まで開始しない
			hold(next);

			if (next.length === 1 && next[0].bitmap) {
				initCrop(next[0].bitmap, aspectPreset);
			} else {
				setCrop(null);
			}
		},
		[aspectPreset, initCrop, hold, setError],
	);

	const handleAspectChange = useCallback(
		(preset: AspectPreset) => {
			setAspectPreset(preset);
			if (singleBitmap) {
				const ratio = aspectPresetToRatio(preset);
				if (ratio !== null) {
					const centered = computeCenterCrop(
						singleBitmap.width,
						singleBitmap.height,
						ratio,
					);
					setCrop(centered ?? null);
				} else {
					setCrop({
						x: 0,
						y: 0,
						width: singleBitmap.width,
						height: singleBitmap.height,
					});
				}
			}
		},
		[singleBitmap],
	);

	const currentEditOps = useMemo<EditOps>(() => {
		if (singleBitmap && crop) {
			const isFullImage =
				crop.x === 0 &&
				crop.y === 0 &&
				crop.width === singleBitmap.width &&
				crop.height === singleBitmap.height;
			return {
				...editOps,
				crop: isFullImage ? undefined : crop,
			};
		}
		return editOps;
	}, [editOps, crop, singleBitmap]);

	const handleProcess = useCallback(() => {
		resultsRef.current = [];
		startHeld(async (item) => {
			if (!item.bitmap) {
				throw new Error('画像の読み込みに失敗しました');
			}

			const ops = { ...editOps };

			if (isBatch) {
				const ratio = aspectPresetToRatio(aspectPreset);
				if (ratio !== null) {
					ops.crop =
						computeCenterCrop(item.bitmap.width, item.bitmap.height, ratio) ??
						undefined;
				}
			} else if (crop) {
				const isFullImage =
					crop.x === 0 &&
					crop.y === 0 &&
					crop.width === item.bitmap.width &&
					crop.height === item.bitmap.height;
				ops.crop = isFullImage ? undefined : crop;
			}

			const result = await applyEdit(item.bitmap, ops, item.file.name);
			resultsRef.current.push(result);
			return {};
		});
	}, [startHeld, editOps, crop, isBatch, aspectPreset]);

	const handleClear = useCallback(() => {
		clearBatch();
		resultsRef.current = [];
		setCrop(null);
		setEditOps(DEFAULT_EDIT_OPS);
		setAspectPreset('free');
	}, [clearBatch]);

	const completionText = completion
		? completion.failed > 0
			? `処理完了: ${completion.total}件中${completion.done}件が完了、${completion.failed}件はエラーでした。`
			: `処理完了: ${completion.done}件の画像を処理しました。`
		: null;

	return (
		<div className="space-y-6">
			<FileDropzone
				multiple
				onFileSelect={() => {}}
				onFilesSelect={handleFilesSelect}
				accept={ACCEPT}
				disabled={processing}
				label="画像をドラッグ＆ドロップ"
				description={`PNG / JPEG / WebP（最大${MAX_FILE_COUNT}枚・1枚50MBまで）`}
				privacyNote="画像はサーバーに送信されません。すべてブラウザ内で処理されます。"
				inputAriaLabel="編集する画像を選択"
				data-testid="image-edit-input"
			/>

			{error && (
				<div
					className="whitespace-pre-line rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
					role="alert"
				>
					{error}
				</div>
			)}

			{items.length > 0 && (
				<div className="grid gap-6 lg:grid-cols-[1fr_280px]">
					{/* 左: 画像 + クロップ */}
					<div className="space-y-4">
						{singleBitmap && (
							<div className="relative overflow-hidden rounded-lg border border-border bg-muted/30">
								<img
									src={singleItem?.previewUrl}
									alt="編集対象"
									className="block max-h-[60vh] w-full object-contain"
									draggable={false}
								/>
								{crop && (
									<CropOverlay
										crop={crop}
										imageWidth={singleBitmap.width}
										imageHeight={singleBitmap.height}
										aspectRatio={aspectPresetToRatio(aspectPreset)}
										onChange={setCrop}
									/>
								)}
							</div>
						)}

						{isBatch && (
							<div className="space-y-2">
								<p className="text-sm text-muted-foreground">
									{items.length}枚の画像を選択中
									{aspectPreset !== 'free' && ' — 中央基準で最大切り抜きを適用'}
								</p>
								<div className="flex flex-wrap gap-2">
									{items.map((item) => (
										<div
											key={item.id}
											className="relative size-16 overflow-hidden rounded border border-border"
										>
											<img
												src={item.previewUrl}
												alt={item.file.name}
												className="size-full object-cover"
											/>
										</div>
									))}
								</div>
							</div>
						)}

						{/* プレビュー */}
						{singleBitmap && (
							<div className="space-y-1.5">
								<p className="text-sm font-medium text-muted-foreground">
									出力プレビュー
								</p>
								<EditPreview source={singleBitmap} editOps={currentEditOps} />
							</div>
						)}
					</div>

					{/* 右: ツールバー */}
					<div className="space-y-4">
						<EditToolbar
							editOps={editOps}
							aspectPreset={aspectPreset}
							isBatch={isBatch}
							onChange={setEditOps}
							onAspectChange={handleAspectChange}
						/>

						<div className="flex flex-col gap-2 pt-2 border-t border-border">
							<Button
								onClick={handleProcess}
								disabled={processing}
								className="w-full"
							>
								{processing ? (
									<>
										<Loader2 className="size-4 animate-spin" />
										<span className="ml-1">
											処理中… {progress.done}/{progress.total}
										</span>
									</>
								) : (
									<>
										<Download className="size-4" />
										<span className="ml-1">
											{isBatch
												? `${items.length}枚をZIPでダウンロード`
												: 'ダウンロード'}
										</span>
									</>
								)}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={handleClear}
								disabled={processing}
							>
								<Trash2 className="size-4" />
								<span className="ml-1">クリア</span>
							</Button>
						</div>

						{processing && (
							<div
								className="h-2 w-full overflow-hidden rounded-full bg-muted"
								role="progressbar"
								aria-valuenow={progress.done}
								aria-valuemin={0}
								aria-valuemax={progress.total}
							>
								<div
									className="h-full rounded-full bg-primary transition-all duration-200"
									style={{
										width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
									}}
								/>
							</div>
						)}

						{completionText && !processing && (
							<div
								className="flex items-start gap-2 rounded-lg border border-safety/30 bg-safety/10 p-3 text-sm"
								role="status"
								aria-live="polite"
								data-testid="edit-completion"
							>
								<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-safety" />
								<p className="font-medium text-foreground">{completionText}</p>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
