// PdfCompress — PDF圧縮ツールのUI
// 標準は文字を保持したままの構造最適化。スキャン向けの画像化圧縮は、データ損失への同意を
// 得た場合だけ実行する。PDFはサーバーへ送信せず、ブラウザ内で処理する。

import {
	AlertTriangle,
	CheckCircle2,
	Download,
	FileDown,
	Info,
	Loader2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSingleResultProcessing } from '@/lib/hooks/useSingleResultProcessing';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import {
	CORRUPT_PDF_MESSAGE,
	DPI_OPTIONS,
	isDpi,
	isJpegQuality,
	JPEG_QUALITY_OPTIONS,
	PdfToolError,
	pdfBaseName,
	reductionPercent,
	validatePdfInput,
} from '@/lib/pdf/common';
import {
	openPdfRenderSession,
	type PdfRenderSession,
	renderPreviewBlob,
} from '@/lib/pdf/render';
import { downloadBlob } from '@/lib/tools/image-common';
import {
	assertCompressibleFlags,
	type CompressMode,
	type CompressOutcome,
	compressedFileName,
	compressLossless,
	compressRaster,
	DEFAULT_PDF_COMPRESS_SETTINGS,
	inspectPdfForCompress,
	sanitizePdfCompressSettings,
} from '@/lib/tools/pdf-compress';
import { formatBytes } from '../pdf-merge/MergeFileList';

const PREVIEW_WIDTH_PX = 320;

type LoadedPdf = {
	file: File;
	bytes: Uint8Array;
	pageCount: number;
	session: PdfRenderSession;
	previewUrl: string | null;
};

type CompressResult = {
	outcome: CompressOutcome;
	blob: Blob | null;
	fileName: string;
	previewUrl: string | null;
	elapsedMs: number;
	settingsLabel: string;
};

function messageOf(error: unknown): string {
	return error instanceof PdfToolError ? error.message : CORRUPT_PDF_MESSAGE;
}

function releaseLoaded(loaded: LoadedPdf | null): void {
	if (!loaded) return;
	if (loaded.previewUrl) URL.revokeObjectURL(loaded.previewUrl);
	void loaded.session.destroy().catch(() => undefined);
}

function blobToUrl(blob: Blob | null): string | null {
	return blob ? URL.createObjectURL(blob) : null;
}

