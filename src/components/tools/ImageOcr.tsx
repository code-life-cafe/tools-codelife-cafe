// ImageOcr — 画像の文字をブラウザ内で読み取るツールのUI
// 画像・ファイル名・認識結果はサーバーへ送信せず、保存もしない。
// 保存するのは設定（言語モード）と、言語データ（静的モデル）の専用キャッシュだけ。
// 認識結果はReactの文字列／textareaとして表示し、HTMLやMarkdownとして解釈しない。

import {
	AlertTriangle,
	CheckCircle2,
	Copy,
	Download,
	Loader2,
	ScanText,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { copyText } from '@/lib/clipboard';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import {
	decodeImageForOcr,
	OCR_ENGINE_FAILED_MESSAGE,
	OcrError,
	type OcrPhase,
	recognizeImage,
} from '@/lib/ocr/client';
import { downloadBlob } from '@/lib/tools/image-common';
import {
	buildTxtBlob,
	checkOcrFileSize,
	countCharacters,
	DEFAULT_IMAGE_OCR_SETTINGS,
	EMPTY_RESULT_MESSAGE,
	type ImageOcrSettings,
	imageBaseName,
	inspectOcrImage,
	isBlankText,
	MAX_OCR_TEXT_UNITS,
	normalizeNewlines,
	OCR_MODES,
	type OcrMode,
	sanitizeImageOcrSettings,
	TEXT_TOO_LONG_MESSAGE,
	txtFileName,
	validateOutputText,
} from '@/lib/tools/image-ocr';
import { formatBytes } from '../pdf-merge/MergeFileList';

type LoadedImage = {
	file: File;
	previewUrl: string;
	width: number;
	height: number;
};

type Output = { id: number; text: string; baseName: string };

const FILE_READ_FAILED_MESSAGE =
	'ファイルを読み込めませんでした。ファイルが移動・削除されていないか確認して、もう一度お試しください。';
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

const PHASE_LABEL: Record<OcrPhase, string> = {
	model: '言語データを準備中…',
	engine: '文字認識エンジンを起動中…',
	recognize: '文字を読み取り中…',
};

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.tagName === 'TEXTAREA' ||
		target.tagName === 'INPUT' ||
		target.isContentEditable
	);
}

