import {
	Download,
	ImageIcon,
	Loader2,
	RefreshCw,
	Scissors,
	Upload,
	Wand2,
	X,
	Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
	compositeBackground,
	type ModelMode,
	type ProgressInfo,
	preload,
	removeBackground,
	terminateWorker,
} from '@/lib/tools/bg-remove';

// --- 定数 ---
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

type Status = 'idle' | 'loading' | 'processing' | 'done' | 'error';

type BackgroundOption =
	| { type: 'transparent' }
	| { type: 'color'; value: string }
	| { type: 'image'; value: Blob };

// --- 市松模様 CSS ---
const checkerboardStyle: React.CSSProperties = {
	backgroundImage: `
		linear-gradient(45deg, var(--muted) 25%, transparent 25%),
		linear-gradient(-45deg, var(--muted) 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, var(--muted) 75%),
		linear-gradient(-45deg, transparent 75%, var(--muted) 75%)
	`,
	backgroundSize: '20px 20px',
	backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
};

// --- プリセット背景色 ---
const PRESET_COLORS = [
	'#ffffff',
	'#000000',
	'#ef4444',
	'#3b82f6',
	'#22c55e',
	'#f59e0b',
	'#8b5cf6',
	'#ec4899',
];

export default function BgRemove() {
	// --- 状態管理 ---
	const [status, setStatus] = useState<Status>('idle');
	const [mode, setMode] = useState<ModelMode>('high');
	const [progress, setProgress] = useState<ProgressInfo | null>(null);
	const [error, setError] = useState<string | null>(null);

	// 入力画像
	const [sourceFile, setSourceFile] = useState<File | null>(null);
	const [sourceUrl, setSourceUrl] = useState<string | null>(null);

	// 結果
	const [resultBlob, setResultBlob] = useState<Blob | null>(null);
	const [resultUrl, setResultUrl] = useState<string | null>(null);

	// 背景差し替え
	const [bgOption, setBgOption] = useState<BackgroundOption>({
		type: 'transparent',
	});
	const [compositeUrl, setCompositeUrl] = useState<string | null>(null);

	// D&D
	const [isDragOver, setIsDragOver] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const dropZoneRef = useRef<HTMLDivElement>(null);

	// --- 先行初期化 ---
	useEffect(() => {
		preload('high');
		return () => terminateWorker();
	}, []);

	// --- URL クリーンアップ ---
	useEffect(() => {
		return () => {
			if (sourceUrl) URL.revokeObjectURL(sourceUrl);
			if (resultUrl) URL.revokeObjectURL(resultUrl);
			if (compositeUrl) URL.revokeObjectURL(compositeUrl);
		};
	}, [sourceUrl, resultUrl, compositeUrl]);

	// --- ファイル検証 ---
	const validateFile = useCallback((file: File): string | null => {
		if (!ACCEPTED_TYPES.includes(file.type)) {
			return '対応形式: PNG、JPG、WEBP のみ';
		}
		if (file.size > MAX_FILE_SIZE) {
			return 'ファイルサイズは20MB以下にしてください';
		}
		return null;
	}, []);

	// --- 背景削除実行 ---
	const processImage = useCallback(
		async (file: File, selectedMode: ModelMode) => {
			setStatus('loading');
			setProgress(null);
			setError(null);

			// 既存の結果をクリア
			if (resultUrl) URL.revokeObjectURL(resultUrl);
			if (compositeUrl) URL.revokeObjectURL(compositeUrl);
			setResultBlob(null);
			setResultUrl(null);
			setCompositeUrl(null);
			setBgOption({ type: 'transparent' });

			try {
				const blob = await removeBackground(file, selectedMode, (info) => {
					setProgress(info);
					if (info.status === 'progress') {
						setStatus('loading');
					} else if (info.status === 'done' || info.status === 'ready') {
						setStatus('processing');
					}
				});

				const url = URL.createObjectURL(blob);
				setResultBlob(blob);
				setResultUrl(url);
				setStatus('done');
			} catch (err) {
				const message =
					err instanceof Error ? err.message : '背景削除に失敗しました';
				setError(message);
				setStatus('error');
			}
		},
		[resultUrl, compositeUrl],
	);

	// --- ファイル処理 ---
	const handleFile = useCallback(
		(file: File) => {
			const validationError = validateFile(file);
			if (validationError) {
				setError(validationError);
				setStatus('error');
				return;
			}

			// 既存のソース URL をクリア
			if (sourceUrl) URL.revokeObjectURL(sourceUrl);

			setSourceFile(file);
			setSourceUrl(URL.createObjectURL(file));
			setError(null);

			processImage(file, mode);
		},
		[validateFile, mode, processImage, sourceUrl],
	);

	// --- D&D ハンドラ ---
	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragOver(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragOver(false);
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setIsDragOver(false);

			const file = e.dataTransfer.files[0];
			if (file) handleFile(file);
		},
		[handleFile],
	);

	// --- クリップボード貼付 ---
	useEffect(() => {
		const handler = (e: ClipboardEvent) => {
			const items = e.clipboardData?.items;
			if (!items) return;

			for (const item of items) {
				if (item.type.startsWith('image/')) {
					const file = item.getAsFile();
					if (file) {
						e.preventDefault();
						handleFile(file);
						return;
					}
				}
			}
		};

		document.addEventListener('paste', handler);
		return () => document.removeEventListener('paste', handler);
	}, [handleFile]);

	// --- ファイル選択 ---
	const handleFileSelect = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) handleFile(file);
			// input をリセット（同じファイルの再選択を可能にする）
			e.target.value = '';
		},
		[handleFile],
	);

	// --- モード切替 ---
	const handleModeChange = useCallback(
		(checked: boolean) => {
			const newMode: ModelMode = checked ? 'high' : 'fast';
			setMode(newMode);

			// 結果がある場合は再処理
			if (sourceFile && status === 'done') {
				processImage(sourceFile, newMode);
			}
		},
		[sourceFile, status, processImage],
	);

	// --- 背景差し替え ---
	useEffect(() => {
		if (!resultBlob || bgOption.type === 'transparent') {
			if (compositeUrl) URL.revokeObjectURL(compositeUrl);
			setCompositeUrl(null);
			return;
		}

		let cancelled = false;
		compositeBackground(resultBlob, bgOption).then((blob) => {
			if (cancelled) return;
			if (compositeUrl) URL.revokeObjectURL(compositeUrl);
			setCompositeUrl(URL.createObjectURL(blob));
		});

		return () => {
			cancelled = true;
		};
	}, [resultBlob, bgOption, compositeUrl]);

	// --- ダウンロード ---
	const handleDownload = useCallback(() => {
		const url = compositeUrl ?? resultUrl;
		if (!url) return;

		const a = document.createElement('a');
		a.href = url;
		const baseName = sourceFile?.name?.replace(/\.[^.]+$/, '') ?? 'image';
		const suffix = bgOption.type === 'transparent' ? '_transparent' : '_bg';
		a.download = `${baseName}${suffix}.png`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}, [compositeUrl, resultUrl, sourceFile, bgOption]);

	// --- リセット ---
	const handleReset = useCallback(() => {
		if (sourceUrl) URL.revokeObjectURL(sourceUrl);
		if (resultUrl) URL.revokeObjectURL(resultUrl);
		if (compositeUrl) URL.revokeObjectURL(compositeUrl);

		setSourceFile(null);
		setSourceUrl(null);
		setResultBlob(null);
		setResultUrl(null);
		setCompositeUrl(null);
		setStatus('idle');
		setProgress(null);
		setError(null);
		setBgOption({ type: 'transparent' });
	}, [sourceUrl, resultUrl, compositeUrl]);

	// --- 背景画像アップロード ---
	const bgImageInputRef = useRef<HTMLInputElement>(null);
	const handleBgImageSelect = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) {
				setBgOption({ type: 'image', value: file });
			}
			e.target.value = '';
		},
		[],
	);

	// --- 進捗率の計算 ---
	const progressPercent =
		progress?.progress != null ? Math.round(progress.progress) : 0;

	// --- 表示する画像 URL ---
	const displayUrl = compositeUrl ?? resultUrl;

	return (
		<div className="space-y-6">
			{/* モード切替 */}
			<div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-2">
						<Zap className="h-4 w-4 text-amber-500" />
						<Label
							htmlFor="mode-switch"
							className="text-sm font-medium cursor-pointer"
						>
							{mode === 'fast' ? '⚡ 高速モード' : '✨ 高精度モード'}
						</Label>
					</div>
					<Switch
						id="mode-switch"
						checked={mode === 'high'}
						onCheckedChange={handleModeChange}
						disabled={status === 'loading' || status === 'processing'}
					/>
				</div>
				<div className="text-xs text-muted-foreground">
					{mode === 'fast' ? (
						<span>MODNet（人物特化・高速）≈ 25.9MB</span>
					) : (
						<span>BEN2（極めて高精度・アニメ対応）≈ 209MB</span>
					)}
				</div>
			</div>

			{/* エラー表示 */}
			{error && (
				<div className="flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
					<X className="h-4 w-4 shrink-0" />
					<span>{error}</span>
					<Button
						variant="ghost"
						size="sm"
						className="ml-auto"
						onClick={() => setError(null)}
					>
						閉じる
					</Button>
				</div>
			)}

			{/* ドロップゾーン / プレビュー */}
			{status === 'idle' && !sourceUrl ? (
				<button
					type="button"
					ref={dropZoneRef}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
					onClick={() => fileInputRef.current?.click()}
					className={`
						w-full relative flex flex-col items-center justify-center gap-4
						rounded-xl border-2 border-dashed p-12 cursor-pointer
						transition-all duration-200 bg-transparent
						${
							isDragOver
								? 'border-primary bg-primary/5 scale-[1.01]'
								: 'border-border hover:border-primary/50 hover:bg-muted/30'
						}
					`}
				>
					<div className="rounded-full bg-primary/10 p-4">
						<Upload className="h-8 w-8 text-primary" />
					</div>
					<div className="text-center">
						<p className="text-lg font-medium">画像をドラッグ＆ドロップ</p>
						<p className="mt-1 text-sm text-muted-foreground">
							またはクリックしてファイルを選択（PNG・JPG・WEBP、20MB以下）
						</p>
						<p className="mt-2 text-xs text-muted-foreground">
							Ctrl+V でクリップボードから貼り付けも可能
						</p>
					</div>
					<input
						ref={fileInputRef}
						type="file"
						accept={ACCEPTED_TYPES.join(',')}
						onChange={handleFileSelect}
						className="hidden"
					/>
				</button>
			) : (
				<div className="space-y-4">
					{/* 進捗バー */}
					{(status === 'loading' || status === 'processing') && (
						<div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm animate-in fade-in-50 duration-200">
							<div className="flex items-center gap-3 text-sm">
								<Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
								<div className="flex-1 min-w-0">
									<p className="font-semibold text-card-foreground">
										{status === 'loading'
											? 'AIモデルをロード中（初回のみダウンロード）...'
											: 'AI背景削除を実行中（ブラウザ内完全ローカル処理）...'}
									</p>
									<p className="text-xs text-muted-foreground mt-0.5">
										{status === 'loading'
											? `AIモデル（${mode === 'high' ? '高精度: 約209MB' : '人物特化高速: 約25.9MB'}）を準備しています。これには数十秒かかる場合があります。`
											: 'ダウンロードが完了しました。画像から背景を自動で切り抜いています。これには2〜5秒程度かかります。'}
									</p>
								</div>
								{status === 'loading' && progressPercent > 0 && (
									<span className="text-sm font-semibold text-primary shrink-0">
										{progressPercent}%
									</span>
								)}
							</div>

							{/* プログレスバー本体 */}
							<div className="h-2 w-full rounded-full bg-muted overflow-hidden relative">
								{status === 'loading' ? (
									<div
										className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
										style={{
											width: `${progressPercent}%`,
										}}
									/>
								) : (
									<div className="h-full rounded-full bg-primary animate-pulse w-full" />
								)}
							</div>

							{/* 詳細な進捗テキスト */}
							{progress && (
								<div className="flex flex-col gap-1 text-xs text-muted-foreground">
									{progress.loaded != null && progress.total != null && (
										<div className="flex justify-between font-mono">
											<span>進捗状況:</span>
											<span>
												{(progress.loaded / (1024 * 1024)).toFixed(1)} MB /{' '}
												{(progress.total / (1024 * 1024)).toFixed(1)} MB
											</span>
										</div>
									)}
									{progress.file && (
										<p className="truncate">
											読み込み中:{' '}
											<span className="font-mono">{progress.file}</span>
										</p>
									)}
								</div>
							)}
						</div>
					)}

					{/* プレビュー */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{/* 元画像 */}
						{sourceUrl && (
							<div className="space-y-2">
								<div className="flex items-center gap-2 text-sm font-medium">
									<ImageIcon className="h-4 w-4 text-muted-foreground" />
									<span>元の画像</span>
								</div>
								<div className="rounded-xl border border-border overflow-hidden bg-muted/30">
									<img
										src={sourceUrl}
										alt="元の画像"
										className="w-full h-auto max-h-[400px] object-contain"
									/>
								</div>
							</div>
						)}

						{/* 結果画像 */}
						{(displayUrl ||
							status === 'loading' ||
							status === 'processing') && (
							<div className="space-y-2">
								<div className="flex items-center gap-2 text-sm font-medium">
									<Scissors className="h-4 w-4 text-primary" />
									<span>背景削除後</span>
									{status === 'done' && (
										<Badge variant="outline" className="text-xs">
											完了
										</Badge>
									)}
								</div>
								<div
									className="rounded-xl border border-border overflow-hidden"
									style={
										bgOption.type === 'transparent'
											? checkerboardStyle
											: undefined
									}
								>
									{displayUrl ? (
										<img
											src={displayUrl}
											alt="背景削除後の画像"
											className="w-full h-auto max-h-[400px] object-contain"
										/>
									) : (
										<div className="flex items-center justify-center h-[200px]">
											<Loader2 className="h-8 w-8 animate-spin text-primary" />
										</div>
									)}
								</div>
							</div>
						)}
					</div>

					{/* 背景差し替えオプション（結果がある時のみ） */}
					{status === 'done' && resultBlob && (
						<div className="rounded-xl border border-border bg-card p-4 space-y-3">
							<p className="text-sm font-medium">背景を変更</p>
							<div className="flex flex-wrap items-center gap-2">
								{/* 透過 */}
								<button
									type="button"
									onClick={() => setBgOption({ type: 'transparent' })}
									className={`
										h-8 w-8 rounded-lg border-2 transition-all
										${bgOption.type === 'transparent' ? 'border-primary ring-2 ring-primary/30' : 'border-border'}
									`}
									style={checkerboardStyle}
									title="透過"
								/>
								{/* プリセット色 */}
								{PRESET_COLORS.map((color) => (
									<button
										key={color}
										type="button"
										onClick={() =>
											setBgOption({
												type: 'color',
												value: color,
											})
										}
										className={`
											h-8 w-8 rounded-lg border-2 transition-all
											${bgOption.type === 'color' && bgOption.value === color ? 'border-primary ring-2 ring-primary/30' : 'border-border'}
										`}
										style={{ backgroundColor: color }}
										title={color}
									/>
								))}
								{/* カスタム色 */}
								<label
									className="relative h-8 w-8 rounded-lg border-2 border-border overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
									title="カスタム色"
								>
									<input
										type="color"
										className="absolute inset-0 opacity-0 cursor-pointer"
										onChange={(e) =>
											setBgOption({
												type: 'color',
												value: e.target.value,
											})
										}
									/>
									<div className="w-full h-full bg-gradient-to-br from-red-500 via-green-500 to-blue-500" />
								</label>
								{/* 画像背景 */}
								<Button
									variant="outline"
									size="sm"
									className="h-8 text-xs"
									onClick={() => bgImageInputRef.current?.click()}
								>
									<ImageIcon className="h-3 w-3 mr-1" />
									画像
								</Button>
								<input
									ref={bgImageInputRef}
									type="file"
									accept="image/*"
									onChange={handleBgImageSelect}
									className="hidden"
								/>
							</div>
						</div>
					)}

					{/* アクションボタン */}
					{status === 'done' && (
						<div className="flex flex-wrap gap-3">
							<Button onClick={handleDownload} className="gap-2">
								<Download className="h-4 w-4" />
								PNGをダウンロード
							</Button>
							<Button variant="outline" onClick={handleReset} className="gap-2">
								<RefreshCw className="h-4 w-4" />
								別の画像を処理
							</Button>
						</div>
					)}

					{/* エラー時のリトライ */}
					{status === 'error' && (
						<div className="flex gap-3">
							{sourceFile && (
								<Button
									variant="outline"
									onClick={() => processImage(sourceFile, mode)}
									className="gap-2"
								>
									<RefreshCw className="h-4 w-4" />
									リトライ
								</Button>
							)}
							<Button variant="outline" onClick={handleReset} className="gap-2">
								<X className="h-4 w-4" />
								リセット
							</Button>
						</div>
					)}
				</div>
			)}

			{/* 注意事項 */}
			<div className="rounded-xl border border-border bg-card p-4 space-y-2">
				<div className="flex items-start gap-2 text-xs text-muted-foreground">
					<Wand2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
					<div className="space-y-1">
						<p>
							<strong>AI による背景削除</strong> — Transformers.js
							を使用してブラウザ内で完全に処理されます。
						</p>
						<p>
							初回はモデルのダウンロードが必要です（高精度モード:
							約209MB、高速モード〈人物特化〉: 約25.9MB）。
							2回目以降はキャッシュされ即座に処理できます。
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
