// PdfToImage — PDFの各ページをJPG/PNG画像に変換するツールのUI
// ページ全体を描画して1ページ1枚の画像にする（PDF内の埋め込み画像の抽出ではない）。
// PDFはサーバーへ送信せず、ブラウザ内で1ページずつ処理する。

import {
	AlertTriangle,
	CheckCircle2,
	Download,
	Eye,
	ImageDown,
	Loader2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSingleResultProcessing } from '@/lib/hooks/useSingleResultProcessing';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import {
	CORRUPT_PDF_MESSAGE,
	DPI_OPTIONS,
	encryptedError,
	isDpi,
	isJpegQuality,
	JPEG_QUALITY_OPTIONS,
	PdfToolError,
	pdfBaseName,
	validatePageCount,
	validatePdfInput,
} from '@/lib/pdf/common';
import { openPdfRenderSession, type PdfRenderSession } from '@/lib/pdf/render';
import { downloadBlob } from '@/lib/tools/image-common';
import {
	allPagesInput,
	type ConvertResult,
	convertPdfPages,
	DEFAULT_PDF_TO_IMAGE_SETTINGS,
	type ImageFormat,
	MAX_RESULT_BYTES,
	type PageImage,
	resolvePageSelection,
	sanitizePdfToImageSettings,
} from '@/lib/tools/pdf-to-image';
import { formatBytes } from '../pdf-merge/MergeFileList';

type LoadedPdf = {
	file: File;
	pageCount: number;
	session: PdfRenderSession;
};

function messageOf(error: unknown): string {
	return error instanceof PdfToolError ? error.message : CORRUPT_PDF_MESSAGE;
}

function releaseLoaded(loaded: LoadedPdf | null): void {
	if (loaded) void loaded.session.destroy().catch(() => undefined);
}

