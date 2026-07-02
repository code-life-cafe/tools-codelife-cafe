import {
	Download,
	ImageUp,
	Loader2,
	Lock,
	Sparkles,
	TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { downloadBlob } from '@/lib/download';
import {
	buildUpscaledFilename,
	computeOutputDimensions,
	isWebGPUAvailable,
	MAX_FILE_SIZE,
	type OutputFormat,
	type ProgressInfo,
	type QualityMode,
	type Scale,
	terminateWorker,
	upscaleImage,
	validateImageFile,
	validateResolution,
} from '@/lib/tools/upscale';

type Status = 'idle' | 'loading' | 'processing' | 'done' | 'error';

const ACCEPT = 'image/png,image/jpeg,image/webp';

export function UpscalePage() {
	const [sourceFile, setSourceFile] = useState<File | null>(null);
	const [sourceUrl, setSourceUrl] = useState<string | null>(null);
	const [sourceDims, setSourceDims] = useState<{ w: number; h: number } | null>(
		null,
	);
	const [resultUrl, setResultUrl] = useState<string | null>(null);
	const [resultBlob, setResultBlob] = useState<Blob | null>(null);

	const [status, setStatus] = useState<Status>('idle');
	const [progress, setProgress] = useState<ProgressInfo | null>(null);
	const [error, setError] = useState<string | null>(null);

	const [scale, setScale] = useState<Scale>(4);
	const [denoise, setDenoise] = useState(true);
	const [output, setOutput] = useState<OutputFormat>('png');
	const [quality, setQuality] = useState<QualityMode>('fast');

	const [webgpu, setWebgpu] = useState<boolean | null>(null);
	const [compare, setCompare] = useState(50);

	// クリーンアップ用に object URL を保持
	const urlsRef = useRef<string[]>([]);
	const trackUrl = useCallback((url: string) => {
		urlsRef.current.push(url);
		return url;
	}, []);

	useEffect(() => {
		isWebGPUAvailable().then(setWebgpu);
		return () => {
			for (const u of urlsRef.current) URL.revokeObjectURL(u);
			terminateWorker();
		};
	}, []);

	const resetResult = useCallback(() => {
		setResultUrl(null);
		setResultBlob(null);
		setStatus('idle');
		setProgress(null);
		setCompare(50);
	}, []);

	const handleSelect = useCallback(
		async (file: File) => {
			setError(null);
			const v = validateImageFile(file);
			if (!v.ok) {
				setError(v.message);
				return;
			}
			// 解像度を事前チェック
			const url = trackUrl(URL.createObjectURL(file));
			const img = new Image();
			img.src = url;
			try {
				await img.decode();
			} catch {
				setError('画像の読み込みに失敗しました。');
				return;
			}
			const res = validateResolution(img.naturalWidth, img.naturalHeight);
			if (!res.ok) {
				setError(res.message);
				return;
			}
			resetResult();
			setSourceFile(file);
			setSourceUrl(url);
			setSourceDims({ w: img.naturalWidth, h: img.naturalHeight });
		},
		[resetResult, trackUrl],
	);

	const handleClear = useCallback(() => {
		setSourceFile(null);
		setSourceUrl(null);
		setSourceDims(null);
		setError(null);
		resetResult();
	}, [resetResult]);

	const run = useCallback(async () => {
		if (!sourceFile) return;
		setError(null);
		setStatus('loading');
		setProgress({ status: 'loading', progress: 0 });
		try {
			const blob = await upscaleImage(
				sourceFile,
				{ scale, denoise, output, quality },
				(info) => {
					setStatus(info.status === 'loading' ? 'loading' : 'processing');
					setProgress(info);
				},
			);
			const url = trackUrl(URL.createObjectURL(blob));
			setResultBlob(blob);
			setResultUrl(url);
			setStatus('done');
		} catch (err) {
			setError(err instanceof Error ? err.message : '処理に失敗しました。');
			setStatus('error');
		}
	}, [sourceFile, scale, denoise, output, quality, trackUrl]);

	const handleDownload = useCallback(() => {
		if (!resultBlob || !sourceFile) return;
		downloadBlob(
			resultBlob,
			buildUpscaledFilename(sourceFile.name, scale, output),
		);
	}, [resultBlob, sourceFile, scale, output]);

	const busy = status === 'loading' || status === 'processing';
	const outDims = sourceDims
		? computeOutputDimensions(sourceDims.w, sourceDims.h, scale)
		: null;
	const maxNeedsWarning = quality === 'max' && webgpu === false;

	return (
		<div className="space-y-6">
			{/* プライバシー注記 */}
			<p className="flex items-center gap-1 text-sm text-muted-foreground">
				<Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
				画像はサーバーに送信されません。すべてブラウザ内で処理されます。
			</p>

			{/* 入力 */}
			{!sourceFile ? (
				<FileDropzone
					onFileSelect={handleSelect}
					onValidationError={setError}
					accept={ACCEPT}
					maxSizeBytes={MAX_FILE_SIZE}
					validationMessage="ファイルサイズが20MBを超えています。"
					label="画像をドラッグ＆ドロップ"
					description="またはクリックして選択（PNG / JPEG / WebP・長辺2000pxまで）"
					inputAriaLabel="画像を選択"
					data-testid="upscale-file-input"
				/>
			) : (
				<div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
					<span className="truncate font-mono" title={sourceFile.name}>
						{sourceFile.name}
						{sourceDims && (
							<span className="ml-2 text-muted-foreground">
								{sourceDims.w}×{sourceDims.h}
							</span>
						)}
					</span>
					<Button
						variant="ghost"
						size="sm"
						onClick={handleClear}
						disabled={busy}
					>
						別の画像
					</Button>
				</div>
			)}

			{error && (
				<Alert variant="destructive">
					<TriangleAlert />
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{sourceFile && (
				<>
					{/* コントロール */}
					<div className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
						{/* 品質 */}
						<div className="space-y-2">
							<Label>品質モデル</Label>
							<div className="flex gap-2">
								<Button
									type="button"
									variant={quality === 'fast' ? 'default' : 'outline'}
									size="sm"
									onClick={() => {
										setQuality('fast');
										resetResult();
									}}
									disabled={busy}
								>
									高速（全端末）
								</Button>
								<Button
									type="button"
									variant={quality === 'max' ? 'default' : 'outline'}
									size="sm"
									onClick={() => {
										setQuality('max');
										resetResult();
									}}
									disabled={busy}
								>
									<Sparkles className="h-3.5 w-3.5" />
									最高品質
								</Button>
							</div>
						</div>

						{/* 倍率 */}
						<div className="space-y-2">
							<Label>拡大倍率</Label>
							<div className="flex gap-2">
								{([2, 4] as Scale[]).map((s) => (
									<Button
										key={s}
										type="button"
										variant={scale === s ? 'default' : 'outline'}
										size="sm"
										onClick={() => {
											setScale(s);
											resetResult();
										}}
										disabled={busy}
										aria-label={`${s}倍`}
									>
										{s}倍
									</Button>
								))}
							</div>
						</div>

						{/* ノイズ除去 */}
						<div className="flex items-center justify-between">
							<Label htmlFor="denoise-switch">ノイズ除去</Label>
							<Switch
								id="denoise-switch"
								checked={denoise}
								onCheckedChange={(c) => {
									setDenoise(c);
									resetResult();
								}}
								disabled={busy}
								aria-label="ノイズ除去"
							/>
						</div>

						{/* 出力形式 */}
						<div className="flex items-center justify-between gap-2">
							<Label htmlFor="output-format">出力形式</Label>
							<Select
								value={output}
								onValueChange={(v) => {
									setOutput(v as OutputFormat);
									resetResult();
								}}
								disabled={busy}
							>
								<SelectTrigger
									id="output-format"
									className="w-28"
									aria-label="出力形式"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="png">PNG</SelectItem>
									<SelectItem value="webp">WebP</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					{/* 処理前の注意 */}
					<Alert>
						<TriangleAlert />
						<AlertDescription>
							<span>
								AI処理は端末内で行われます。画像サイズ・端末性能により
								<strong>数秒〜数十秒</strong>かかり、メモリを多く使用します。
								モバイルや低スペック端末では時間がかかる場合があります。
								{outDims && (
									<>
										{' '}
										出力予定サイズ:{' '}
										<strong>
											{outDims.width}×{outDims.height}
										</strong>
									</>
								)}
							</span>
							{maxNeedsWarning && (
								<span className="mt-1 flex items-center gap-1 text-destructive">
									<TriangleAlert
										className="h-3.5 w-3.5 shrink-0"
										aria-hidden="true"
									/>
									「最高品質」はWebGPU非対応の本端末では非常に低速です。「高速」を推奨します。
								</span>
							)}
						</AlertDescription>
					</Alert>

					{/* 実行 / 再処理 */}
					<div className="flex flex-wrap gap-2">
						<Button onClick={run} disabled={busy} data-testid="upscale-run">
							{busy ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<ImageUp className="h-4 w-4" />
							)}
							{status === 'done' ? 'この設定で再処理' : 'アップスケール実行'}
						</Button>
						{status === 'done' && resultUrl && (
							<Button
								variant="secondary"
								onClick={handleDownload}
								data-testid="upscale-download"
							>
								<Download className="h-4 w-4" />
								ダウンロード
							</Button>
						)}
					</div>

					{/* 進捗 */}
					{busy && progress && (
						<div className="space-y-2" data-testid="upscale-progress">
							<div className="flex justify-between text-xs text-muted-foreground">
								<span>
									{progress.status === 'loading'
										? 'モデルを読み込み中…'
										: progress.tile
											? `処理中… タイル ${progress.tile.done}/${progress.tile.total}`
											: '処理中…'}
								</span>
								<span>{Math.round(progress.progress * 100)}%</span>
							</div>
							<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
								<div
									className="h-full bg-primary transition-[width] duration-200"
									style={{ width: `${Math.round(progress.progress * 100)}%` }}
								/>
							</div>
						</div>
					)}

					{/* before/after 比較 */}
					{status === 'done' && resultUrl && sourceUrl && (
						<div className="space-y-3" data-testid="upscale-result">
							<div className="relative w-full select-none overflow-hidden rounded-xl border border-border bg-[repeating-conic-gradient(#0001_0_25%,transparent_0_50%)] bg-[length:20px_20px]">
								{/* after（下層・拡大結果） */}
								<img
									src={resultUrl}
									alt="アップスケール結果"
									className="block w-full"
								/>
								{/* before（上層・clip-pathで左側のみ表示） */}
								<img
									src={sourceUrl}
									alt="元画像"
									className="absolute inset-0 block h-full w-full"
									style={{ clipPath: `inset(0 ${100 - compare}% 0 0)` }}
								/>
								{/* 仕切り線 */}
								<div
									className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary"
									style={{ left: `${compare}%` }}
								/>
								<span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
									元画像
								</span>
								<span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
									拡大後
								</span>
							</div>
							<input
								type="range"
								min={0}
								max={100}
								value={compare}
								onChange={(e) => setCompare(Number(e.target.value))}
								aria-label="比較スライダー"
								className="w-full"
							/>
							{outDims && (
								<p className="text-center text-xs text-muted-foreground">
									{outDims.width}×{outDims.height} に拡大しました
								</p>
							)}
						</div>
					)}
				</>
			)}
		</div>
	);
}

export default UpscalePage;