export default function PdfCompress() {
	const { trackRun } = useToolAnalytics('pdf-compress');
	const [settings, updateSettings] = useToolSettings(
		'pdf-compress',
		DEFAULT_PDF_COMPRESS_SETTINGS,
		sanitizePdfCompressSettings,
	);
	// 画像化はデータ損失を伴うため、方式と同意は保存せず毎回選択させる
	const [mode, setMode] = useState<CompressMode>('lossless');
	const [acknowledged, setAcknowledged] = useState(false);
	const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
	const [loading, setLoading] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

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
	} = useSingleResultProcessing<CompressResult>({
		fallbackErrorMessage: 'PDFの圧縮に失敗しました。',
		releaseResult: (r) => {
			if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
		},
		onRunComplete: () => trackRun(),
	});

	const replaceLoaded = useCallback((next: LoadedPdf | null) => {
		releaseLoaded(loadedRef.current);
		loadedRef.current = next;
		setLoaded(next);
	}, []);

	const stopRun = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
	}, []);

	// アンマウント時: 進行中の処理・読み込みを止め、PDF.jsの文書とObjectURLを解放する
	useEffect(() => {
		return () => {
			loadIdRef.current++;
			abortRef.current?.abort();
			releaseLoaded(loadedRef.current);
			loadedRef.current = null;
		};
	}, []);

	const resetForNewInput = useCallback(() => {
		setLoading(false);
		stopRun();
		cancel();
		clearResult();
		setError(null);
		setNotice(null);
		setMode('lossless');
		setAcknowledged(false);
		replaceLoaded(null);
	}, [stopRun, cancel, clearResult, setError, replaceLoaded]);

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
			let previewUrl: string | null = null;
			try {
				const bytes = new Uint8Array(await file.arrayBuffer());
				const { pageCount } = await inspectPdfForCompress(bytes);
				if (isStale()) return;
				session = await openPdfRenderSession(bytes);
				if (isStale()) return;
				assertCompressibleFlags(session.flags);
				if (session.pageCount !== pageCount) {
					throw new PdfToolError('corrupt', CORRUPT_PDF_MESSAGE);
				}
				previewUrl = blobToUrl(
					await renderPreviewBlob(session, 1, PREVIEW_WIDTH_PX),
				);
				if (isStale()) return;
				replaceLoaded({ file, bytes, pageCount, session, previewUrl });
				session = null;
				previewUrl = null;
			} catch (err) {
				if (!isStale()) setError(`${file.name}: ${messageOf(err)}`);
			} finally {
				// 採用されなかった（失敗・古い読み込み）セッションとプレビューを解放する
				if (session) void session.destroy().catch(() => undefined);
				if (previewUrl) URL.revokeObjectURL(previewUrl);
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

	// 設定・方式を変えたら、古い設定の結果を表示し続けない
	const changeMode = useCallback(
		(next: CompressMode) => {
			setMode(next);
			setAcknowledged(false);
			setNotice(null);
			clearResult();
		},
		[clearResult],
	);

	const canRun =
		loaded !== null &&
		!processing &&
		!loading &&
		(mode === 'lossless' || acknowledged);

	const handleRun = useCallback(async () => {
		if (!loaded || (mode === 'raster' && !acknowledged)) return;
		stopRun();
		const controller = new AbortController();
		abortRef.current = controller;
		const { signal } = controller;
		setNotice(null);
		const target = loaded;
		const runSettings = settings;
		const settingsLabel =
			mode === 'lossless'
				? '標準（文字を保持）'
				: `画像化（${runSettings.dpi}dpi・JPEG品質${runSettings.jpegQuality}%）`;

		await run(1, async (onProgress) => {
			const started = performance.now();
			const outcome =
				mode === 'lossless'
					? await compressLossless(target.bytes, { signal, onProgress })
					: await compressRaster(target.bytes, target.session, runSettings, {
							signal,
							onProgress,
						});
			let previewUrl: string | null = null;
			if (outcome.reduced) {
				try {
					const resultSession = await openPdfRenderSession(outcome.bytes);
					try {
						previewUrl = blobToUrl(
							await renderPreviewBlob(
								resultSession,
								1,
								PREVIEW_WIDTH_PX,
								signal,
							),
						);
					} finally {
						await resultSession.destroy();
					}
				} catch {
					previewUrl = null;
				}
			}
			if (signal.aborted && previewUrl) {
				URL.revokeObjectURL(previewUrl);
				previewUrl = null;
			}
			return {
				outcome,
				blob: outcome.reduced
					? new Blob([outcome.bytes as Uint8Array<ArrayBuffer>], {
							type: 'application/pdf',
						})
					: null,
				fileName: compressedFileName(pdfBaseName(target.file.name)),
				previewUrl,
				elapsedMs: performance.now() - started,
				settingsLabel,
			};
		});
		if (abortRef.current === controller) abortRef.current = null;
	}, [loaded, mode, acknowledged, settings, run, stopRun]);

	const handleCancel = useCallback(() => {
		stopRun();
		cancel();
		setNotice('処理をキャンセルしました。元のファイルは変更されていません。');
	}, [stopRun, cancel]);

	const percent =
		progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
	const outcome = result?.outcome ?? null;

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
				inputAriaLabel="圧縮するPDFを選択"
				selectedFileName={loaded?.file.name ?? null}
				onClear={loaded ? handleClear : undefined}
				data-testid="pdf-compress-input"
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
					<span>PDFを確認中…</span>
				</div>
			)}

			{loaded && (
				<>
					<p className="text-sm" data-testid="pdf-compress-info">
						<span className="font-medium">{loaded.file.name}</span>
						<span className="ml-2 text-muted-foreground">
							全{loaded.pageCount}ページ・{formatBytes(loaded.file.size)}
						</span>
					</p>

					<fieldset className="space-y-3" disabled={processing}>
						<legend className="mb-2 text-sm font-medium">圧縮方式</legend>
						<label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50">
							<input
								type="radio"
								name="pdf-compress-mode"
								value="lossless"
								checked={mode === 'lossless'}
								onChange={() => changeMode('lossless')}
								className="mt-1 accent-primary"
							/>
							<span className="text-sm">
								<span className="font-medium">
									標準（文字を保持して最適化）
								</span>
								<span className="block text-muted-foreground">
									文字・ページ・リンクはそのままに、文書内部のデータを整理・圧縮します。画質は変わりません。小さくならない場合は元のファイルを保持します。
								</span>
							</span>
						</label>
						<label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50">
							<input
								type="radio"
								name="pdf-compress-mode"
								value="raster"
								checked={mode === 'raster'}
								onChange={() => changeMode('raster')}
								className="mt-1 accent-primary"
							/>
							<span className="text-sm">
								<span className="font-medium">
									画像化して圧縮（スキャンPDF向け）
								</span>
								<span className="block text-muted-foreground">
									各ページを画像（JPEG）に置き換えて作り直します。スキャンした書類など、画像中心のPDFで効果があります。
								</span>
							</span>
						</label>
					</fieldset>

					{mode === 'raster' && (
						<div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
							<div
								className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
								id="raster-warning"
							>
								<AlertTriangle
									className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
									aria-hidden="true"
								/>
								<div className="space-y-1">
									<p className="font-medium text-destructive">
										画像化すると次の情報が失われます
									</p>
									<ul className="list-disc space-y-0.5 pl-5 text-foreground">
										<li>
											文字の選択・コピー・検索（文字認識（OCR）は行いません）
										</li>
										<li>リンク・しおり・注釈・入力フォーム・添付ファイル</li>
										<li>
											画質（解像度とJPEG品質に応じて文字や図が粗くなります）
										</li>
									</ul>
									<p className="text-muted-foreground">
										ページ数・並び順・表示上の向きと縦横の大きさは維持します。
									</p>
								</div>
							</div>

							<div className="space-y-2">
								<p className="text-sm font-medium" id="raster-dpi-label">
									解像度
								</p>
								<ToggleGroup
									type="single"
									variant="outline"
									value={String(settings.dpi)}
									onValueChange={(v) => {
										const dpi = Number(v);
										if (isDpi(dpi)) {
											updateSettings({ dpi });
											clearResult();
										}
									}}
									aria-labelledby="raster-dpi-label"
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
									72dpiは最も小さく粗い、144dpiは文字が読みやすい代わりに大きくなります。
								</p>
							</div>

							<div className="space-y-2">
								<p className="text-sm font-medium" id="raster-quality-label">
									JPEG品質
								</p>
								<ToggleGroup
									type="single"
									variant="outline"
									value={String(settings.jpegQuality)}
									onValueChange={(v) => {
										const jpegQuality = Number(v);
										if (isJpegQuality(jpegQuality)) {
											updateSettings({ jpegQuality });
											clearResult();
										}
									}}
									aria-labelledby="raster-quality-label"
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

							<div className="flex items-start gap-2">
								<Checkbox
									id="raster-ack"
									checked={acknowledged}
									onCheckedChange={(v) => {
										setAcknowledged(v === true);
										clearResult();
									}}
									disabled={processing}
									aria-describedby="raster-warning"
									className="mt-0.5"
								/>
								<label htmlFor="raster-ack" className="text-sm">
									文字の選択・検索、リンク、注釈などが失われ、画質が変わることを理解しました
								</label>
							</div>
						</div>
					)}

					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={() => void handleRun()} disabled={!canRun}>
							<FileDown className="h-4 w-4" />
							<span className="ml-1">
								{mode === 'lossless' ? '圧縮する' : '画像化して圧縮する'}
							</span>
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
									{mode === 'raster'
										? `ページを画像化中… ${Math.min(progress.done, loaded.pageCount)} / ${loaded.pageCount}ページ`
										: `最適化中… ${percent}%`}
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
								aria-label="圧縮の進捗"
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

					{result && outcome && !processing && (
						<div
							className="space-y-4 rounded-lg border border-border bg-card p-4"
							role="status"
							aria-live="polite"
							data-testid="pdf-compress-result"
						>
							{outcome.reduced ? (
								<div className="flex items-start gap-2 text-sm">
									<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-safety" />
									<div>
										<p className="font-medium">
											圧縮しました: {formatBytes(outcome.originalSize)} →{' '}
											{formatBytes(outcome.outputSize)}（
											{reductionPercent(
												outcome.originalSize,
												outcome.outputSize,
											)}
											%削減）
										</p>
										<p className="text-muted-foreground">
											全{outcome.pageCount}ページ・方式: {result.settingsLabel}
											・処理時間 {(result.elapsedMs / 1000).toFixed(1)}秒
										</p>
									</div>
								</div>
							) : (
								<div className="flex items-start gap-2 text-sm">
									<Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
									<div>
										<p className="font-medium">
											これ以上小さくできませんでした。元のファイルのまま（
											{formatBytes(outcome.originalSize)}）です。
										</p>
										<p className="text-muted-foreground">
											{outcome.mode === 'lossless'
												? 'すでに最適化されているPDFです。スキャンした書類なら「画像化して圧縮」で小さくなる場合があります。'
												: '画像化しても元より小さくなりませんでした。解像度や品質を下げると小さくなる場合があります。'}
										</p>
									</div>
								</div>
							)}

							{result.blob && (
								<Button
									onClick={() =>
										result.blob && downloadBlob(result.blob, result.fileName)
									}
								>
									<Download className="h-4 w-4" />
									<span className="ml-1">圧縮したPDFをダウンロード</span>
								</Button>
							)}

							{(loaded.previewUrl || result.previewUrl) && result.blob && (
								<div className="grid gap-4 sm:grid-cols-2">
									{loaded.previewUrl && (
										<figure className="space-y-1">
											<img
												src={loaded.previewUrl}
												alt="元のPDFの1ページ目"
												className="max-h-80 w-auto rounded border border-border bg-white"
											/>
											<figcaption className="text-xs text-muted-foreground">
												元のPDF（1ページ目）
											</figcaption>
										</figure>
									)}
									{result.previewUrl && (
										<figure className="space-y-1">
											<img
												src={result.previewUrl}
												alt="圧縮後のPDFの1ページ目"
												className="max-h-80 w-auto rounded border border-border bg-white"
												data-testid="pdf-compress-result-preview"
											/>
											<figcaption className="text-xs text-muted-foreground">
												圧縮後（1ページ目）
											</figcaption>
										</figure>
									)}
								</div>
							)}
						</div>
					)}

					{loaded.previewUrl && !result && !processing && (
						<figure className="space-y-1">
							<img
								src={loaded.previewUrl}
								alt="選択したPDFの1ページ目"
								className="max-h-80 w-auto rounded border border-border bg-white"
								data-testid="pdf-compress-input-preview"
							/>
							<figcaption className="text-xs text-muted-foreground">
								1ページ目のプレビュー
							</figcaption>
						</figure>
					)}
				</>
			)}

			<p className="text-xs text-muted-foreground">
				パスワード付き・電子署名付き・入力フォーム付きのPDFには対応していません。元のファイルは変更されず、結果は新しいファイルとして保存します。
			</p>
		</div>
	);
}
