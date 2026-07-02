// FaviconGeneratorPage — ファビコン生成ツールのオーケストレーター
// 画像投入 → ライブプレビュー → favicon.zip ダウンロード ＋ HTMLスニペットコピー。
// すべてブラウザ内で処理し、画像はサーバーに送信されない。
// プレビューと出力（ZIP内アセット）は同一の generateFavicons から生成する（Preview=Export）。

import { Loader2, Package, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import {
	buildHtmlSnippet,
	FAVICON_ASSETS,
	type FaviconAsset,
	type FaviconOptions,
	type GeneratedFavicons,
	generateFavicons,
	loadImageSource,
	MAX_FAVICON_FILE_SIZE,
	type RasterSource,
	validateImageFile,
} from '@/lib/tools/favicon';
import { downloadBlob } from '@/lib/tools/image-common';
import { buildZip, type ZipEntry } from '@/lib/tools/zip';
import {
	DEFAULT_FAVICON_OPTIONS,
	FaviconOptionsPanel,
	type FaviconUiOptions,
} from './FaviconOptionsPanel';
import { FaviconPreview } from './FaviconPreview';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,.svg';

function toFaviconOptions(ui: FaviconUiOptions): FaviconOptions {
	return {
		fit: ui.fit,
		background: ui.transparent ? 'transparent' : ui.background,
		appName: ui.appName.trim() || 'My App',
		themeColor: ui.themeColor,
		backgroundColor: ui.backgroundColor,
	};
}

export function FaviconGeneratorPage() {
	const [source, setSource] = useState<RasterSource | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);
	const [options, setOptions] = useState<FaviconUiOptions>(
		DEFAULT_FAVICON_OPTIONS,
	);
	const [previewUrls, setPreviewUrls] = useState<Record<
		FaviconAsset,
		string
	> | null>(null);
	const [generated, setGenerated] = useState<GeneratedFavicons | null>(null);
	const [generating, setGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const sourceRef = useRef<RasterSource | null>(null);
	const previewUrlsRef = useRef<Record<FaviconAsset, string> | null>(null);
	const generatedRef = useRef<GeneratedFavicons | null>(null);
	const runIdRef = useRef(0);
	generatedRef.current = generated;

	const revokePreviewUrls = useCallback(() => {
		if (previewUrlsRef.current) {
			for (const url of Object.values(previewUrlsRef.current)) {
				URL.revokeObjectURL(url);
			}
			previewUrlsRef.current = null;
		}
	}, []);

	// アンマウント時に object URL とソースを解放する
	useEffect(() => {
		return () => {
			revokePreviewUrls();
			sourceRef.current?.dispose();
		};
	}, [revokePreviewUrls]);

	// source / options 変更時にプレビュー＝出力を再生成（デバウンスで連続変更を吸収）
	useEffect(() => {
		if (!source) return;
		const runId = ++runIdRef.current;
		setGenerating(true);
		const timer = setTimeout(async () => {
			try {
				const result = await generateFavicons(
					source,
					toFaviconOptions(options),
				);
				if (runIdRef.current !== runId) return;
				const urls = Object.fromEntries(
					FAVICON_ASSETS.map((asset) => [
						asset,
						URL.createObjectURL(result.pngs[asset]),
					]),
				) as Record<FaviconAsset, string>;
				revokePreviewUrls();
				previewUrlsRef.current = urls;
				setPreviewUrls(urls);
				setGenerated(result);
				setError(null);
			} catch (err) {
				if (runIdRef.current !== runId) return;
				// 失敗時は古い結果が残らないようクリアする（旧ZIPのDL防止）
				revokePreviewUrls();
				setPreviewUrls(null);
				setGenerated(null);
				setError(
					err instanceof Error
						? err.message
						: 'ファビコンの生成に失敗しました。',
				);
			} finally {
				if (runIdRef.current === runId) setGenerating(false);
			}
		}, 150);
		return () => clearTimeout(timer);
	}, [source, options, revokePreviewUrls]);

	const handleFile = useCallback(
		async (file: File) => {
			setError(null);
			const validation = await validateImageFile(file);
			if (!validation.ok) {
				setError(validation.message);
				return;
			}
			try {
				const next = await loadImageSource(file, validation.kind);
				sourceRef.current?.dispose();
				sourceRef.current = next;
				// 旧結果が新ソースの生成完了まで残らないよう先にクリアする
				revokePreviewUrls();
				setPreviewUrls(null);
				setGenerated(null);
				setFileName(file.name);
				setSource(next);
			} catch (err) {
				setError(
					err instanceof Error ? err.message : '画像の読み込みに失敗しました。',
				);
			}
		},
		[revokePreviewUrls],
	);

	const handleClear = useCallback(() => {
		runIdRef.current++;
		revokePreviewUrls();
		sourceRef.current?.dispose();
		sourceRef.current = null;
		setSource(null);
		setFileName(null);
		setPreviewUrls(null);
		setGenerated(null);
		setError(null);
		setGenerating(false);
	}, [revokePreviewUrls]);

	const handleDownloadZip = useCallback(async () => {
		const g = generatedRef.current;
		if (!g) return;
		const entries: ZipEntry[] = [
			{ name: 'favicon.ico', data: g.ico },
			...FAVICON_ASSETS.map((asset) => ({ name: asset, data: g.pngs[asset] })),
			{
				name: 'site.webmanifest',
				data: new TextEncoder().encode(g.webmanifest),
			},
		];
		const zip = await buildZip(entries);
		downloadBlob(zip, 'favicon.zip');
	}, []);

	const htmlSnippet = useMemo(
		() => buildHtmlSnippet({ themeColor: options.themeColor }),
		[options.themeColor],
	);

	return (
		<div className="space-y-6">
			<FileDropzone
				onFileSelect={(file) => void handleFile(file)}
				onValidationError={(message) => setError(message)}
				accept={ACCEPT}
				maxSizeBytes={MAX_FAVICON_FILE_SIZE}
				validationMessage="ファイルサイズが20MBを超えています。"
				selectedFileName={fileName}
				onClear={source ? handleClear : undefined}
				label="画像をドラッグ＆ドロップ"
				description="PNG / JPEG / WebP / SVG（最大20MB・正方形・512px以上を推奨）"
				privacyNote="画像はサーバーに送信されません。すべてブラウザ内で処理されます。"
				inputAriaLabel="ファビコンの元画像を選択"
				data-testid="favicon-input"
			/>

			{error && (
				<div
					className="whitespace-pre-line rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
					role="alert"
				>
					{error}
				</div>
			)}

			{source && (
				<>
					<FaviconOptionsPanel options={options} onChange={setOptions} />

					<FaviconPreview
						urls={previewUrls}
						appName={options.appName}
						themeColor={options.themeColor}
						transparent={options.transparent}
					/>

					<div className="flex flex-wrap items-center gap-2">
						<Button
							onClick={handleDownloadZip}
							disabled={generating || !generated}
						>
							<Package className="h-4 w-4" />
							<span className="ml-1">favicon.zip をダウンロード</span>
						</Button>
						{generating && (
							<span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
								<Loader2 className="h-4 w-4 animate-spin text-primary" />
								生成中…
							</span>
						)}
						<Button variant="ghost" onClick={handleClear} className="ml-auto">
							<Trash2 className="h-4 w-4" />
							<span className="ml-1">クリア</span>
						</Button>
					</div>

					{/* HTMLスニペット */}
					<div className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<span className="text-sm font-semibold">
								HTMLスニペット（&lt;head&gt; 内に貼り付け）
							</span>
							<CopyButton text={htmlSnippet} size="sm" label="HTMLをコピー" />
						</div>
						<pre
							className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed"
							data-testid="favicon-html-snippet"
						>
							<code>{htmlSnippet}</code>
						</pre>
					</div>

					<div className="space-y-1 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
						<p>
							ZIPには
							favicon.ico（16/32/48内包）・各サイズPNG・apple-touch-icon・Android/PWAアイコン・site.webmanifest
							を同梱します。
						</p>
						<p>
							favicon.ico は 16 / 32 / 48px
							を内包します。マスカブルアイコン・SVGファビコン（icon.svg）出力には対応していません。
						</p>
					</div>
				</>
			)}
		</div>
	);
}
