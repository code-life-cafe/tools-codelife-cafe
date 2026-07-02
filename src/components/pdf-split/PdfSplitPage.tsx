// PdfSplitPage — PDF分割・ページ抽出ツールのオーケストレーター
// 範囲で分割 / ページ抽出 / 1ページずつ分割の3モードに対応する。
// すべてブラウザ内で処理し、PDFはサーバーに送信されない。

import { Download, Loader2, Package, Scissors } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { downloadBlob } from '@/lib/tools/image-common';
import {
	ENCRYPTED_PDF_MESSAGE,
	loadPdfInfo,
	parsePageRanges,
	singlePageRanges,
	splitPdf,
	validatePdfFile,
} from '@/lib/tools/pdf';
import { buildZip, dedupeZipNames } from '@/lib/tools/zip';
import { formatBytes } from '../pdf-merge/MergeFileList';

type SplitMode = 'range' | 'extract' | 'single';

type OutputFile = {
	blob: Blob;
	fileName: string;
	pageNumbers: number[];
};

export function PdfSplitPage() {
	const [file, setFile] = useState<File | null>(null);
	const [pageCount, setPageCount] = useState(0);
	const [loading, setLoading] = useState(false);
	const [mode, setMode] = useState<SplitMode>('range');
	const [rangeInput, setRangeInput] = useState('');
	const [extractInput, setExtractInput] = useState('');
	const [processing, setProcessing] = useState(false);
	const [progress, setProgress] = useState({ done: 0, total: 0 });
	const [error, setError] = useState<string | null>(null);
	const [outputs, setOutputs] = useState<OutputFile[]>([]);
	const [zipBlob, setZipBlob] = useState<Blob | null>(null);
	const [zipName, setZipName] = useState('');
	// 読み込み中に別ファイルが選択された場合、古い loadPdfInfo の結果で
	// 新しい選択を上書きしないためのリクエストトークン
	const loadIdRef = useRef(0);

	const baseName = useMemo(
		() => (file ? file.name.replace(/\.pdf$/i, '') : 'document'),
		[file],
	);

	// 入力中の範囲指定をリアルタイムにパースする（実行ボタンの活性制御にも使用）
	const rangeParse = useMemo(
		() => (pageCount > 0 ? parsePageRanges(rangeInput, pageCount) : null),
		[rangeInput, pageCount],
	);
	const extractParse = useMemo(
		() => (pageCount > 0 ? parsePageRanges(extractInput, pageCount) : null),
		[extractInput, pageCount],
	);

	const currentParse =
		mode === 'range' ? rangeParse : mode === 'extract' ? extractParse : null;
	const currentInput = mode === 'range' ? rangeInput : extractInput;
	// 未入力時はエラーを出さずボタンだけ無効にする
	const showParseErrors =
		currentParse !== null && !currentParse.ok && currentInput.trim() !== '';
	const canRun =
		!processing &&
		!loading &&
		file !== null &&
		pageCount > 0 &&
		(mode === 'single' || currentParse?.ok === true);

	const resetOutputs = useCallback(() => {
		setOutputs([]);
		setZipBlob(null);
		setZipName('');
	}, []);

	const handleFileSelect = useCallback(
		async (selected: File) => {
			const loadId = ++loadIdRef.current;
			setError(null);
			resetOutputs();
			setFile(null);
			setPageCount(0);

			const v = await validatePdfFile(selected);
			if (loadId !== loadIdRef.current) return;
			if (!v.ok || v.kind !== 'pdf') {
				setError(
					v.ok
						? 'PDFファイルを選択してください。'
						: `${selected.name}: ${v.message}`,
				);
				return;
			}
			setLoading(true);
			try {
				const bytes = new Uint8Array(await selected.arrayBuffer());
				const info = await loadPdfInfo(bytes);
				if (loadId !== loadIdRef.current) return;
				if (info.encrypted) {
					setError(`${selected.name}: ${ENCRYPTED_PDF_MESSAGE}`);
					return;
				}
				setFile(selected);
				setPageCount(info.pageCount);
			} catch {
				if (loadId !== loadIdRef.current) return;
				setError(
					`${selected.name}: PDFを読み込めませんでした。ファイルが破損している可能性があります。`,
				);
			} finally {
				if (loadId === loadIdRef.current) setLoading(false);
			}
		},
		[resetOutputs],
	);

	const handleClear = useCallback(() => {
		loadIdRef.current++;
		setLoading(false);
		setFile(null);
		setPageCount(0);
		setError(null);
		setRangeInput('');
		setExtractInput('');
		resetOutputs();
	}, [resetOutputs]);

	const handleRun = useCallback(async () => {
		if (!file || pageCount === 0) return;

		// モードごとの範囲リストを決定する（抽出は全ページを1つのPDFにまとめる）
		let ranges: number[][];
		if (mode === 'single') {
			ranges = singlePageRanges(pageCount);
		} else {
			const parsed = parsePageRanges(
				mode === 'range' ? rangeInput : extractInput,
				pageCount,
			);
			if (!parsed.ok) return;
			ranges = mode === 'extract' ? [parsed.ranges.flat()] : parsed.ranges;
		}

		setProcessing(true);
		setError(null);
		resetOutputs();
		setProgress({ done: 0, total: ranges.length });
		try {
			// bytes はこのスコープ内のみで保持し、処理完了後に参照を解放する
			const bytes = new Uint8Array(await file.arrayBuffer());
			const results = await splitPdf(bytes, ranges, baseName, (done, total) =>
				setProgress({ done, total }),
			);
			const files: OutputFile[] = results.map((r) => ({
				blob: new Blob([r.bytes as Uint8Array<ArrayBuffer>], {
					type: 'application/pdf',
				}),
				fileName: r.fileName,
				pageNumbers: r.pageNumbers,
			}));
			setOutputs(files);

			if (files.length === 1) {
				downloadBlob(files[0].blob, files[0].fileName);
			} else {
				const names = dedupeZipNames(files.map((f) => f.fileName));
				const zip = await buildZip(
					files.map((f, i) => ({ name: names[i], data: f.blob })),
				);
				const name = `${baseName}_split.zip`;
				setZipBlob(zip);
				setZipName(name);
				downloadBlob(zip, name);
			}
		} catch (err) {
			setError(
				err instanceof Error
					? `処理に失敗しました: ${err.message}`
					: '処理に失敗しました。',
			);
		} finally {
			setProcessing(false);
		}
	}, [file, pageCount, mode, rangeInput, extractInput, baseName, resetOutputs]);

	const runLabel =
		mode === 'range'
			? '分割してダウンロード'
			: mode === 'extract'
				? '抽出してダウンロード'
				: '1ページずつ分割してダウンロード';

	return (
		<div className="space-y-6">
			<FileDropzone
				onFileSelect={(f) => void handleFileSelect(f)}
				accept="application/pdf,.pdf"
				disabled={processing}
				label="PDFをドラッグ＆ドロップ"
				description="PDFファイル（1ファイル100MBまで）"
				privacyNote="PDFはサーバーに送信されません。すべてブラウザ内で処理されます。"
				inputAriaLabel="分割するPDFを選択"
				selectedFileName={file?.name ?? null}
				onClear={file ? handleClear : undefined}
				data-testid="pdf-split-input"
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
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin text-primary" />
					<span>PDFを読み込み中…</span>
				</div>
			)}

			{file && pageCount > 0 && (
				<>
					<p className="text-sm" data-testid="pdf-page-count">
						<span className="font-medium">{file.name}</span>
						<span className="ml-2 text-muted-foreground">
							全{pageCount}ページ・{formatBytes(file.size)}
						</span>
					</p>

					<Tabs
						value={mode}
						onValueChange={(value) => {
							setMode(value as SplitMode);
							resetOutputs();
						}}
					>
						<TabsList>
							<TabsTrigger value="range">範囲で分割</TabsTrigger>
							<TabsTrigger value="extract">ページ抽出</TabsTrigger>
							<TabsTrigger value="single">1ページずつ分割</TabsTrigger>
						</TabsList>
						<TabsContent value="range" className="space-y-2">
							<label
								className="text-sm text-muted-foreground"
								htmlFor="range-input"
							>
								分割する範囲をカンマ区切りで指定します。各範囲が個別のPDFになります。
							</label>
							<Input
								id="range-input"
								value={rangeInput}
								onChange={(e) => setRangeInput(e.target.value)}
								placeholder={`例: 1-3,4-${pageCount}`}
								disabled={processing}
								aria-label="分割範囲"
							/>
						</TabsContent>
						<TabsContent value="extract" className="space-y-2">
							<label
								className="text-sm text-muted-foreground"
								htmlFor="extract-input"
							>
								抽出するページを指定します。指定したページが1つのPDFにまとまります。
							</label>
							<Input
								id="extract-input"
								value={extractInput}
								onChange={(e) => setExtractInput(e.target.value)}
								placeholder="例: 2,4,6-8"
								disabled={processing}
								aria-label="抽出ページ"
							/>
						</TabsContent>
						<TabsContent value="single">
							<p className="text-sm text-muted-foreground">
								全{pageCount}
								ページを1ページずつの個別PDFに分割し、ZIPでまとめてダウンロードします。
							</p>
						</TabsContent>
					</Tabs>

					{showParseErrors && currentParse && !currentParse.ok && (
						<ul
							className="space-y-1 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
							role="alert"
							data-testid="range-errors"
						>
							{currentParse.errors.map((e) => (
								<li key={`${e.index}-${e.token}`}>
									{e.index + 1}文字目: {e.message}
								</li>
							))}
						</ul>
					)}

					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={() => void handleRun()} disabled={!canRun}>
							<Scissors className="h-4 w-4" />
							<span className="ml-1">{runLabel}</span>
						</Button>
					</div>

					{processing && (
						<div
							className="flex items-center gap-2 text-sm text-muted-foreground"
							aria-live="polite"
						>
							<Loader2 className="h-4 w-4 animate-spin text-primary" />
							<span>
								処理中… {progress.done} / {progress.total}
							</span>
						</div>
					)}

					{outputs.length > 0 && (
						<div className="space-y-2" data-testid="split-results">
							{zipBlob && (
								<Button
									variant="outline"
									onClick={() => downloadBlob(zipBlob, zipName)}
								>
									<Package className="h-4 w-4" />
									<span className="ml-1">ZIPでまとめてダウンロード</span>
								</Button>
							)}
							<ul className="space-y-2">
								{outputs.map((out) => (
									<li
										key={out.fileName}
										className="flex items-center gap-3 rounded-lg border border-border bg-card p-2 sm:p-3"
									>
										<div className="min-w-0 flex-1 text-sm">
											<p className="truncate font-medium" title={out.fileName}>
												{out.fileName}
											</p>
											<p className="text-xs text-muted-foreground">
												{out.pageNumbers.length}ページ・
												{formatBytes(out.blob.size)}
											</p>
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => downloadBlob(out.blob, out.fileName)}
											aria-label={`${out.fileName} をダウンロード`}
										>
											<Download className="h-4 w-4" />
											<span className="ml-1">ダウンロード</span>
										</Button>
									</li>
								))}
							</ul>
						</div>
					)}
				</>
			)}

			<p className="text-xs text-muted-foreground">
				このツールはページ番号指定の分割・抽出に特化しています。ページサムネイル、回転、OCR、パスワード解除には対応していません。
			</p>
		</div>
	);
}