export default function PdfToImage() {
	const { trackRun } = useToolAnalytics('pdf-to-image');
	const [settings, updateSettings] = useToolSettings(
		'pdf-to-image',
		DEFAULT_PDF_TO_IMAGE_SETTINGS,
		sanitizePdfToImageSettings,
	);
	const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
	const [loading, setLoading] = useState(false);
	const [rangeInput, setRangeInput] = useState('');
	const [notice, setNotice] = useState<string | null>(null);
	const [preview, setPreview] = useState<{
		pageNumber: number;
		url: string;
	} | null>(null);

	const loadIdRef = useRef(0);
	const loadedRef = useRef<LoadedPdf | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const {
		processing,
		progress,
		result,
		clearResult,
		error,
		setError,
		run,
		cancel,
	} = useSingleResultProcessing<ConvertResult>({
		fallbackErrorMessage: '画像への変換に失敗しました。',
		onRunComplete: () => trackRun(),
	});

	// プレビュー用のObjectURLは常に1つだけ持ち、差し替え時・アンマウント時に解放する
	useEffect(() => {
		return () => {
			if (preview) URL.revokeObjectURL(preview.url);
		};
	}, [preview]);

	const showPreview = useCallback((image: PageImage | null) => {
		setPreview(
			image
				? { pageNumber: image.pageNumber, url: URL.createObjectURL(image.blob) }
				: null,
		);
	}, []);

	const replaceLoaded = useCallback((next: LoadedPdf | null) => {
		releaseLoaded(loadedRef.current);
		loadedRef.current = next;
		setLoaded(next);
	}, []);

	const stopRun = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
	}, []);

	useEffect(() => {
		return () => {
			loadIdRef.current++;
			abortRef.current?.abort();
			releaseLoaded(loadedRef.current);
			loadedRef.current = null;
		};
	}, []);

	const clearOutputs = useCallback(() => {
		clearResult();
		showPreview(null);
	}, [clearResult, showPreview]);

	const resetForNewInput = useCallback(() => {
		setLoading(false);
		stopRun();
		cancel();
		clearOutputs();
		setError(null);
		setNotice(null);
		setRangeInput('');
		replaceLoaded(null);
	}, [stopRun, cancel, clearOutputs, setError, replaceLoaded]);

	const handleFileSelect = useCallback(
		async (file: File) => {
			const loadId = ++loadIdRef.current;
			const isStale = () => loadId !== loadIdRef.current;
			resetForNewInput();

			const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
			if (isStale()) return;
			const inputError = validatePdfInput({
				name: file.name,
				type: file.type,
				size: file.size,
				head,
			});
			if (inputError) {
				setError(`${file.name}: ${inputError.message}`);
				return;
			}

			setLoading(true);
			let session: PdfRenderSession | null = null;
			try {
				const bytes = new Uint8Array(await file.arrayBuffer());
				session = await openPdfRenderSession(bytes);
				if (isStale()) return;
				// 閲覧パスワードなしで開ける暗号化PDF（権限パスワードのみ）も対象外とする
				if (session.flags.encrypted) throw encryptedError();
				const pageCountError = validatePageCount(session.pageCount);
				if (pageCountError) throw pageCountError;
				replaceLoaded({ file, pageCount: session.pageCount, session });
				setRangeInput(allPagesInput(session.pageCount));
				session = null;
			} catch (err) {
				if (!isStale()) setError(`${file.name}: ${messageOf(err)}`);
			} finally {
				if (session) void session.destroy().catch(() => undefined);
				if (!isStale()) setLoading(false);
			}
		},
		[resetForNewInput, replaceLoaded, setError],
	);

	const handleClear = useCallback(() => {
		loadIdRef.current++;
		setLoading(false);
		resetForNewInput();
	}, [resetForNewInput]);

	const selection = useMemo(
		() =>
			loaded && rangeInput.trim() !== ''
				? resolvePageSelection(rangeInput, loaded.pageCount)
				: null,
		[loaded, rangeInput],
	);

	const canRun =
		loaded !== null && !processing && !loading && selection?.ok === true;

	const handleRun = useCallback(async () => {
		if (!loaded || !selection?.ok) return;
		stopRun();
		const controller = new AbortController();
		abortRef.current = controller;
		setNotice(null);
		showPreview(null);
		const target = loaded;
		const pages = selection.pages;
		const runSettings = settings;
		await run(pages.length, async (onProgress) => {
			const converted = await convertPdfPages(
				target.session,
				pages,
				runSettings,
				pdfBaseName(target.file.name),
				{ signal: controller.signal, onProgress },
			);
			if (converted.images.length === 0) {
				throw new PdfToolError(
					'invalid-option',
					'画像が大きすぎるため変換できませんでした。解像度を下げてください。',
				);
			}
			return converted;
		});
		if (abortRef.current === controller) abortRef.current = null;
	}, [loaded, selection, settings, run, stopRun, showPreview]);

	// 変換完了時は最初の画像をプレビューする
	useEffect(() => {
		if (result && !processing) showPreview(result.images[0] ?? null);
	}, [result, processing, showPreview]);

	const handleCancel = useCallback(() => {
		stopRun();
		cancel();
		setNotice('変換をキャンセルしました。');
	}, [stopRun, cancel]);

	const changeSettings = useCallback(
		(patch: Partial<typeof settings>) => {
			updateSettings(patch);
			setNotice(null);
			clearOutputs();
		},
		[updateSettings, clearOutputs],
	);

	const percent =
		progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
	const showRangeErrors = selection !== null && !selection.ok;

	return (
		<div className="space-y-6">
			<FileDropzone
				onFileSelect={(f) => void handleFileSelect(f)}
				onValidationError={() =>
					setError(
						'対応していない形式です。PDFファイル（.pdf）を選択してください。',
					)
				}
				accept="application/pdf,.pdf"
				disabled={processing}
				label="PDFをドラッグ＆ドロップ"
				description="PDFファイル（1ファイル50MB・100ページまで）"
				privacyNote="PDFはサーバーに送信されません。すべてブラウザ内で処理されます。"
				inputAriaLabel="画像に変換するPDFを選択"
				selectedFileName={loaded?.file.name ?? null}
				onClear={loaded ? handleClear : undefined}
				data-testid="pdf-to-image-input"
			/>

			{error && (
				<div
					className="whitespace-pre-line rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
					role="alert"
				>
					{error}
				</div>
			)}

			{loading && (
				<div
					className="flex items-center gap-2 text-sm text-muted-foreground"
					role="status"
					aria-live="polite"
				>
					<Loader2 className="h-4 w-4 animate-spin text-primary" />
					<span>PDFを読み込み中…</span>
				</div>
			)}

			{loaded && (
				<>
					<p className="text-sm" data-testid="pdf-to-image-info">
						<span className="font-medium">{loaded.file.name}</span>
						<span className="ml-2 text-muted-foreground">
							全{loaded.pageCount}ページ・{formatBytes(loaded.file.size)}
						</span>
					</p>

					<div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
						<div className="space-y-2">
							<label
								className="text-sm font-medium"
								htmlFor="pdf-to-image-range"
							>
								変換するページ
							</label>
							<Input
								id="pdf-to-image-range"
								value={rangeInput}
								onChange={(e) => {
									setRangeInput(e.target.value);
									setNotice(null);
									clearOutputs();
								}}
								placeholder={`例: 1-3,5（全${loaded.pageCount}ページ）`}
								disabled={processing}
								aria-invalid={showRangeErrors}
								aria-describedby="pdf-to-image-range-help"
							/>
							<p
								className="text-xs text-muted-foreground"
								id="pdf-to-image-range-help"
							>
								「1-3,5,8-」のようにカンマ区切りで指定します。重複は1回にまとめ、ページ順に出力します。
							</p>
							{rangeInput.trim() === '' && (
								<p className="text-xs text-destructive">
									変換するページを入力してください。
								</p>
							)}
							{showRangeErrors && selection && !selection.ok && (
								<ul
									className="space-y-1 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
									role="alert"
									data-testid="pdf-to-image-range-errors"
								>
									{selection.errors.map((e) => (
										<li key={`${e.index}-${e.token}`}>
											{e.index + 1}文字目: {e.message}
										</li>
									))}
								</ul>
							)}
						</div>

						<div className="space-y-2">
							<p className="text-sm font-medium" id="pdf-to-image-format-label">
								出力形式
							</p>
							<ToggleGroup
								type="single"
								variant="outline"
								value={settings.format}
								onValueChange={(v) => {
									if (v === 'jpeg' || v === 'png') {
										changeSettings({ format: v as ImageFormat });
									}
								}}
								aria-labelledby="pdf-to-image-format-label"
								disabled={processing}
							>
								<ToggleGroupItem value="jpeg" aria-label="JPG">
									JPG
								</ToggleGroupItem>
								<ToggleGroupItem value="png" aria-label="PNG">
									PNG
								</ToggleGroupItem>
							</ToggleGroup>
							<p className="text-xs text-muted-foreground">
								JPGは背景を白で塗って出力します。PNGはページに背景色がない部分を透明（透過）のまま出力します。白背景のPNGが必要な場合はJPGをお使いください。
							</p>
						</div>

						<div className="space-y-2">
							<p className="text-sm font-medium" id="pdf-to-image-dpi-label">
								解像度
							</p>
							<ToggleGroup
								type="single"
								variant="outline"
								value={String(settings.dpi)}
								onValueChange={(v) => {
									const dpi = Number(v);
									if (isDpi(dpi)) changeSettings({ dpi });
								}}
								aria-labelledby="pdf-to-image-dpi-label"
								disabled={processing}
							>
								{DPI_OPTIONS.map((dpi) => (
									<ToggleGroupItem
										key={dpi}
										value={String(dpi)}
										aria-label={`${dpi}dpi`}
									>
										{dpi}dpi
									</ToggleGroupItem>
								))}
							</ToggleGroup>
							<p className="text-xs text-muted-foreground">
								A4縦は72dpiで595×842px、144dpiで1190×1684pxです。1ページ16メガピクセルを超える場合は解像度を下げてください。
							</p>
						</div>

						{settings.format === 'jpeg' && (
							<div className="space-y-2">
								<p
									className="text-sm font-medium"
									id="pdf-to-image-quality-label"
								>
									JPEG品質
								</p>
								<ToggleGroup
									type="single"
									variant="outline"
									value={String(settings.jpegQuality)}
									onValueChange={(v) => {
										const jpegQuality = Number(v);
										if (isJpegQuality(jpegQuality))
											changeSettings({ jpegQuality });
									}}
									aria-labelledby="pdf-to-image-quality-label"
									disabled={processing}
								>
									{JPEG_QUALITY_OPTIONS.map((q) => (
										<ToggleGroupItem
											key={q}
											value={String(q)}
											aria-label={`品質${q}%`}
										>
											{q}%
										</ToggleGroupItem>
									))}
								</ToggleGroup>
							</div>
						)}

						<p className="text-xs text-muted-foreground">
							ページの回転を反映した見たままの向き・縦横で出力します。PDF内に埋め込まれた画像を元の画質で取り出す機能ではなく、ページ全体を1枚の画像にします。
						</p>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={() => void handleRun()} disabled={!canRun}>
							<ImageDown className="h-4 w-4" />
							<span className="ml-1">画像に変換</span>
						</Button>
					</div>

					{processing && (
						<div className="space-y-2">
							<div
								className="flex items-center gap-2 text-sm text-muted-foreground"
								role="status"
								aria-live="polite"
							>
								<Loader2 className="h-4 w-4 animate-spin text-primary" />
								<span>
									変換中… {progress.done} / {progress.total}ページ
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
								aria-label="変換の進捗"
								aria-valuenow={percent}
								aria-valuemin={0}
								aria-valuemax={100}
							>
								<div
									className="h-full rounded-full bg-primary transition-all duration-200"
									style={{ width: `${percent}%` }}
								/>
							</div>
						</div>
					)}

					{notice && !processing && (
						<p className="text-sm text-muted-foreground" role="status">
							{notice}
						</p>
					)}

					{result && !processing && (
						<div className="space-y-4" data-testid="pdf-to-image-results">
							<div
								className="flex items-start gap-2 rounded-lg border border-safety/30 bg-safety/10 p-3 text-sm"
								role="status"
								aria-live="polite"
							>
								<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-safety" />
								<p className="text-foreground">
									{result.images.length}
									枚の画像を作成しました。複数ページの場合は1枚ずつ保存してください。
								</p>
							</div>
							{result.stoppedBeforePage !== null && (
								<div
									className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
									role="alert"
								>
									<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
									<p>
										一度に保持できる画像の合計（{formatBytes(MAX_RESULT_BYTES)}
										）に達したため、{result.stoppedBeforePage}
										ページ目以降は変換していません。ページ範囲を分けるか、解像度を下げて変換してください。
									</p>
								</div>
							)}

							<ul className="space-y-2">
								{result.images.map((image) => (
									<li
										key={image.fileName}
										className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 sm:p-3"
									>
										<div className="min-w-0 flex-1 text-sm">
											<p
												className="truncate font-medium"
												title={image.fileName}
											>
												{image.fileName}
											</p>
											<p className="text-xs text-muted-foreground">
												{image.pageNumber}ページ目・{image.width}×{image.height}
												px・{formatBytes(image.blob.size)}
											</p>
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => showPreview(image)}
											aria-label={`${image.fileName} をプレビュー`}
											aria-pressed={preview?.pageNumber === image.pageNumber}
										>
											<Eye className="h-4 w-4" />
											<span className="ml-1">プレビュー</span>
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => downloadBlob(image.blob, image.fileName)}
											aria-label={`${image.fileName} をダウンロード`}
										>
											<Download className="h-4 w-4" />
											<span className="ml-1">ダウンロード</span>
										</Button>
									</li>
								))}
							</ul>

							{preview && (
								<figure className="space-y-1">
									<img
										src={preview.url}
										alt={`${preview.pageNumber}ページ目の変換結果`}
										className="max-h-[480px] w-auto max-w-full rounded border border-border bg-[repeating-conic-gradient(#e5e7eb_0%_25%,#ffffff_0%_50%)] bg-[length:16px_16px]"
										data-testid="pdf-to-image-preview"
									/>
									<figcaption className="text-xs text-muted-foreground">
										{preview.pageNumber}
										ページ目のプレビュー（PNGの透明部分は市松模様で表示）
									</figcaption>
								</figure>
							)}
						</div>
					)}
				</>
			)}

			<p className="text-xs text-muted-foreground">
				パスワード付きPDFには対応していません。ZIPでの一括保存には対応していません。
			</p>
		</div>
	);
}
