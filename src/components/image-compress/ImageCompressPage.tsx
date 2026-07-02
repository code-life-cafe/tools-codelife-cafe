import {
	CheckCircle2,
	Loader2,
	Package,
	RefreshCw,
	Share2,
	Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import { createId, downloadBlob } from '@/lib/tools/image-common';
import {
	type CompressOptions,
	compressImage,
	compressToTargetSize,
	MAX_FILE_COUNT,
	type ResizeMode,
	validateFileCount,
	validateImageFile,
} from '@/lib/tools/image-compress';
import { buildZip, dedupeZipNames } from '@/lib/tools/zip';
import {
	CompressOptionsPanel,
	type CompressUiOptions,
	DEFAULT_UI_OPTIONS,
	type ResizeKind,
} from './CompressOptionsPanel';
import { type CompressItem, CompressResultList } from './CompressResultList';

const ACCEPT = 'image/jpeg,image/png,image/webp';

type CompletionNotice = {
	done: number;
	failed: number;
	total: number;
};

function toResizeMode(kind: ResizeKind, value: number): ResizeMode {
	switch (kind) {
		case 'none':
			return { type: 'none' };
		case 'max-width':
			return { type: 'max-width', value };
		case 'max-height':
			return { type: 'max-height', value };
		case 'long-edge':
			return { type: 'long-edge', value };
		case 'percent':
			return { type: 'percent', value };
	}
}

function toCoreOptions(o: CompressUiOptions): CompressOptions {
	return {
		format: o.format,
		quality: o.quality,
		resize: toResizeMode(o.resizeKind, o.resizeValue),
		background: o.background,
	};
}

export function ImageCompressPage() {
	const { trackRun, trackSharedUrlOpen } = useToolAnalytics('image-compress');

	const [options, updateOptions, generateShareUrl] = useToolSettings(
		'image-compress',
		DEFAULT_UI_OPTIONS,
	);
	const [shareCopied, setShareCopied] = useState(false);

	const [items, setItems] = useState<CompressItem[]>([]);
	const [processing, setProcessing] = useState(false);
	const [progress, setProgress] = useState({ done: 0, total: 0 });
	const [completion, setCompletion] = useState<CompletionNotice | null>(null);
	const [error, setError] = useState<string | null>(null);
	const runIdRef = useRef(0);
	const cancelRef = useRef(false);
	const itemsRef = useRef<CompressItem[]>([]);
	itemsRef.current = items;

	// 共有URLからアクセスされた場合の計測
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.has('settings')) {
			trackSharedUrlOpen();
		}
	}, [trackSharedUrlOpen]);

	// アンマウント時に全 object URL を解放する
	useEffect(() => {
		return () => {
			for (const it of itemsRef.current) {
				URL.revokeObjectURL(it.previewUrl);
				if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
			}
		};
	}, []);

	const updateItem = useCallback((id: string, patch: Partial<CompressItem>) => {
		setItems((prev) =>
			prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
		);
	}, []);

	const processAll = useCallback(
		async (target: CompressItem[], uiOptions: CompressUiOptions) => {
			const runId = ++runIdRef.current;
			cancelRef.current = false;
			setProcessing(true);
			setCompletion(null);
			setProgress({ done: 0, total: target.length });
			const core = toCoreOptions(uiOptions);
			let done = 0;
			let failed = 0;

			for (let i = 0; i < target.length; i++) {
				if (cancelRef.current || runIdRef.current !== runId) break;
				const item = target[i];
				try {
					const result =
						uiOptions.useTargetSize && uiOptions.format !== 'png'
							? await compressToTargetSize(item.file, uiOptions.targetKB, core)
							: await compressImage(item.file, core);
					const resultUrl = URL.createObjectURL(result.blob);
					if (runIdRef.current !== runId) {
						URL.revokeObjectURL(resultUrl);
						break;
					}
					updateItem(item.id, { status: 'done', result, resultUrl });
					done++;
				} catch (err) {
					updateItem(item.id, {
						status: 'error',
						error:
							err instanceof Error ? err.message : '画像の処理に失敗しました。',
					});
					failed++;
				}
				if (runIdRef.current === runId) {
					setProgress({ done: i + 1, total: target.length });
				}
				// イベントループへ yield して UI フリーズを防ぐ
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			if (runIdRef.current === runId) {
				setProcessing(false);
				setCompletion({ done, failed, total: target.length });
				trackRun(); // 圧縮実行の分析計測
			}
		},
		[updateItem, trackRun],
	);

	const handleShare = useCallback(() => {
		const shareUrl = generateShareUrl();
		navigator.clipboard.writeText(shareUrl);
		setShareCopied(true);
		setTimeout(() => setShareCopied(false), 2000);
	}, [generateShareUrl]);

	const handleFilesSelect = useCallback(
		(files: File[]) => {
			const countCheck = validateFileCount(files.length);
			if (!countCheck.ok) {
				setError(countCheck.message);
				return;
			}
			const valid: File[] = [];
			const errors: string[] = [];
			for (const file of files) {
				const v = validateImageFile(file);
				if (v.ok) valid.push(file);
				else errors.push(`${file.name}: ${v.message}`);
			}
			setError(errors.length > 0 ? errors.join('\n') : null);
			setCompletion(null);
			if (valid.length === 0) return;

			// 差し替え: 前回結果と object URL を解放する
			for (const it of itemsRef.current) {
				URL.revokeObjectURL(it.previewUrl);
				if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
			}
			const next: CompressItem[] = valid.map((file) => ({
				id: createId(),
				file,
				previewUrl: URL.createObjectURL(file),
				status: 'pending',
			}));
			setItems(next);
			void processAll(next, options);
		},
		[options, processAll],
	);

	const handleRecompress = useCallback(() => {
		const reset = itemsRef.current.map((it) => {
			if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
			return {
				...it,
				status: 'pending' as const,
				result: undefined,
				resultUrl: undefined,
				error: undefined,
			};
		});
		setItems(reset);
		void processAll(reset, options);
	}, [options, processAll]);

	const handleCancel = useCallback(() => {
		cancelRef.current = true;
		runIdRef.current++;
		setProcessing(false);
		setCompletion(null);
	}, []);

	const handleClear = useCallback(() => {
		runIdRef.current++;
		cancelRef.current = true;
		for (const it of itemsRef.current) {
			URL.revokeObjectURL(it.previewUrl);
			if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
		}
		setItems([]);
		setError(null);
		setProcessing(false);
		setCompletion(null);
	}, []);

	const handleDownload = useCallback((item: CompressItem) => {
		if (item.result) downloadBlob(item.result.blob, item.result.fileName);
	}, []);

	const handleDownloadOriginal = useCallback((item: CompressItem) => {
		downloadBlob(item.file, item.file.name);
	}, []);

	const handleDownloadZip = useCallback(async () => {
		const done = itemsRef.current.filter(
			(
				it,
			): it is CompressItem & { result: NonNullable<CompressItem['result']> } =>
				it.status === 'done' && it.result != null,
		);
		if (done.length === 0) return;
		const names = dedupeZipNames(done.map((it) => it.result.fileName));
		const zip = await buildZip(
			done.map((it, i) => ({ name: names[i], data: it.result.blob })),
		);
		downloadBlob(zip, 'images_compressed.zip');
	}, []);

	const doneCount = items.filter((it) => it.status === 'done').length;

	const completionText = completion
		? completion.failed > 0
			? `変換完了: ${completion.total}件中${completion.done}件が完了、${completion.failed}件はエラーでした。`
			: `変換完了: ${completion.done}件の画像を処理しました。結果を確認してダウンロードできます。`
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
				description={`JPEG / PNG / WebP（最大${MAX_FILE_COUNT}枚・1枚50MBまで）`}
				privacyNote="画像はサーバーに送信されません。すべてブラウザ内で処理され、再エンコードによりEXIF・位置情報などのメタデータも除去されます。"
				inputAriaLabel="圧縮する画像を選択"
				data-testid="image-compress-input"
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
				<>
					<CompressOptionsPanel
						options={options}
						disabled={processing}
						onChange={updateOptions}
					/>

					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={handleRecompress} disabled={processing}>
							<RefreshCw className="h-4 w-4" />
							<span className="ml-1">この設定で再圧縮</span>
						</Button>
						<Button
							variant="outline"
							onClick={handleShare}
							disabled={processing}
						>
							<Share2 className="h-4 w-4" />
							<span className="ml-1">
								{shareCopied ? 'コピー完了！' : '設定を共有'}
							</span>
						</Button>
						{doneCount >= 2 && (
							<Button
								variant="outline"
								onClick={handleDownloadZip}
								disabled={processing}
							>
								<Package className="h-4 w-4" />
								<span className="ml-1">ZIPでまとめてダウンロード</span>
							</Button>
						)}
						<Button variant="ghost" onClick={handleClear} disabled={processing}>
							<Trash2 className="h-4 w-4" />
							<span className="ml-1">クリア</span>
						</Button>
					</div>

					{processing && (
						<div className="space-y-2" aria-live="polite">
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="h-4 w-4 animate-spin text-primary" />
								<span>
									圧縮中… {progress.done} / {progress.total}
								</span>
								<Button
									variant="ghost"
									size="sm"
									className="ml-auto"
									onClick={handleCancel}
								>
									キャンセル
								</Button>
							</div>
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
						</div>
					)}

					{completionText && !processing && (
						<div
							className="flex items-start gap-2 rounded-lg border border-safety/30 bg-safety/10 p-3 text-sm text-safety"
							role="status"
							aria-live="polite"
							data-testid="compress-completion"
						>
							<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
							<div>
								<p className="font-medium text-foreground">{completionText}</p>
								<p className="mt-1 text-xs text-muted-foreground">
									処理はブラウザ内で完了しています。必要な画像をダウンロードしてください。
								</p>
							</div>
						</div>
					)}

					<CompressResultList
						items={items}
						onDownload={handleDownload}
						onDownloadOriginal={handleDownloadOriginal}
					/>
				</>
			)}
		</div>
	);
}
