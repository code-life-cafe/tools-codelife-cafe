import {
	AlertTriangle,
	Download,
	FileImage,
	ImageIcon,
	Loader2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	buildSnippet,
	dataUriToBlob,
	estimateSize,
	fileToDataUri,
	formatBytes,
	type SnippetKind,
	validateImageFile,
} from '@/lib/tools/image-base64';
import { downloadBlob } from '@/lib/tools/image-common';

type Mode = 'encode' | 'decode';

const ACCEPT =
	'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg';
const MAX_SIZE = 10 * 1024 * 1024;

const SNIPPET_KINDS: { kind: SnippetKind; label: string }[] = [
	{ kind: 'data-uri', label: 'Data URI' },
	{ kind: 'raw-base64', label: 'Base64' },
	{ kind: 'img', label: '<img> タグ' },
	{ kind: 'css-bg', label: 'CSS background' },
];

const PREVIEW_LENGTH = 120;

function truncate(s: string): string {
	return s.length > PREVIEW_LENGTH ? `${s.slice(0, PREVIEW_LENGTH)}…` : s;
}

export function ImageBase64Page() {
	const { trackRun } = useToolAnalytics('image-base64');
	const [mode, setMode] = useState<Mode>('encode');

	const [file, setFile] = useState<File | null>(null);
	const [dataUri, setDataUri] = useState<string | null>(null);
	const [converting, setConverting] = useState(false);
	const [encodeError, setEncodeError] = useState<string | null>(null);

	const [decodeInput, setDecodeInput] = useState('');
	const [decodedUrl, setDecodedUrl] = useState<string | null>(null);
	const [decodedMime, setDecodedMime] = useState<string | null>(null);
	const [decodedExt, setDecodedExt] = useState<string | null>(null);
	const [decodedBlob, setDecodedBlob] = useState<Blob | null>(null);
	const [decodeError, setDecodeError] = useState<string | null>(null);

	const decodedUrlRef = useRef<string | null>(null);

	const handleModeChange = useCallback((v: string) => {
		setMode(v as Mode);
		setEncodeError(null);
		setDecodeError(null);
	}, []);

	// --- Encode ---

	const handleFileSelect = useCallback(
		async (f: File) => {
			const validation = validateImageFile(f);
			if (!validation.ok) {
				setEncodeError(validation.message);
				return;
			}
			setFile(f);
			setEncodeError(null);
			setConverting(true);
			try {
				const uri = await fileToDataUri(f);
				setDataUri(uri);
				// 画像→Base64 変換成功の分析計測
				trackRun();
			} catch (err) {
				setEncodeError(
					err instanceof Error ? err.message : '変換に失敗しました。',
				);
			} finally {
				setConverting(false);
			}
		},
		[trackRun],
	);

	const handleClearFile = useCallback(() => {
		setFile(null);
		setDataUri(null);
		setEncodeError(null);
	}, []);

	const snippets = useMemo(() => {
		if (!dataUri) return null;
		return SNIPPET_KINDS.map(({ kind, label }) => ({
			kind,
			label,
			full: buildSnippet(dataUri, kind),
		}));
	}, [dataUri]);

	const sizeInfo = useMemo(() => {
		if (!dataUri) return null;
		return estimateSize(dataUri);
	}, [dataUri]);

	// --- Decode ---

	useEffect(() => {
		if (mode !== 'decode' || decodeInput.trim() === '') {
			if (decodedUrlRef.current) {
				URL.revokeObjectURL(decodedUrlRef.current);
				decodedUrlRef.current = null;
			}
			setDecodedUrl(null);
			setDecodedMime(null);
			setDecodedExt(null);
			setDecodedBlob(null);
			setDecodeError(null);
			return;
		}

		const timer = setTimeout(() => {
			try {
				const { blob, mime, ext } = dataUriToBlob(decodeInput);
				if (decodedUrlRef.current) {
					URL.revokeObjectURL(decodedUrlRef.current);
				}
				const url = URL.createObjectURL(blob);
				decodedUrlRef.current = url;
				setDecodedUrl(url);
				setDecodedMime(mime);
				setDecodedExt(ext);
				setDecodedBlob(blob);
				setDecodeError(null);
				// Base64→画像 デコード成功の分析計測
				trackRun();
			} catch (err) {
				if (decodedUrlRef.current) {
					URL.revokeObjectURL(decodedUrlRef.current);
					decodedUrlRef.current = null;
				}
				setDecodedUrl(null);
				setDecodedMime(null);
				setDecodedExt(null);
				setDecodedBlob(null);
				setDecodeError(
					err instanceof Error ? err.message : 'デコードに失敗しました。',
				);
			}
		}, 300);

		return () => clearTimeout(timer);
	}, [mode, decodeInput, trackRun]);

	useEffect(() => {
		return () => {
			if (decodedUrlRef.current) {
				URL.revokeObjectURL(decodedUrlRef.current);
			}
		};
	}, []);

	const handleDownload = useCallback(() => {
		if (decodedBlob && decodedExt) {
			downloadBlob(decodedBlob, `decoded.${decodedExt}`);
		}
	}, [decodedBlob, decodedExt]);

	return (
		<Tabs value={mode} onValueChange={handleModeChange}>
			<TabsList className="w-full grid grid-cols-2">
				<TabsTrigger value="encode" data-testid="tab-encode">
					<FileImage className="h-4 w-4 mr-1" />
					画像 → Base64
				</TabsTrigger>
				<TabsTrigger value="decode" data-testid="tab-decode">
					<ImageIcon className="h-4 w-4 mr-1" />
					Base64 → 画像
				</TabsTrigger>
			</TabsList>

			{/* === Encode Tab === */}
			<TabsContent value="encode" className="mt-4 space-y-4">
				<FileDropzone
					onFileSelect={handleFileSelect}
					onValidationError={setEncodeError}
					accept={ACCEPT}
					maxSizeBytes={MAX_SIZE}
					validationMessage="ファイルサイズが10MBを超えています。"
					label="画像をドラッグ＆ドロップ"
					description="PNG / JPEG / WebP / GIF / SVG（最大10MB）"
					privacyNote="画像はサーバーに送信されません。すべてブラウザ内で処理されます。"
					selectedFileName={file?.name ?? null}
					onClear={handleClearFile}
					disabled={converting}
					inputAriaLabel="Base64変換する画像を選択"
					data-testid="encode-file-input"
				/>

				{encodeError && (
					<div
						className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
						role="alert"
					>
						{encodeError}
					</div>
				)}

				{converting && (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin text-primary" />
						<span>変換中…</span>
					</div>
				)}

				{sizeInfo && (
					<div className="flex flex-wrap gap-3 text-sm">
						<span className="rounded-md bg-muted px-2 py-1">
							元サイズ: {formatBytes(sizeInfo.originalBytes)}
						</span>
						<span className="rounded-md bg-muted px-2 py-1">
							Base64: {formatBytes(sizeInfo.base64TextBytes)}
						</span>
						<span className="rounded-md bg-muted px-2 py-1">
							肥大率: +{sizeInfo.inflationPct}%
						</span>
					</div>
				)}

				{sizeInfo && sizeInfo.inflationPct > 0 && (
					<div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-muted-foreground">
						<AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
						<span>
							Data
							URIは元サイズより約33%大きくなります。大きな画像のインライン化は非推奨です。
						</span>
					</div>
				)}

				{snippets && (
					<div className="space-y-3" data-testid="snippet-results">
						<h2 className="text-sm font-semibold">変換結果</h2>
						{snippets.map(({ kind, label, full }) => (
							<div
								key={kind}
								className="rounded-lg border border-border p-3"
								data-testid={`snippet-${kind}`}
							>
								<div className="flex items-center justify-between gap-2 mb-2">
									<span className="text-xs font-semibold text-muted-foreground">
										{label}
									</span>
									<CopyButton text={full} size="sm" variant="ghost" />
								</div>
								<p className="font-mono text-xs break-all text-muted-foreground max-h-20 overflow-hidden">
									{truncate(full)}
								</p>
							</div>
						))}
					</div>
				)}
			</TabsContent>

			{/* === Decode Tab === */}
			<TabsContent value="decode" className="mt-4 space-y-4">
				<div className="space-y-2">
					<label htmlFor="decode-input" className="text-sm font-medium">
						Base64 / Data URI を貼り付け
					</label>
					<Textarea
						id="decode-input"
						value={decodeInput}
						onChange={(e) => setDecodeInput(e.target.value)}
						placeholder="data:image/png;base64,iVBORw0KGgo... または Base64 文字列"
						rows={5}
						className="font-mono text-xs"
						data-testid="decode-input"
					/>
				</div>

				{decodeError && (
					<div
						className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
						role="alert"
						data-testid="decode-error"
					>
						{decodeError}
					</div>
				)}

				{decodedUrl && (
					<div className="space-y-3" data-testid="decode-result">
						<h2 className="text-sm font-semibold">プレビュー</h2>
						<div className="rounded-lg border border-border p-4 flex items-center justify-center bg-[repeating-conic-gradient(var(--color-muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
							<img
								src={decodedUrl}
								alt="デコード結果"
								className="max-w-full max-h-64 object-contain"
								data-testid="decode-preview"
							/>
						</div>
						<div className="flex items-center gap-3">
							{decodedMime && (
								<span className="text-xs text-muted-foreground rounded-md bg-muted px-2 py-1">
									{decodedMime}
								</span>
							)}
							{decodedBlob && (
								<span className="text-xs text-muted-foreground rounded-md bg-muted px-2 py-1">
									{formatBytes(decodedBlob.size)}
								</span>
							)}
							<Button
								size="sm"
								variant="outline"
								onClick={handleDownload}
								data-testid="decode-download"
							>
								<Download className="h-4 w-4" />
								<span className="ml-1">ダウンロード</span>
							</Button>
						</div>
					</div>
				)}
			</TabsContent>
		</Tabs>
	);
}
