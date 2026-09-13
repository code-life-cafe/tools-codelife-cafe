import {
	AlertTriangle,
	Check,
	ChevronDown,
	ChevronRight,
	Download,
	Expand,
	Eye,
	FileCode,
	Maximize2,
	Minimize2,
	RotateCcw,
	Share2,
	Shrink,
	Sparkles,
	Trash2,
	Wand2,
	ZoomIn,
	ZoomOut,
} from 'lucide-react';
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { downloadBlob } from '@/lib/download';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import {
	exportSvgToPng,
	MONO_THEME_VARIABLES,
	renderMermaidSvg,
	SAMPLE_MERMAID_CODES,
} from '@/lib/tools/mermaid';
import {
	type MermaidRepairResult,
	repairMermaidCode,
} from '@/lib/tools/mermaid-repair';
import { useCopyFeedback } from '@/lib/useCopyFeedback';
import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 250;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.2;
const WHEEL_ZOOM_FACTOR = 0.1;

interface MermaidSettings extends Record<string, unknown> {
	autoRepair: boolean;
	theme: 'mono' | 'default' | 'dark' | 'forest';
	isExpanded: boolean;
}

const DEFAULT_SETTINGS: MermaidSettings = {
	autoRepair: true,
	// デフォルトはモノクロ配色とし、サイトのライト/ダークモードに追従させる
	theme: 'mono',
	// プレビューの視認性を優先し、フルサイズ表示をデフォルトにする
	isExpanded: true,
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * サイトのライト/ダークモード（html要素の`dark`クラス）を検知するフック
 */
function useSiteDarkMode(): boolean {
	const [isDark, setIsDark] = useState<boolean>(false);

	useEffect(() => {
		const update = () => {
			setIsDark(document.documentElement.classList.contains('dark'));
		};
		update();

		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.attributeName === 'class') {
					update();
				}
			}
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class'],
		});

		return () => observer.disconnect();
	}, []);

	return isDark;
}

