// ImageConvertPage — 画像形式変換ツールのオーケストレーター
// 逐次処理 + 進捗表示。すべてブラウザ内で処理し、画像はサーバーに送信されない。

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
	convertOne,
	MAX_BATCH_FILES,
	type TargetFormat,
	validateBatch,
	validateImageFile,
} from '@/lib/tools/image-convert';
import { buildZip, dedupeZipNames } from '@/lib/tools/zip';
import {
	ConvertOptionsPanel,
	type ConvertUiOptions,
	DEFAULT_UI_OPTIONS,
} from './ConvertOptionsPanel';
import { type ConvertItem, ConvertResultList } from './ConvertResultList';

// HEIC は type が空のことがあるため拡張子も許可する
const ACCEPT =
	'image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif,.heic,.heif';

type CompletionNotice = {
	done: number;
	failed: number;
	total: number;
};

export function ImageConvertPage() {
	const { trackRun, trackSharedUrlOpen } = useToolAnalytics('image-convert');
	const [items, setItems] = useState<ConvertItem[]>([]);
	const [options, updateOptions, generateShareUrl] = useToolSettings(
		'image-convert',
		DEFAULT_UI_OPTIONS,
	);
	const [shareCopied, setShareCopied] = useState(false);
	const [processedTarget, setProcessedTarget] = useState<TargetFormat>(
		DEFAULT_UI_OPTIONS.target,
	);
	const [processing, setProcessing] = useState(false);
	const [progress, setProgress] = useState({ done: 0, total: 0 });
	const [completion, setCompletion] = useState<CompletionNotice | null>(null);
	const [error, setError] = useState<string | null>(null);
	const runIdRef = useRef(0);
	const cancelRef = useRef(false);
	const itemsRef = useRef<ConvertItem[]>([]);
	itemsRef.current = items;

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

	const updateItem = useCallback((id: string, patch: Partial<ConvertItem>) => {
		setItems((prev) =>
			prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
		);
	}, []);

	const processAll = useCallback(
		async (target: ConvertItem[], uiOptions: ConvertUiOptions) => {
			const runId = ++runIdRef.current;
			cancelRef.current = false;
			setProcessing(true);
			setProcessedTarget(uiOptions.target);
			setCompletion(null);
			setProgress({ done: 0, total: target.length });
			let done = 0;
			let failed = 0;

			for (let i = 0; i < target.length; i++) {
				if (cancelRef.current || runIdRef.current !== runId) break;
				const item = target[i];
				try {
					const result = await convertOne(item.file, uiOptions);
					const resultUrl = URL.createObjectURL(result.blob);
					if (runIdRef.current !== runId) {
						URL.revokeObjectURL(resultUrl);
						break;
					}
					updateItem(item.id, {
						status: 'done',
						result: {
							fileName: result.fileName,
							blob: result.blob,
							warnings: result.warnings,
						},
						resultUrl,
					});
					done++;
				} catch (err) {
					updateItem(item.id, {
						status: 'error',
						error:
							err instanceof Error ? err.message : '画像の変換に失敗しました。',
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
				trackRun();
			}
		},
		[updateItem, trackRun],
	);

	const handleFilesSelect = useCallback(
		async (files: File[]) => {
			const batch = validateBatch(files);
			if (!batch.ok) {
				setError(batch.message);
				return;
			}
			const checks = await Promise.all(
				files.map(async (file) => ({ file, v: await validateImageFile(file) })),
			);
			const valid: { file: File; format: ConvertItem['sourceFormat'] }[] = [];
			const errors: string[] = [];
			for (const { file, v } of checks) {
				if (v.ok) valid.push({ file, format: v.format });
				else errors.push(v.message);
			}
			setError(errors.length > 0 ? errors.join('\n') : null);
			setCompletion(null);
			if (valid.length === 0) return;

			// 差し替え: 前回結果と object URL を解放する
			for (const it of itemsRef.current) {
				URL.revokeObjectURL(it.previewUrl);
				if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
			}
			const next: ConvertItem[] = valid.map(({ file, format }) => ({
				id: createId(),
				file,
				previewUrl: URL.createObjectURL(file),
				sourceFormat: format,
				status: 'pending',
			}));
			setItems(next);
			void processAll(next, options);
		},
		[options, processAll],
	);

	// オプション変更時は古い完了メッセージを消す（再変換するまで結果は前回のまま）
	const handleOptionsChange = useCallback(
		(next: ConvertUiOptions) => {
			updateOptions(next);
			setCompletion(null);
		},
		[updateOptions],
	);

	const handleShare = useCallback(() => {
		const shareUrl = generateShareUrl();
		navigator.clipboard.writeText(shareUrl);
		setShareCopied(true);
		setTimeout(() => setShareCopied(false), 2000);
	}, [generateShareUrl]);

	const handleReconvert = useCallback(() => {
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

	const handleDownload = useCallback((item: ConvertItem) => {
		if (item.result) downloadBlob(item.result.blob, item.result.fileName);
	}, []);

	const handleDownloadZip = useCallback(async () => {
		const done = itemsRef.current.filter(
			(
				it,
			): it is ConvertItem & { result: NonNullable<ConvertItem['result']> } =>
				it.status === 'done' && it.result != null,
		);
		if (done.length === 0) return;
		const names = dedupeZipNames(done.map((it) => it.result.fileName));
		const zip = await buildZip(
			done.map((it, i) => ({ name: names[i], data: it.result.blob })),
		);
		downloadBlob(zip, 'converted.zip');
	}, []);

	const doneCount = items.filter((it) => it.status === 'done').length;

	const completionText = completion
		? completion.failed > 0
			? `変換完了: ${completion.total}件中${completion.done}件が完了、${completion.failed}件はエラーでした。`
			: `変換完了: ${completion.done}件の画像を変換しました。結果を確認してダウンロードできます。`
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
				description={`HEIC / WebP / AVIF / PNG / JPEG（最大${MAX_BATCH_FILES}ファイル・1ファイル50MBまで）`}
				privacyNote="画像はサーバーに送信されません。すべてブラウザ内で処理されます。"
				inputAriaLabel="変換する画像を選択"
				data-testid="image-convert-input"
			/>

			<p className="text-xs text-muted-foreground">
				リサイズ・圧縮率の最適化は{' '}
				<a href="/image-compress" className="text-primary hover:underline">
					画像圧縮・リサイズ
				</a>{' '}
				をご利用ください。HEICは入力のみ対応（HEIC出力は不可）。
			</p>

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
					<ConvertOptionsPanel
						options={options}
						disabled={processing}
						onChange={handleOptionsChange}
					/>

					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={handleReconvert} disabled={processing}>
							<RefreshCw className="h-4 w-4" />
							<span className="ml-1">この設定で再変換</span>
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
									変換中… {progress.done} / {progress.total}
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
							data-testid="convert-completion"
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

					<ConvertResultList
						items={items}
						target={processedTarget}
						onDownload={handleDownload}
					/>
				</>
			)}
		</div>
	);
}