export default function ImageOcr() {
	const { trackRun, trackSharedUrlOpen } = useToolAnalytics('image-ocr');
	const [settings, updateSettings] = useToolSettings(
		'image-ocr',
		DEFAULT_IMAGE_OCR_SETTINGS,
		sanitizeImageOcrSettings,
	);
	const [loaded, setLoaded] = useState<LoadedImage | null>(null);
	const [checking, setChecking] = useState(false);
	const [processing, setProcessing] = useState(false);
	const [phase, setPhase] = useState<{
		phase: OcrPhase;
		ratio: number | null;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [modelNote, setModelNote] = useState<string | null>(null);
	const [output, setOutput] = useState<Output | null>(null);
	const [copyStatus, setCopyStatus] = useState<{
		id: number;
		ok: boolean;
	} | null>(null);

	const inputIdRef = useRef(0);
	const runIdRef = useRef(0);
	const abortRef = useRef<AbortController | null>(null);
	const loadedRef = useRef<LoadedImage | null>(null);
	const outputIdRef = useRef<number | null>(null);
	const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	outputIdRef.current = output?.id ?? null;

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.has('settings')) trackSharedUrlOpen();
	}, [trackSharedUrlOpen]);

	const clearCopyTimer = useCallback(() => {
		if (copyTimerRef.current !== null) {
			clearTimeout(copyTimerRef.current);
			copyTimerRef.current = null;
		}
	}, []);

	const stopRun = useCallback(() => {
		runIdRef.current++;
		abortRef.current?.abort();
		abortRef.current = null;
		setProcessing(false);
		setPhase(null);
	}, []);

	const clearOutputs = useCallback(() => {
		setOutput(null);
		setCopyStatus(null);
		setModelNote(null);
		clearCopyTimer();
	}, [clearCopyTimer]);

	const replaceLoaded = useCallback((next: LoadedImage | null) => {
		if (loadedRef.current) URL.revokeObjectURL(loadedRef.current.previewUrl);
		loadedRef.current = next;
		setLoaded(next);
	}, []);

	useEffect(() => {
		return () => {
			inputIdRef.current++;
			runIdRef.current++;
			abortRef.current?.abort();
			if (loadedRef.current) URL.revokeObjectURL(loadedRef.current.previewUrl);
			loadedRef.current = null;
			if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
		};
	}, []);

	const resetForNewInput = useCallback(() => {
		setChecking(false);
		stopRun();
		clearOutputs();
		setError(null);
		setNotice(null);
		replaceLoaded(null);
	}, [stopRun, clearOutputs, replaceLoaded]);

	const handleFile = useCallback(
		async (file: File) => {
			const inputId = ++inputIdRef.current;
			const isStale = () => inputId !== inputIdRef.current;
			resetForNewInput();
			// 空・20MiB超は、全体を読み込む前にサイズだけで同期的に拒否する
			const sizeError = checkOcrFileSize(file.size);
			if (sizeError && !sizeError.ok) {
				setError(`${file.name}: ${sizeError.message}`);
				return;
			}
			setChecking(true);
			try {
				let bytes: Uint8Array;
				try {
					bytes = new Uint8Array(await file.arrayBuffer());
				} catch {
					if (!isStale()) setError(`${file.name}: ${FILE_READ_FAILED_MESSAGE}`);
					return;
				}
				if (isStale()) return;
				const check = inspectOcrImage(bytes, file.size);
				if (!check.ok) {
					setError(`${file.name}: ${check.message}`);
					return;
				}
				replaceLoaded({
					file,
					previewUrl: URL.createObjectURL(file),
					width: check.width,
					height: check.height,
				});
			} finally {
				if (!isStale()) setChecking(false);
			}
		},
		[resetForNewInput, replaceLoaded],
	);

	const handleFiles = useCallback(
		(files: File[]) => {
			if (files.length > 1) {
				inputIdRef.current++;
				setChecking(false);
				resetForNewInput();
				setError(
					'複数の画像は一度に読み取れません。画像を1枚だけ選択してください。',
				);
				return;
			}
			void handleFile(files[0]);
		},
		[handleFile, resetForNewInput],
	);

	// 画像の貼り付け（テキスト入力欄への貼り付けには干渉しない）
	useEffect(() => {
		if (processing) return;
		const onPaste = (event: ClipboardEvent) => {
			if (isEditableTarget(event.target)) return;
			const items = Array.from(event.clipboardData?.items ?? []).filter(
				(item) => item.kind === 'file' && item.type.startsWith('image/'),
			);
			if (items.length === 0) return;
			event.preventDefault();
			const files = items
				.map((item) => item.getAsFile())
				.filter((f): f is File => f !== null);
			if (files.length > 0) handleFiles(files);
		};
		document.addEventListener('paste', onPaste);
		return () => document.removeEventListener('paste', onPaste);
	}, [processing, handleFiles]);

	const handleClear = useCallback(() => {
		inputIdRef.current++;
		setChecking(false);
		resetForNewInput();
	}, [resetForNewInput]);

	const handleRun = useCallback(async () => {
		const target = loadedRef.current;
		if (!target) return;
		stopRun();
		const controller = new AbortController();
		abortRef.current = controller;
		const id = ++runIdRef.current;
		const isStale = () => id !== runIdRef.current;
		const mode: OcrMode = settings.mode;
		clearOutputs();
		setError(null);
		setNotice(null);
		setProcessing(true);
		setPhase({ phase: 'model', ratio: 0 });
		try {
			const decoded = await decodeImageForOcr(target.file);
			if (isStale()) return;
			const result = await recognizeImage(decoded.png, {
				mode,
				signal: controller.signal,
				onProgress: (p) => {
					if (!isStale()) setPhase(p);
				},
				onModelCacheUnavailable: () => {
					if (!isStale()) {
						setModelNote(
							'言語データをこのブラウザに保存できませんでした（容量不足や保存の無効化など）。認識はできますが、次回も言語データを取得し直します。',
						);
					}
				},
			});
			if (isStale()) return;
			const text = normalizeNewlines(result.text);
			if (validateOutputText(text)) {
				setError(TEXT_TOO_LONG_MESSAGE);
				return;
			}
			setOutput({ id, text, baseName: imageBaseName(target.file.name) });
			trackRun();
		} catch (err) {
			if (isStale()) return;
			if (err instanceof OcrError) {
				if (err.code === 'aborted') return;
				setError(err.message);
			} else {
				setError(OCR_ENGINE_FAILED_MESSAGE);
			}
		} finally {
			if (!isStale()) {
				abortRef.current = null;
				setProcessing(false);
				setPhase(null);
			}
		}
	}, [settings.mode, stopRun, clearOutputs, trackRun]);

	const handleCancel = useCallback(() => {
		stopRun();
		clearOutputs();
		setNotice(
			'読み取りをキャンセルしました。もう一度「文字を読み取る」を押してください。',
		);
	}, [stopRun, clearOutputs]);

	const changeMode = useCallback(
		(mode: OcrMode) => {
			updateSettings({ mode } as Partial<ImageOcrSettings>);
			setNotice(null);
			clearOutputs();
		},
		[updateSettings, clearOutputs],
	);

	const text = output?.text ?? '';
	const outputError = useMemo(
		() => (output ? validateOutputText(text) : null),
		[output, text],
	);
	const characterCount = useMemo(() => countCharacters(text), [text]);
	const blank = isBlankText(text);
	const canUseOutput =
		!!output && !processing && outputError === null && !blank;

	const handleCopy = useCallback(async () => {
		if (!output || !canUseOutput) return;
		const target = output;
		const ok = await copyText(text);
		// コピー中に再実行・差し替えされた場合は、古い結果の成否を表示しない
		if (outputIdRef.current !== target.id) return;
		setCopyStatus({ id: target.id, ok });
		clearCopyTimer();
		copyTimerRef.current = setTimeout(() => setCopyStatus(null), 2500);
	}, [output, canUseOutput, text, clearCopyTimer]);

	const handleSave = useCallback(() => {
		if (!output || !canUseOutput) return;
		downloadBlob(buildTxtBlob(text), txtFileName(output.baseName));
	}, [output, canUseOutput, text]);

	const percent =
		phase?.ratio != null ? Math.round(Math.min(1, phase.ratio) * 100) : null;

	return (
		<div className="space-y-6">
			<FileDropzone
				multiple
				onFileSelect={(file) => handleFiles([file])}
				onFilesSelect={handleFiles}
				accept={IMAGE_ACCEPT}
				disabled={processing}
				label="画像をドラッグ＆ドロップ、またはクリックして選択"
				description="PNG・JPEG・WebP（1枚・20MiB以下・1辺8192px以下・1,200万画素以下）。貼り付けにも対応"
				privacyNote="画像はサーバーに送信されません。すべてブラウザ内で処理されます。"
				inputAriaLabel="文字を読み取る画像を選択"
				selectedFileName={loaded?.file.name ?? null}
				onClear={loaded ? handleClear : undefined}
				data-testid="image-ocr-input"
			/>

			<p className="text-xs text-muted-foreground">
				日本語と英語の横書きの活字（スクリーンショット・印刷物の画像）を読み取ります。手書き・縦書き・段組み・表の構造の復元には対応していません。認識結果には誤りが含まれることがあります。業務書類などの正確さは保証できないため、必ず元の画像と見比べて確認してください。
			</p>

			{error && (
				<div
					className="whitespace-pre-line rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
					role="alert"
					data-testid="image-ocr-error"
				>
					{error}
				</div>
			)}

			{checking && (
				<div
					className="flex items-center gap-2 text-sm text-muted-foreground"
					role="status"
					aria-live="polite"
				>
					<Loader2 className="h-4 w-4 animate-spin text-primary" />
					<span>画像を確認中…</span>
				</div>
			)}

			{loaded && (
				<>
					<div className="space-y-2">
						<p className="text-sm" data-testid="image-ocr-info">
							<span className="font-medium">{loaded.file.name}</span>
							<span className="ml-2 text-muted-foreground">
								{loaded.width}×{loaded.height}px・
								{formatBytes(loaded.file.size)}
							</span>
						</p>
						<img
							src={loaded.previewUrl}
							alt="読み取り対象の画像のプレビュー"
							data-testid="image-ocr-preview"
							className="max-h-72 max-w-full rounded-lg border border-border bg-muted/30 object-contain"
						/>
					</div>

					<div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
						<div className="space-y-2">
							<p className="text-sm font-medium" id="image-ocr-mode-label">
								言語
							</p>
							<ToggleGroup
								type="single"
								variant="outline"
								value={settings.mode}
								onValueChange={(v) => {
									if (v === 'jpn+eng' || v === 'eng') changeMode(v);
								}}
								aria-labelledby="image-ocr-mode-label"
								disabled={processing}
							>
								{OCR_MODES.map((m) => (
									<ToggleGroupItem
										key={m.value}
										value={m.value}
										aria-label={m.label}
									>
										{m.label}
									</ToggleGroupItem>
								))}
							</ToggleGroup>
							<p className="text-xs text-muted-foreground">
								初回の読み取り時に言語データ（日本語＋英語は約6.6MB、英語のみは約4.1MB）を取得し、このブラウザのキャッシュに保存します。保存するのは言語データだけで、画像や認識結果は保存しません。ページ・認識エンジン・言語データを取得済みで、それぞれのキャッシュが残っていればオフラインでも読み取れます。サイト更新やブラウザのキャッシュ削除後は、オンラインでの再取得が必要です。
							</p>
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<Button
							onClick={() => void handleRun()}
							disabled={processing || checking}
							data-testid="image-ocr-run"
						>
							<ScanText className="h-4 w-4" />
							<span className="ml-1">文字を読み取る</span>
						</Button>
					</div>

					{processing && phase && (
						<div className="space-y-2" data-testid="image-ocr-progress">
							<div
								className="flex items-center gap-2 text-sm text-muted-foreground"
								role="status"
								aria-live="polite"
							>
								<Loader2 className="h-4 w-4 animate-spin text-primary" />
								<span>
									{PHASE_LABEL[phase.phase]}
									{phase.phase !== 'engine' && percent !== null
										? ` ${percent}%`
										: ''}
								</span>
								<Button
									variant="ghost"
									size="sm"
									className="ml-auto"
									onClick={handleCancel}
									data-testid="image-ocr-cancel"
								>
									キャンセル
								</Button>
							</div>
							{phase.phase !== 'engine' && percent !== null && (
								<div
									className="h-2 w-full overflow-hidden rounded-full bg-muted"
									role="progressbar"
									aria-label={PHASE_LABEL[phase.phase]}
									aria-valuenow={percent}
									aria-valuemin={0}
									aria-valuemax={100}
								>
									<div
										className="h-full rounded-full bg-primary transition-all duration-200"
										style={{ width: `${percent}%` }}
									/>
								</div>
							)}
						</div>
					)}

					{notice && !processing && (
						<p className="text-sm text-muted-foreground" role="status">
							{notice}
						</p>
					)}

					{output && !processing && (
						<div className="space-y-4" data-testid="image-ocr-results">
							{blank ? (
								<div
									className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
									role="alert"
									data-testid="image-ocr-empty"
								>
									<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
									<p>{EMPTY_RESULT_MESSAGE}</p>
								</div>
							) : (
								<div
									className="flex items-start gap-2 rounded-lg border border-safety/30 bg-safety/10 p-3 text-sm"
									role="status"
									aria-live="polite"
								>
									<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-safety" />
									<p className="text-foreground">
										文字を読み取りました。元の画像と見比べて誤りを確認し、必要に応じて編集してからコピーまたは保存してください。
									</p>
								</div>
							)}
							{modelNote && (
								<p
									className="text-xs text-muted-foreground"
									role="status"
									data-testid="image-ocr-model-note"
								>
									{modelNote}
								</p>
							)}

							<div className="space-y-2">
								<Label htmlFor="image-ocr-output" className="text-sm">
									認識結果（編集できます）
								</Label>
								<Textarea
									id="image-ocr-output"
									data-testid="image-ocr-output"
									value={text}
									onChange={(e) =>
										setOutput({ ...output, text: e.target.value })
									}
									spellCheck={false}
									aria-invalid={outputError !== null}
									aria-describedby="image-ocr-output-status"
									className="field-sizing-fixed h-72 max-h-[60vh] overflow-auto break-words font-mono text-sm"
								/>
								<p
									className="text-xs text-muted-foreground"
									id="image-ocr-output-status"
									data-testid="image-ocr-count"
								>
									{characterCount.toLocaleString('ja-JP')}文字（上限:{' '}
									{MAX_OCR_TEXT_UNITS.toLocaleString('ja-JP')}文字相当）
								</p>
								{outputError && (
									<p
										className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
										role="alert"
									>
										{outputError}
									</p>
								)}
								<div className="flex flex-wrap items-center gap-2">
									<Button
										variant="outline"
										onClick={() => void handleCopy()}
										disabled={!canUseOutput}
										data-testid="image-ocr-copy"
									>
										<Copy className="h-4 w-4" />
										<span className="ml-1">すべてコピー</span>
									</Button>
									<Button
										onClick={handleSave}
										disabled={!canUseOutput}
										data-testid="image-ocr-save"
									>
										<Download className="h-4 w-4" />
										<span className="ml-1">TXTで保存</span>
									</Button>
									<span
										className="text-sm text-muted-foreground"
										role="status"
										aria-live="polite"
									>
										{copyStatus?.id === output.id
											? copyStatus.ok
												? 'コピーしました'
												: 'コピーに失敗しました。テキストを選択してコピーしてください'
											: ''}
									</span>
								</div>
								<p className="text-xs text-muted-foreground">
									保存形式はUTF-8（BOMなし）・改行はLFです。ファイル名は「
									{output.baseName}_ocr.txt」になります。
								</p>
							</div>
						</div>
					)}
				</>
			)}

			<p className="text-xs text-muted-foreground">
				PDF・SVG・HEIC・GIFやアニメーション画像、複数画像の一括処理、検索可能PDFの出力、翻訳には対応していません。HEIC画像は
				<a className="underline" href="/image-convert">
					画像形式変換
				</a>
				でJPEGやPNGにしてからお試しください。
			</p>
		</div>
	);
}