export function MermaidPreviewPage() {
	const containerId = useId().replace(/:/g, '_');
	const { trackRunDebounced, trackSharedUrlOpen } = useToolAnalytics('mermaid');
	const [settings, updateSettings, generateShareUrl] =
		useToolSettings<MermaidSettings>('mermaid', DEFAULT_SETTINGS);
	const { state: shareState, copy: copyShareUrl } = useCopyFeedback();
	const isCopied = shareState === 'copied';

	const [input, setInput] = useState<string>(
		SAMPLE_MERMAID_CODES.flowchart.code,
	);
	const [svgHtml, setSvgHtml] = useState<string>('');
	const [renderError, setRenderError] = useState<string | null>(null);
	const [zoom, setZoom] = useState<number>(1);
	const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
	const [isPanning, setIsPanning] = useState<boolean>(false);
	const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
	const [mobileTab, setMobileTab] = useState<'editor' | 'preview'>('editor');
	const [showChangesDetail, setShowChangesDetail] = useState<boolean>(false);
	const [isRendering, setIsRendering] = useState<boolean>(false);

	const previewContainerRef = useRef<HTMLDivElement>(null);
	const previewColumnRef = useRef<HTMLDivElement>(null);
	const panStartRef = useRef<{
		x: number;
		y: number;
		panX: number;
		panY: number;
	}>({
		x: 0,
		y: 0,
		panX: 0,
		panY: 0,
	});

	const isSiteDark = useSiteDarkMode();

	// URLクエリパラメータから設定共有URLが開かれたかを検知して追跡
	useEffect(() => {
		if (
			typeof window !== 'undefined' &&
			window.location.search.includes('settings=')
		) {
			trackSharedUrlOpen();
		}
	}, [trackSharedUrlOpen]);

	// 自動修復の適用
	const repairResult: MermaidRepairResult = useMemo(() => {
		if (!settings.autoRepair) {
			return {
				originalCode: input,
				repairedCode: input,
				isModified: false,
				changes: [],
			};
		}
		return repairMermaidCode(input);
	}, [input, settings.autoRepair]);

	const effectiveCode = repairResult.repairedCode;

	// モノクロテーマはサイトのライト/ダークモードに追従させるため 'base' テーマへ切り替える
	const mermaidTheme = settings.theme === 'mono' ? 'base' : settings.theme;
	const mermaidThemeVariables =
		settings.theme === 'mono'
			? isSiteDark
				? MONO_THEME_VARIABLES.dark
				: MONO_THEME_VARIABLES.light
			: undefined;

	// レンダリング実行
	useEffect(() => {
		if (!effectiveCode.trim()) {
			setSvgHtml('');
			setRenderError(null);
			return;
		}

		let cancelled = false;
		setIsRendering(true);

		const timer = setTimeout(async () => {
			try {
				const result = await renderMermaidSvg(
					effectiveCode,
					containerId,
					mermaidTheme,
					mermaidThemeVariables,
				);
				if (cancelled) return;
				setSvgHtml(result.svg);
				setRenderError(null);
				trackRunDebounced();
			} catch (err: unknown) {
				if (cancelled) return;
				const message =
					err instanceof Error ? err.message : '構文エラーが発生しました。';
				setRenderError(message);
			} finally {
				if (!cancelled) {
					setIsRendering(false);
				}
			}
		}, DEBOUNCE_MS);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [
		effectiveCode,
		containerId,
		mermaidTheme,
		mermaidThemeVariables,
		trackRunDebounced,
	]);

	// SVGエクスポート
	const handleDownloadSvg = useCallback(() => {
		if (!svgHtml) return;
		const blob = new Blob([svgHtml], { type: 'image/svg+xml;charset=utf-8' });
		downloadBlob(blob, 'mermaid-diagram.svg');
	}, [svgHtml]);

	// PNGエクスポート
	const handleDownloadPng = useCallback(async () => {
		if (!previewContainerRef.current) return;
		const svgEl = previewContainerRef.current.querySelector('svg');
		if (!svgEl) return;

		try {
			const blob = await exportSvgToPng(svgEl, 2);
			downloadBlob(blob, 'mermaid-diagram.png');
		} catch {
			alert('PNG画像の書き出しに失敗しました。');
		}
	}, []);

	// サンプル読み込み
	const handleSelectSample = (sampleKey: string) => {
		const sample = SAMPLE_MERMAID_CODES[sampleKey];
		if (sample) {
			setInput(sample.code);
			setZoom(1);
			setPan({ x: 0, y: 0 });
		}
	};

	// 修復結果を入力に明示反映
	const handleApplyRepairToInput = () => {
		if (repairResult.isModified) {
			setInput(repairResult.repairedCode);
		}
	};

	// 倍率・位置のリセット
	const handleResetView = useCallback(() => {
		setZoom(1);
		setPan({ x: 0, y: 0 });
	}, []);

	// マウスドラッグによるプレビューの移動（MermaidLiveEditor同様のパン操作）
	const handlePreviewMouseDown = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (!svgHtml || e.button !== 0) return;
			e.preventDefault();
			setIsPanning(true);
			panStartRef.current = {
				x: e.clientX,
				y: e.clientY,
				panX: pan.x,
				panY: pan.y,
			};
		},
		[svgHtml, pan],
	);

	const handlePreviewMouseMove = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (!isPanning) return;
			const dx = e.clientX - panStartRef.current.x;
			const dy = e.clientY - panStartRef.current.y;
			setPan({
				x: panStartRef.current.panX + dx,
				y: panStartRef.current.panY + dy,
			});
		},
		[isPanning],
	);

	const handlePreviewMouseUp = useCallback(() => {
		setIsPanning(false);
	}, []);

	// マウスホイールによる拡大縮小（ページスクロールを防ぐためネイティブリスナーで登録）
	useEffect(() => {
		const container = previewContainerRef.current;
		if (!container) return;

		const handleWheel = (e: WheelEvent) => {
			if (!svgHtml) return;
			e.preventDefault();
			const factor =
				e.deltaY < 0 ? 1 + WHEEL_ZOOM_FACTOR : 1 - WHEEL_ZOOM_FACTOR;
			setZoom((prev) => clamp(prev * factor, MIN_ZOOM, MAX_ZOOM));
		};

		container.addEventListener('wheel', handleWheel, { passive: false });
		return () => container.removeEventListener('wheel', handleWheel);
	}, [svgHtml]);

	// フルスクリーン状態の同期
	useEffect(() => {
		const handleFullscreenChange = () => {
			setIsFullscreen(document.fullscreenElement === previewColumnRef.current);
		};
		document.addEventListener('fullscreenchange', handleFullscreenChange);
		return () =>
			document.removeEventListener('fullscreenchange', handleFullscreenChange);
	}, []);

	const toggleFullscreen = useCallback(async () => {
		if (!previewColumnRef.current) return;
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
			} else {
				await previewColumnRef.current.requestFullscreen();
			}
		} catch {
			// フルスクリーンAPI非対応環境では何もしない
		}
	}, []);

	// フルサイズモード切替時にツールレイアウトの最大幅を調整する
	const applyLayoutWidth = useCallback((expanded: boolean) => {
		const container = document.getElementById('tool-layout-container');
		if (!container) return;
		if (expanded) {
			container.classList.remove('max-w-[800px]', 'xl:max-w-5xl');
			container.classList.add('max-w-full');
		} else {
			container.classList.remove('max-w-full');
			container.classList.add('max-w-[800px]', 'xl:max-w-5xl');
		}
	}, []);

	const toggleExpand = () => {
		updateSettings({ isExpanded: !settings.isExpanded });
	};

	useEffect(() => {
		applyLayoutWidth(settings.isExpanded);
	}, [settings.isExpanded, applyLayoutWidth]);

	useEffect(() => {
		return () => {
			const container = document.getElementById('tool-layout-container');
			if (container) {
				container.classList.remove('max-w-full');
				container.classList.add('max-w-[800px]', 'xl:max-w-5xl');
			}
		};
	}, []);

	// プレビューの背景色は選択中の Mermaid テーマに合わせる。
	// モノクロテーマはサイトのライト/ダークモードに追従し、それ以外の色付きテーマ
	// （標準・フォレスト）は淡色配色のため、ページがダークモードでもコントラスト崩れを
	// 防ぐために常に明るいキャンバスに固定する。「ダーク」テーマ選択時は常に暗いキャンバスにする。
	const isDarkDiagramTheme =
		settings.theme === 'dark' || (settings.theme === 'mono' && isSiteDark);

	return (
		<div className="flex flex-col gap-4">
			{/* コントロールバー */}
			<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3 shadow-xs">
				<div className="flex flex-wrap items-center gap-3">
					{/* サンプル選択 */}
					<div className="flex items-center gap-1.5">
						<span className="text-xs font-medium text-muted-foreground">
							サンプル:
						</span>
						<Select onValueChange={handleSelectSample}>
							<SelectTrigger className="h-8 w-36 text-xs">
								<SelectValue placeholder="図を選択" />
							</SelectTrigger>
							<SelectContent>
								{Object.entries(SAMPLE_MERMAID_CODES).map(([key, item]) => (
									<SelectItem key={key} value={key} className="text-xs">
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{/* テーマ選択 */}
					<div className="flex items-center gap-1.5">
						<span className="text-xs font-medium text-muted-foreground">
							テーマ:
						</span>
						<Select
							value={settings.theme}
							onValueChange={(val) =>
								updateSettings({
									theme: val as 'mono' | 'default' | 'dark' | 'forest',
								})
							}
						>
							<SelectTrigger className="h-8 w-32 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="mono" className="text-xs">
									モノクロ（自動）
								</SelectItem>
								<SelectItem value="default" className="text-xs">
									標準
								</SelectItem>
								<SelectItem value="dark" className="text-xs">
									ダーク
								</SelectItem>
								<SelectItem value="forest" className="text-xs">
									フォレスト
								</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* 自動修復トグル */}
					<div className="flex items-center gap-2 border-l pl-3">
						<div className="flex items-center gap-1.5">
							<Switch
								id="auto-repair"
								checked={settings.autoRepair}
								onCheckedChange={(checked) =>
									updateSettings({ autoRepair: checked })
								}
							/>
							<label
								htmlFor="auto-repair"
								className="cursor-pointer text-xs font-medium flex items-center gap-1"
							>
								<Wand2 className="size-3 text-primary" />
								日本語・AI修復
							</label>
						</div>
					</div>
				</div>

				{/* 共有・エクスポートボタン群 */}
				<div className="flex items-center gap-1.5">
					<Button
						variant="outline"
						size="sm"
						onClick={() => void copyShareUrl(generateShareUrl())}
						className="h-8 gap-1 text-xs"
					>
						{isCopied ? (
							<>
								<Check className="size-3.5 text-green-600" />
								コピー完了！
							</>
						) : (
							<>
								<Share2 className="size-3.5" />
								設定を共有
							</>
						)}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={handleDownloadSvg}
						disabled={!svgHtml || !!renderError}
						className="h-8 gap-1 text-xs"
					>
						<Download className="size-3.5" />
						SVG保存
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={handleDownloadPng}
						disabled={!svgHtml || !!renderError}
						className="h-8 gap-1 text-xs"
					>
						<Download className="size-3.5" />
						PNG保存
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={toggleExpand}
						className="h-8 gap-1 text-xs"
						title={settings.isExpanded ? '標準サイズに戻す' : '画面幅を広げる'}
					>
						{settings.isExpanded ? (
							<Minimize2 className="size-3.5" />
						) : (
							<Maximize2 className="size-3.5" />
						)}
						{settings.isExpanded ? '標準幅' : 'フルサイズ'}
					</Button>
				</div>
			</div>

			{/* 自動修復の通知バナー */}
			{settings.autoRepair && repairResult.isModified && (
				<div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Sparkles className="size-4 text-amber-600 shrink-0" />
							<span className="font-semibold">
								AI構文・日本語全角記号エラーを自動修復しました（
								{repairResult.changes.length}件）
							</span>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-xs hover:bg-amber-100 dark:hover:bg-amber-900/50"
								onClick={() => setShowChangesDetail(!showChangesDetail)}
							>
								{showChangesDetail ? (
									<>
										詳細を隠す <ChevronDown className="size-3 ml-1" />
									</>
								) : (
									<>
										修復内訳を見る <ChevronRight className="size-3 ml-1" />
									</>
								)}
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="h-6 border-amber-400 bg-white px-2 text-xs text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-100"
								onClick={handleApplyRepairToInput}
							>
								修復コードをエディタに反映
							</Button>
						</div>
					</div>

					{/* 修復内訳リスト */}
					{showChangesDetail && (
						<ul className="mt-2.5 flex flex-col gap-1.5 border-t border-amber-200/80 pt-2 text-[11px] dark:border-amber-800">
							{repairResult.changes.map((c) => (
								<li
									key={`${c.lineNumber}-${c.rule}-${c.description}`}
									className="flex items-start gap-1.5"
								>
									<span className="font-mono text-amber-700 dark:text-amber-300">
										[行{c.lineNumber}]
									</span>
									<span>{c.description}</span>
								</li>
							))}
						</ul>
					)}
				</div>
			)}

			{/* モバイル用タブ */}
			<div className="md:hidden">
				<Tabs
					value={mobileTab}
					onValueChange={(val) => setMobileTab(val as 'editor' | 'preview')}
				>
					<TabsList className="grid w-full grid-cols-2">
						<TabsTrigger value="editor" className="gap-1.5 text-xs">
							<FileCode className="size-3.5" />
							コード入力
						</TabsTrigger>
						<TabsTrigger value="preview" className="gap-1.5 text-xs">
							<Eye className="size-3.5" />
							プレビュー
						</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			{/* メイングリッド（プレビューを広く取り、エディタより比率を大きくする） */}
			<div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-[2fr_3fr]">
				{/* エディタ列 */}
				<div
					className={cn(
						'flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-xs',
						mobileTab === 'preview' && 'hidden md:flex',
					)}
				>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
							<FileCode className="size-3.5 text-primary" />
							Mermaid コード
						</div>
						<div className="flex items-center gap-1">
							<CopyButton text={effectiveCode} label="コピー" />
							<Button
								variant="ghost"
								size="sm"
								className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
								onClick={() => setInput('')}
								title="クリア"
							>
								<Trash2 className="size-3.5" />
							</Button>
						</div>
					</div>

					<Textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="Mermaidコード、またはChatGPTなどの出力コードをそのまま貼り付けてください..."
						className="h-[65dvh] min-h-[420px] flex-1 resize-y font-mono text-xs leading-relaxed"
						spellCheck={false}
					/>
					<div className="flex items-center justify-between text-[11px] text-muted-foreground">
						<span>文字数: {input.length.toLocaleString()} 字</span>
						<span>Markdownフェンスや前後の会話文も自動抽出されます</span>
					</div>
				</div>

				{/* プレビュー列 */}
				<div
					ref={previewColumnRef}
					className={cn(
						'flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-xs',
						mobileTab === 'editor' && 'hidden md:flex',
						isFullscreen && 'h-screen w-screen',
					)}
				>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
							<Eye className="size-3.5 text-primary" />
							プレビュー
							{isRendering && (
								<span className="text-[10px] text-muted-foreground animate-pulse">
									描画中...
								</span>
							)}
						</div>
						{/* ズーム・パン・フルスクリーンコントローラー */}
						<div className="flex items-center gap-1">
							<Button
								variant="ghost"
								size="sm"
								className="h-7 px-1.5 text-xs"
								onClick={() =>
									setZoom((prev) => clamp(prev - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))
								}
								title="縮小"
								disabled={!svgHtml}
							>
								<ZoomOut className="size-3.5" />
							</Button>
							<span className="w-10 text-center font-mono text-[11px]">
								{Math.round(zoom * 100)}%
							</span>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 px-1.5 text-xs"
								onClick={() =>
									setZoom((prev) => clamp(prev + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))
								}
								title="拡大"
								disabled={!svgHtml}
							>
								<ZoomIn className="size-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 px-1.5 text-xs"
								onClick={handleResetView}
								title="倍率・位置をリセット"
								disabled={!svgHtml}
							>
								<RotateCcw className="size-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 px-1.5 text-xs border-l ml-1 pl-2"
								onClick={() => void toggleFullscreen()}
								title={isFullscreen ? '全画面を終了' : 'プレビューを全画面表示'}
							>
								{isFullscreen ? (
									<Shrink className="size-3.5" />
								) : (
									<Expand className="size-3.5" />
								)}
							</Button>
						</div>
					</div>

					{/* プレビュー表示エリア
					    サイトのダーク/ライトモードに関わらず、選択中の Mermaid テーマに合わせた
					    キャンバス背景を固定表示する。モノクロテーマはサイトのライト/ダークモードに
					    追従し、標準・フォレストテーマは淡色配色のため、ページがダークモードでも
					    キャンバスは白背景に固定してコントラスト崩れによる視認性低下を防ぐ。
					    マウスホイールで拡大縮小、ドラッグで移動できる（MermaidLiveEditor同様）。 */}
					<div
						ref={previewContainerRef}
						role="img"
						aria-label="Mermaidダイアグラムのプレビュー（マウスドラッグで移動、ホイールで拡大縮小できます）"
						onMouseDown={handlePreviewMouseDown}
						onMouseMove={handlePreviewMouseMove}
						onMouseUp={handlePreviewMouseUp}
						onMouseLeave={handlePreviewMouseUp}
						className={cn(
							'relative flex flex-1 items-center justify-center overflow-hidden rounded-md border p-4 select-none',
							isFullscreen ? 'h-full min-h-0' : 'h-[65dvh] min-h-[420px]',
							isDarkDiagramTheme ? 'bg-neutral-900' : 'bg-white',
							svgHtml && (isPanning ? 'cursor-grabbing' : 'cursor-grab'),
						)}
					>
						{renderError ? (
							<div className="flex max-w-md flex-col items-center gap-2 text-center p-4">
								<AlertTriangle className="size-8 text-destructive shrink-0" />
								<p className="text-xs font-semibold text-destructive">
									Mermaid構文エラー
								</p>
								<p
									className={cn(
										'font-mono text-[11px] whitespace-pre-wrap break-all p-2 rounded max-h-40 overflow-auto',
										isDarkDiagramTheme
											? 'bg-neutral-800 text-neutral-300'
											: 'bg-neutral-100 text-neutral-600',
									)}
								>
									{renderError}
								</p>
								{!settings.autoRepair && (
									<Button
										variant="outline"
										size="sm"
										className="mt-1 text-xs"
										onClick={() => updateSettings({ autoRepair: true })}
									>
										<Wand2 className="size-3 mr-1" />
										自動修復を有効にする
									</Button>
								)}
							</div>
						) : svgHtml ? (
							<div
								style={{
									transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
									transformOrigin: 'center center',
								}}
								className={cn(
									!isPanning && 'transition-transform duration-100',
								)}
								// biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid.render で securityLevel: strict により生成されたSVGのみを描画
								dangerouslySetInnerHTML={{ __html: svgHtml }}
							/>
						) : (
							<div
								className={cn(
									'text-center text-xs',
									isDarkDiagramTheme ? 'text-neutral-400' : 'text-neutral-500',
								)}
							>
								Mermaidコードを入力するとプレビューが表示されます
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
