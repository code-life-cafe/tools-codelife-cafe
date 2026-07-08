// PdfMergePage — PDF結合ツールのオーケストレーター
// 複数のPDF・画像（JPEG / PNG）を1つのPDFへ結合する。
// すべてブラウザ内で処理し、ファイルはサーバーに送信されない。

import { Download, FileStack, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { useSingleResultProcessing } from '@/lib/hooks/useSingleResultProcessing.ts';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { createId, downloadBlob } from '@/lib/tools/image-common';
import {
	ENCRYPTED_PDF_MESSAGE,
	loadPdfInfo,
	MAX_MERGE_FILES,
	type MergeInput,
	mergePdfs,
	validateMergeFileCount,
	validatePdfFile,
	validateTotalInputSize,
} from '@/lib/tools/pdf';
import { formatBytes, MergeFileList, type MergeItem } from './MergeFileList';

// MIMEが空/octet-streamのPDF（OS・ブラウザ依存）も選択できるよう拡張子も併記する
const ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';

type MergeResult = {
	blob: Blob;
	pageCount: number;
};

export function PdfMergePage() {
	const { trackRun } = useToolAnalytics('pdf-merge');
	const [items, setItems] = useState<MergeItem[]>([]);
	const { processing, progress, result, clearResult, error, setError, run } =
		useSingleResultProcessing<MergeResult>({
			fallbackErrorMessage: '結合に失敗しました。',
		});
	const itemsRef = useRef<MergeItem[]>([]);
	itemsRef.current = items;

	// 暗号化PDF等で結合対象から除外されていない有効なファイル
	const readyItems = items.filter((it) => it.status === 'ready');
	const loadingCount = items.filter((it) => it.status === 'loading').length;
	// 画像は1ファイル単体でもPDF化できる。PDFのみ1ファイルは結合不要なので無効
	const canMerge =
		!processing &&
		loadingCount === 0 &&
		(readyItems.length >= 2 ||
			(readyItems.length === 1 && readyItems[0].kind === 'image'));
	const disabledReason = processing
		? '処理中です'
		: loadingCount > 0
			? 'ファイルを読み込み中です'
			: readyItems.length === 0
				? '結合できるファイルがありません'
				: readyItems.length === 1 && readyItems[0].kind === 'pdf'
					? '2つ以上のファイルを追加してください（画像は1ファイルでもPDF化できます）'
					: null;

	const totalPages = readyItems.reduce(
		(sum, it) => sum + (it.pageCount ?? (it.kind === 'image' ? 1 : 0)),
		0,
	);

	useEffect(() => {
		// アンマウント時は何も保持しない（object URL は使用していない）
		return () => {
			itemsRef.current = [];
		};
	}, []);

	const updateItem = useCallback((id: string, patch: Partial<MergeItem>) => {
		setItems((prev) =>
			prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
		);
	}, []);

	const handleFilesSelect = useCallback(
		async (files: File[]) => {
			setError(null);
			clearResult();

			const current = itemsRef.current;
			const countCheck = validateMergeFileCount(current.length + files.length);
			if (!countCheck.ok) {
				setError(countCheck.message);
				return;
			}
			const currentTotal = current.reduce((sum, it) => sum + it.file.size, 0);
			const newTotal = currentTotal + files.reduce((sum, f) => sum + f.size, 0);
			const sizeCheck = validateTotalInputSize(newTotal);
			if (!sizeCheck.ok) {
				setError(sizeCheck.message);
				return;
			}

			const globalErrors: string[] = [];
			const accepted: MergeItem[] = [];
			for (const file of files) {
				const v = await validatePdfFile(file);
				if (!v.ok) {
					globalErrors.push(`${file.name}: ${v.message}`);
					continue;
				}
				accepted.push({
					id: createId(),
					file,
					kind: v.kind,
					mime: v.mime,
					status: v.kind === 'pdf' ? 'loading' : 'ready',
				});
			}
			if (globalErrors.length > 0) setError(globalErrors.join('\n'));
			if (accepted.length === 0) return;
			setItems((prev) => [...prev, ...accepted]);

			// PDFはページ数と暗号化有無を読み取る（bytes は読み取り後すぐ解放される）
			for (const item of accepted) {
				if (item.kind !== 'pdf') continue;
				try {
					const bytes = new Uint8Array(await item.file.arrayBuffer());
					const info = await loadPdfInfo(bytes);
					if (info.encrypted) {
						updateItem(item.id, {
							status: 'error',
							error: ENCRYPTED_PDF_MESSAGE,
						});
					} else {
						updateItem(item.id, { status: 'ready', pageCount: info.pageCount });
					}
				} catch {
					updateItem(item.id, {
						status: 'error',
						error:
							'PDFを読み込めませんでした。ファイルが破損している可能性があります。',
					});
				}
			}
		},
		[updateItem, setError, clearResult],
	);

	const handleMove = useCallback((id: string, direction: -1 | 1) => {
		setItems((prev) => {
			const index = prev.findIndex((it) => it.id === id);
			const target = index + direction;
			if (index < 0 || target < 0 || target >= prev.length) return prev;
			const next = [...prev];
			[next[index], next[target]] = [next[target], next[index]];
			return next;
		});
	}, []);

	const handleReorder = useCallback((fromIndex: number, toIndex: number) => {
		setItems((prev) => {
			const next = [...prev];
			const [moved] = next.splice(fromIndex, 1);
			next.splice(toIndex, 0, moved);
			return next;
		});
	}, []);

	const handleRemove = useCallback(
		(id: string) => {
			setItems((prev) => prev.filter((it) => it.id !== id));
			clearResult();
		},
		[clearResult],
	);

	const handleClear = useCallback(() => {
		setItems([]);
		setError(null);
		clearResult();
	}, [setError, clearResult]);

	const handleMerge = useCallback(async () => {
		const targets = itemsRef.current.filter((it) => it.status === 'ready');
		if (targets.length === 0) return;

		await run(targets.length, async (onProgress) => {
			try {
				// bytes はこのスコープ内のみで保持し、結合完了後に参照を解放する
				const inputs: MergeInput[] = [];
				for (const item of targets) {
					const bytes = new Uint8Array(await item.file.arrayBuffer());
					inputs.push(
						item.kind === 'pdf'
							? { kind: 'pdf', name: item.file.name, bytes }
							: {
									kind: 'image',
									name: item.file.name,
									bytes,
									mime: item.mime as 'image/jpeg' | 'image/png',
								},
					);
				}
				const merged = await mergePdfs(inputs, onProgress);
				inputs.length = 0;
				// 結合実行の分析計測
				trackRun();
				const blob = new Blob([merged as Uint8Array<ArrayBuffer>], {
					type: 'application/pdf',
				});
				const pageCount = targets.reduce(
					(sum, it) => sum + (it.pageCount ?? 1),
					0,
				);
				downloadBlob(blob, 'merged.pdf');
				return { blob, pageCount };
			} catch (err) {
				throw err instanceof Error
					? new Error(`結合に失敗しました: ${err.message}`)
					: err;
			}
		});
	}, [run, trackRun]);

	return (
		<div className="space-y-6">
			<FileDropzone
				multiple
				onFileSelect={() => {}}
				onFilesSelect={(files) => void handleFilesSelect(files)}
				accept={ACCEPT}
				disabled={processing}
				label="PDF・画像をドラッグ＆ドロップ"
				description={`PDF / JPEG / PNG（最大${MAX_MERGE_FILES}ファイル・1ファイル100MBまで）`}
				privacyNote="PDFや画像はサーバーに送信されません。すべてブラウザ内で処理されます。"
				inputAriaLabel="結合するPDF・画像を選択"
				data-testid="pdf-merge-input"
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
					<MergeFileList
						items={items}
						disabled={processing}
						onMove={handleMove}
						onReorder={handleReorder}
						onRemove={handleRemove}
					/>

					<div className="flex flex-wrap items-center gap-2">
						<span title={disabledReason ?? undefined}>
							<Button onClick={() => void handleMerge()} disabled={!canMerge}>
								<FileStack className="h-4 w-4" />
								<span className="ml-1">結合してダウンロード</span>
							</Button>
						</span>
						<Button variant="ghost" onClick={handleClear} disabled={processing}>
							<Trash2 className="h-4 w-4" />
							<span className="ml-1">クリア</span>
						</Button>
						{readyItems.length > 0 && !processing && (
							<span className="text-sm text-muted-foreground">
								{readyItems.length}ファイル・合計{totalPages}ページ
							</span>
						)}
					</div>

					{processing && (
						<div
							className="flex items-center gap-2 text-sm text-muted-foreground"
							aria-live="polite"
						>
							<Loader2 className="h-4 w-4 animate-spin text-primary" />
							<span>
								結合中… {progress.done} / {progress.total} ファイル
							</span>
						</div>
					)}

					{result && (
						<div
							className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3"
							data-testid="merge-result"
						>
							<div className="min-w-0 flex-1 text-sm">
								<p className="font-medium">merged.pdf</p>
								<p className="text-muted-foreground">
									{result.pageCount}ページ・{formatBytes(result.blob.size)}
								</p>
							</div>
							<Button
								variant="outline"
								onClick={() => downloadBlob(result.blob, 'merged.pdf')}
							>
								<Download className="h-4 w-4" />
								<span className="ml-1">ダウンロード</span>
							</Button>
						</div>
					)}
				</>
			)}

			<p className="text-xs text-muted-foreground">
				このツールはファイル単位の結合に特化しています。ページ単位のプレビュー、回転、OCR、パスワード解除には対応していません。
			</p>
		</div>
	);
}
