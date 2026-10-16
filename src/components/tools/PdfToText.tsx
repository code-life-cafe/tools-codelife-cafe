// PdfToText — PDFの文字データ（テキストレイヤー）を取り出すツールのUI
// OCRはしない。PDFはサーバーへ送信せず、ブラウザ内で1ページずつ処理する。
// 抽出結果はReactの文字列／textareaとして表示し、HTMLやMarkdownとして解釈しない。

import {
	AlertTriangle,
	CheckCircle2,
	Copy,
	Download,
	FileText,
	Loader2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { copyText } from '@/lib/clipboard';
import { useSingleResultProcessing } from '@/lib/hooks/useSingleResultProcessing';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import {
	encryptedError,
	PdfToolError,
	pdfBaseName,
	validatePageCount,
	validatePdfInput,
} from '@/lib/pdf/common';
import { openPdfRenderSession, type PdfRenderSession } from '@/lib/pdf/render';
import { downloadBlob } from '@/lib/tools/image-common';
import {
	allPagesInput,
	assembleText,
	buildTxtBlob,
	countCharacters,
	DEFAULT_PDF_TO_TEXT_SETTINGS,
	extractPdfText,
	inspectPdfForText,
	type LineMode,
	MAX_TEXT_UNITS,
	type PageText,
	type PdfToTextSettings,
	rejectUnsupportedStructure,
	resolvePageSelection,
	sanitizePdfToTextSettings,
	summarizePages,
	txtFileName,
	validateOutputText,
} from '@/lib/tools/pdf-to-text';
import { formatBytes } from '../pdf-merge/MergeFileList';

type LoadedPdf = {
	file: File;
	pageCount: number;
	session: PdfRenderSession;
};

type TextResult = {
	/** 実行ごとに増える識別子。コピー等の非同期操作が古い結果へ反映されないために使う */
	id: number;
	pages: PageText[];
	baseName: string;
	settings: PdfToTextSettings;
};

const EMPTY_PAGE_MESSAGE =
	'文字データを取得できませんでした。画像PDFや空白ページの可能性があります';
const FILE_READ_FAILED_MESSAGE =
	'ファイルを読み込めませんでした。ファイルが移動・削除されていないか、別のアプリで開かれていないか確認して、もう一度お試しください。';
const LOAD_FAILED_MESSAGE =
	'PDFを読み込めませんでした。読み込みに必要なファイルを取得できなかった可能性があります。時間をおいて、もう一度お試しください。';

/** Blob/File の読み取り。失敗（NotReadableError等）は日本語メッセージの PdfToolError にする */
async function readBytes(blob: Blob): Promise<Uint8Array> {
	try {
		return new Uint8Array(await blob.arrayBuffer());
	} catch {
		throw new PdfToolError('render-failed', FILE_READ_FAILED_MESSAGE);
	}
}

function messageOf(error: unknown): string {
	return error instanceof PdfToolError ? error.message : LOAD_FAILED_MESSAGE;
}

function releaseLoaded(loaded: LoadedPdf | null): void {
	if (loaded) void loaded.session.destroy().catch(() => undefined);
}

export default function PdfToText() {
	const { trackRun, trackSharedUrlOpen } = useToolAnalytics('pdf-to-text');
	const [settings, updateSettings] = useToolSettings(
		'pdf-to-text',
		DEFAULT_PDF_TO_TEXT_SETTINGS,
		sanitizePdfToTextSettings,
	);
	const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
	const [loading, setLoading] = useState(false);
	const [rangeInput, setRangeInput] = useState('');
	const [notice, setNotice] = useState<string | null>(null);
	const [edit, setEdit] = useState<{ result: TextResult; text: string } | null>(
		null,
	);
	const [copyStatus, setCopyStatus] = useState<{
		id: number;
		ok: boolean;
	} | null>(null);

	const loadIdRef = useRef(0);
	const runIdRef = useRef(0);
	const currentResultIdRef = useRef<number | null>(null);
	const loadedRef = useRef<LoadedPdf | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const {
		processing,
		progress,
		result,
		clearResult,
		error,
		setError,
		run,
		cancel,
	} = useSingleResultProcessing<TextResult>({
		fallbackErrorMessage: 'テキストの抽出に失敗しました。',
		onRunComplete: () => trackRun(),
	});

	// 共有URL（settings クエリ）からの来訪を計測する（設定値のみ。本文は含まない）
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.has('settings')) trackSharedUrlOpen();
	}, [trackSharedUrlOpen]);

	currentResultIdRef.current = result?.id ?? null;

	const replaceLoaded = useCallback((next: LoadedPdf | null) => {
		releaseLoaded(loadedRef.current);
		loadedRef.current = next;
		setLoaded(next);
	}, []);

	const stopRun = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
	}, []);

	const clearCopyTimer = useCallback(() => {
		if (copyTimerRef.current !== null) {
			clearTimeout(copyTimerRef.current);
			copyTimerRef.current = null;
		}
	}, []);

	useEffect(() => {
		return () => {
			loadIdRef.current++;
			abortRef.current?.abort();
			releaseLoaded(loadedRef.current);
			loadedRef.current = null;
			if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
		};
	}, []);

	const clearOutputs = useCallback(() => {
		clearResult();
		setEdit(null);
		setCopyStatus(null);
		clearCopyTimer();
	}, [clearResult, clearCopyTimer]);

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

			let session: PdfRenderSession | null = null;
			try {
				// 先頭バイト・全体のどちらの読み取り失敗も、ここで日本語エラーにする
				const head = await readBytes(file.slice(0, 5));
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
				const bytes = await readBytes(file);
				if (isStale()) return;
				session = await openPdfRenderSession(bytes);
				if (isStale()) return;
				// 閲覧パスワードなしで開ける暗号化PDF（権限パスワードのみ）も対象外とする
				if (session.flags.encrypted) throw encryptedError();
				const unsupported = rejectUnsupportedStructure(session.flags);
				if (unsupported) throw unsupported;
				// PDF圧縮と同じバイト検査。PDF.jsのフラグに出ない署名辞書・フォームも拒否する
				await inspectPdfForText(bytes);
				if (isStale()) return;
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
		clearOutputs();
		const target = loaded;
		const pages = selection.pages;
		const runSettings = settings;
		const id = ++runIdRef.current;
		await run(pages.length, async (onProgress) => {
			const extracted = await extractPdfText(
				target.session,
				pages,
				runSettings,
				{ signal: controller.signal, onProgress },
			);
			const textResult: TextResult = {
				id,
				pages: extracted.pages,
				baseName: pdfBaseName(target.file.name),
				settings: runSettings,
			};
			return textResult;
		});
		if (abortRef.current === controller) abortRef.current = null;
	}, [loaded, selection, settings, run, stopRun, clearOutputs]);

	const handleCancel = useCallback(() => {
		stopRun();
		cancel();
		clearOutputs();
		setNotice(
			'抽出をキャンセルしました。途中までの結果は保存できません。もう一度「テキストを抽出」を押してください。',
		);
	}, [stopRun, cancel, clearOutputs]);

	const changeSettings = useCallback(
		(patch: Partial<PdfToTextSettings>) => {
			updateSettings(patch);
			setNotice(null);
			clearOutputs();
		},
		[updateSettings, clearOutputs],
	);

	const summary = useMemo(
		() => (result ? summarizePages(result.pages) : null),
		[result],
	);

	// 表示中のテキスト。編集がこの結果のものでなければ、抽出直後の内容から組み立てる
	const text = useMemo(() => {
		if (!result) return '';
		if (edit && edit.result === result) return edit.text;
		return assembleText(result.pages, {
			pageHeadings: result.settings.pageHeadings,
		});
	}, [result, edit]);

	const outputError = useMemo(
		() => (result ? validateOutputText(text, result.pages.length) : null),
		[result, text],
	);
	const characterCount = useMemo(() => countCharacters(text), [text]);
	const hasContent = text.trim() !== '';
	const canUseOutput =
		!!result && !processing && outputError === null && hasContent;

	const handleCopy = useCallback(async () => {
		if (!result || !canUseOutput) return;
		const target = result;
		const ok = await copyText(text);
		// コピー中に再抽出・差し替え・リセットされた場合は、古い結果の成否を表示しない
		if (currentResultIdRef.current !== target.id) return;
		setCopyStatus({ id: target.id, ok });
		clearCopyTimer();
		copyTimerRef.current = setTimeout(() => setCopyStatus(null), 2500);
	}, [result, canUseOutput, text, clearCopyTimer]);

	const handleSave = useCallback(() => {
		if (!result || !canUseOutput) return;
		downloadBlob(buildTxtBlob(text), txtFileName(result.baseName));
	}, [result, canUseOutput, text]);

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
				inputAriaLabel="テキストを抽出するPDFを選択"
				selectedFileName={loaded?.file.name ?? null}
				onClear={loaded ? handleClear : undefined}
				data-testid="pdf-to-text-input"
			/>

			<p className="text-xs text-muted-foreground">
				PDFに含まれる文字データ（テキストレイヤー）を取り出します。OCR（画像の文字認識）はしないため、スキャン画像だけのPDFや白紙ページからは文字を取得できません。
			</p>

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
					<p className="text-sm" data-testid="pdf-to-text-info">
						<span className="font-medium">{loaded.file.name}</span>
						<span className="ml-2 text-muted-foreground">
							全{loaded.pageCount}ページ・{formatBytes(loaded.file.size)}
						</span>
					</p>

					<div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
						<div className="space-y-2">
							<label
								className="text-sm font-medium"
								htmlFor="pdf-to-text-range"
							>
								抽出するページ
							</label>
							<Input
								id="pdf-to-text-range"
								value={rangeInput}
								onChange={(e) => {
									setRangeInput(e.target.value);
									setNotice(null);
									clearOutputs();
								}}
								placeholder={`例: 1-3,5（全${loaded.pageCount}ページ）`}
								disabled={processing}
								aria-invalid={showRangeErrors}
								aria-describedby="pdf-to-text-range-help"
							/>
							<p
								className="text-xs text-muted-foreground"
								id="pdf-to-text-range-help"
							>
								「1-3,5,8-」のようにカンマ区切りで指定します。重複は1回にまとめ、ページ順に出力します。
							</p>
							{rangeInput.trim() === '' && (
								<p className="text-xs text-destructive">
									抽出するページを入力してください。
								</p>
							)}
							{showRangeErrors && selection && !selection.ok && (
								<ul
									className="space-y-1 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
									role="alert"
									data-testid="pdf-to-text-range-errors"
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
							<p className="text-sm font-medium" id="pdf-to-text-mode-label">
								改行の扱い
							</p>
							<ToggleGroup
								type="single"
								variant="outline"
								value={settings.lineMode}
								onValueChange={(v) => {
									if (v === 'internal' || v === 'lines') {
										changeSettings({ lineMode: v as LineMode });
									}
								}}
								aria-labelledby="pdf-to-text-mode-label"
								disabled={processing}
							>
								<ToggleGroupItem value="internal" aria-label="PDFの順序のまま">
									PDFの順序のまま
								</ToggleGroupItem>
								<ToggleGroupItem value="lines" aria-label="横書きの行を整える">
									横書きの行を整える
								</ToggleGroupItem>
							</ToggleGroup>
							<p className="text-xs text-muted-foreground">
								「PDFの順序のまま」はPDF内部の並びと改行情報に沿って出力します。「横書きの行を整える」は表示位置が同じ行の文字をまとめて上から下へ並べます。どちらも段組み・表・縦書き・ルビの読み順は保証せず、要約・補完・ハイフンの削除・表記の正規化はしません。うまく並ばないときは「PDFの順序のまま」に戻してください。
							</p>
						</div>

						<div className="flex items-center gap-3">
							<Switch
								id="pdf-to-text-headings"
								checked={settings.pageHeadings}
								onCheckedChange={(checked) =>
									changeSettings({ pageHeadings: checked })
								}
								disabled={processing}
							/>
							<Label htmlFor="pdf-to-text-headings" className="text-sm">
								ページ区切りの見出しを入れる
							</Label>
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={() => void handleRun()} disabled={!canRun}>
							<FileText className="h-4 w-4" />
							<span className="ml-1">テキストを抽出</span>
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
									抽出中… {progress.done} / {progress.total}ページ
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
								aria-label="抽出の進捗"
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

					{result && summary && !processing && (
						<div className="space-y-4" data-testid="pdf-to-text-results">
							{summary.hasAnyText ? (
								<div
									className="flex items-start gap-2 rounded-lg border border-safety/30 bg-safety/10 p-3 text-sm"
									role="status"
									aria-live="polite"
								>
									<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-safety" />
									<p className="text-foreground">
										対象{summary.targetPages}ページのうち{summary.textPages}
										ページから文字を取り出しました。内容を確認し、必要に応じて編集してからコピーまたは保存してください。
									</p>
								</div>
							) : (
								<div
									className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
									role="alert"
									data-testid="pdf-to-text-no-text"
								>
									<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
									<p>
										対象{summary.targetPages}
										ページすべてで文字データを取得できませんでした。画像PDFや白紙ページの可能性があります。このツールはOCRをしないため、コピー・保存できるテキストはありません。
									</p>
								</div>
							)}

							{summary.hasAnyText && summary.emptyPages.length > 0 && (
								<div
									className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
									role="alert"
									data-testid="pdf-to-text-empty-warning"
								>
									<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
									<p>
										{summary.emptyPages.join('、')}
										ページ目は{EMPTY_PAGE_MESSAGE}。
									</p>
								</div>
							)}

							<ul className="space-y-1" data-testid="pdf-to-text-page-list">
								{result.pages.map((page) => (
									<li
										key={page.pageNumber}
										className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
									>
										<span className="font-medium">
											{page.pageNumber}ページ目
										</span>
										<span className="text-xs text-muted-foreground">
											{page.hasText
												? `${countCharacters(page.text)}文字`
												: EMPTY_PAGE_MESSAGE}
										</span>
									</li>
								))}
							</ul>

							{summary.hasAnyText && (
								<div className="space-y-2">
									<Label htmlFor="pdf-to-text-output" className="text-sm">
										抽出結果（編集できます）
									</Label>
									<Textarea
										id="pdf-to-text-output"
										data-testid="pdf-to-text-output"
										value={text}
										onChange={(e) => setEdit({ result, text: e.target.value })}
										spellCheck={false}
										aria-invalid={outputError !== null}
										aria-describedby="pdf-to-text-output-status"
										className="field-sizing-fixed h-80 max-h-[60vh] overflow-auto font-mono text-sm"
									/>
									<p
										className="text-xs text-muted-foreground"
										id="pdf-to-text-output-status"
										data-testid="pdf-to-text-count"
									>
										{characterCount.toLocaleString('ja-JP')}文字・対象
										{summary.targetPages}ページ（上限: 抽出テキスト
										{MAX_TEXT_UNITS.toLocaleString('ja-JP')}
										文字相当・TXT 8MB）
									</p>
									{outputError && (
										<p
											className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
											role="alert"
										>
											{outputError}
										</p>
									)}
									{!hasContent && outputError === null && (
										<p className="text-xs text-destructive">
											テキストが空のため、コピー・保存できません。
										</p>
									)}
									<div className="flex flex-wrap items-center gap-2">
										<Button
											variant="outline"
											onClick={() => void handleCopy()}
											disabled={!canUseOutput}
										>
											<Copy className="h-4 w-4" />
											<span className="ml-1">すべてコピー</span>
										</Button>
										<Button onClick={handleSave} disabled={!canUseOutput}>
											<Download className="h-4 w-4" />
											<span className="ml-1">TXTで保存</span>
										</Button>
										<span
											className="text-sm text-muted-foreground"
											role="status"
											aria-live="polite"
										>
											{copyStatus?.id === result.id
												? copyStatus.ok
													? 'コピーしました'
													: 'コピーに失敗しました。テキストを選択してコピーしてください'
												: ''}
										</span>
									</div>
									<p className="text-xs text-muted-foreground">
										保存形式はUTF-8（BOMなし）・改行はLFです。ファイル名は「
										{result.baseName}
										_text.txt」になります。
									</p>
								</div>
							)}
						</div>
					)}
				</>
			)}

			<p className="text-xs text-muted-foreground">
				パスワード付きPDF・電子署名付きPDF・入力フォーム付きPDFには対応していません。複数ファイルの一括抽出、表の構造化、OCRにも対応していません。
			</p>
		</div>
	);
}
