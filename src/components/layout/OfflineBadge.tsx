import {
	AlertTriangle,
	CheckCircle2,
	Download,
	Lightbulb,
	MonitorDown,
	RefreshCw,
	Smartphone,
	TabletSmartphone,
	WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';

type BadgeState =
	| 'checking'
	| 'offline'
	| 'ready'
	| 'available'
	| 'downloading'
	| 'error';

export default function OfflineBadge() {
	const [state, setState] = useState<BadgeState>('checking');
	const [progress, setProgress] = useState({
		loaded: 0,
		total: 0,
		percentage: 0,
	});
	const [cacheInfo, setCacheInfo] = useState({ cachedCount: 0, totalCount: 0 });

	const stateRef = useRef<BadgeState>(state);
	stateRef.current = state;

	const checkCacheStatus = useCallback(async (force = false) => {
		if (typeof window === 'undefined') return;
		if (stateRef.current === 'downloading' && !force) return;
		if (!('serviceWorker' in navigator)) {
			setState('available');
			return;
		}
		if (!navigator.onLine) {
			setState('offline');
			return;
		}

		try {
			const reg = await navigator.serviceWorker.ready;
			const sw = reg.active || navigator.serviceWorker.controller;
			if (sw) {
				sw.postMessage({ type: 'CHECK_PRECACHE_STATUS' });
			} else {
				setState('available');
			}
		} catch (err) {
			console.error('Failed to check cache status:', err);
			setState('available');
		}
	}, []);

	useEffect(() => {
		if (typeof window === 'undefined') return;

		if (!navigator.onLine) {
			setState('offline');
		} else {
			checkCacheStatus();
		}

		const handleOnline = () => {
			checkCacheStatus();
		};
		const handleOffline = () => setState('offline');

		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);

		const handleMessage = (event: MessageEvent) => {
			const data = event.data;
			if (!data) return;

			if (data.type === 'PRECACHE_STATUS_RESULT') {
				setCacheInfo({
					cachedCount: data.cachedCount,
					totalCount: data.totalCount,
				});
				if (data.isComplete) {
					setState('ready');
				} else {
					setState((prev) =>
						prev === 'downloading' ? 'downloading' : 'available',
					);
				}
			} else if (data.type === 'PRECACHE_PROGRESS') {
				setState('downloading');
				setProgress({
					loaded: data.loaded,
					total: data.total,
					percentage: data.percentage,
				});
			} else if (data.type === 'PRECACHE_COMPLETE') {
				setState('ready');
				checkCacheStatus(true); // 最新のキャッシュ情報を再確認
			}
		};

		navigator.serviceWorker?.addEventListener('message', handleMessage);

		// SWのアクティベート完了を待ってから再チェック
		const retryTimer = setTimeout(() => {
			if (navigator.onLine) {
				checkCacheStatus();
			}
		}, 1000);

		// SW登録失敗などで応答がない場合に「接続確認中」のまま固まらないようフォールバック
		const fallbackTimer = setTimeout(() => {
			setState((s) => (s === 'checking' ? 'available' : s));
		}, 5000);

		return () => {
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('offline', handleOffline);
			navigator.serviceWorker?.removeEventListener('message', handleMessage);
			clearTimeout(retryTimer);
			clearTimeout(fallbackTimer);
		};
	}, [checkCacheStatus]);

	const startPrecache = async () => {
		if (typeof window === 'undefined' || !('serviceWorker' in navigator))
			return;
		try {
			const reg = await navigator.serviceWorker.ready;
			const sw = reg.active || navigator.serviceWorker.controller;
			if (sw) {
				setState('downloading');
				setProgress({ loaded: 0, total: 100, percentage: 0 });
				sw.postMessage({ type: 'PRECACHE_ALL' });
			} else {
				setState('error');
			}
		} catch (err) {
			console.error('Failed to start precaching:', err);
			setState('error');
		}
	};

	if (state === 'offline') {
		return (
			<span
				className="flex items-center gap-1.5 text-xs text-amber-400 font-medium"
				title="オフラインモードで動作中"
			>
				<WifiOff className="h-3.5 w-3.5" />
				<span className="hidden lg:inline">オフラインモードで動作中</span>
			</span>
		);
	}

	if (state === 'checking') {
		return (
			<span
				className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium"
				title="接続確認中..."
			>
				<RefreshCw className="h-3 w-3 animate-spin" />
				<span className="hidden lg:inline">接続確認中...</span>
			</span>
		);
	}

	return (
		<Popover>
			<PopoverTrigger asChild>
				{state === 'ready' ? (
					<button
						type="button"
						className="flex items-center gap-1.5 text-xs text-safety font-medium hover:opacity-80 transition-opacity cursor-pointer"
						aria-label="オフライン状態を確認"
						title="オフライン対応済み"
					>
						<span className="inline-block h-2 w-2 rounded-full bg-safety pulse-dot" />
						<span className="hidden lg:inline">オフライン対応済み</span>
					</button>
				) : state === 'downloading' ? (
					<button
						type="button"
						className="flex items-center gap-1.5 text-xs text-primary font-medium hover:opacity-80 transition-opacity cursor-pointer"
						aria-label="ダウンロード進捗を確認"
						title={`ダウンロード中 (${progress.percentage}%)`}
					>
						<RefreshCw className="h-3 w-3 animate-spin text-primary" />
						<span className="hidden lg:inline">ダウンロード中 </span>
						<span>({progress.percentage}%)</span>
					</button>
				) : state === 'error' ? (
					<button
						type="button"
						className="flex items-center gap-1.5 text-xs text-destructive font-medium hover:opacity-80 transition-opacity cursor-pointer"
						aria-label="エラー状態を確認"
						title="エラーが発生しました"
					>
						<AlertTriangle className="h-3.5 w-3.5" />
						<span className="hidden lg:inline">エラーが発生しました</span>
					</button>
				) : (
					<button
						type="button"
						className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium hover:text-foreground transition-colors cursor-pointer"
						aria-label="オフラインモードの設定を開く"
						title="オフラインモードを有効化"
					>
						<Download className="h-3.5 w-3.5" />
						<span className="hidden lg:inline">オフラインモードを有効化</span>
					</button>
				)}
			</PopoverTrigger>
			<PopoverContent className="w-80" align="end">
				<div className="space-y-3">
					{state === 'ready' ? (
						<>
							<h4 className="font-semibold text-sm flex items-center gap-1.5 text-safety">
								<CheckCircle2 className="h-4 w-4 text-safety" />
								オフラインの準備が完了しました
							</h4>
							<p className="text-sm text-muted-foreground leading-relaxed">
								すべてのツール（計{cacheInfo.totalCount}
								ファイル）がブラウザにキャッシュされました。これでインターネットに接続していなくてもツールをご利用いただけます。
							</p>
						</>
					) : state === 'downloading' ? (
						<>
							<h4 className="font-semibold text-sm flex items-center gap-1.5 text-primary">
								<RefreshCw className="h-4 w-4 animate-spin text-primary" />
								オフラインアセットをダウンロード中...
							</h4>
							<p className="text-sm text-muted-foreground leading-relaxed">
								ツールをオフラインで利用できるようにアセットをダウンロードしています。このまましばらくお待ちください。
							</p>
							<div className="space-y-1.5">
								<div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
									<div
										className="bg-primary h-full transition-all duration-300 ease-out"
										style={{ width: `${progress.percentage}%` }}
									/>
								</div>
								<div className="flex justify-between text-xs text-muted-foreground">
									<span>{progress.percentage}% 完了</span>
									<span>
										{progress.loaded} / {progress.total} ファイル
									</span>
								</div>
							</div>
						</>
					) : state === 'error' ? (
						<>
							<h4 className="font-semibold text-sm flex items-center gap-1.5 text-destructive">
								<AlertTriangle className="h-4 w-4 text-destructive" />
								有効化に失敗しました
							</h4>
							<p className="text-sm text-muted-foreground leading-relaxed">
								データの保存中にエラーが発生しました。ネットワーク接続を確認し、ページを再読み込みしてから再度お試しください。
							</p>
							<button
								type="button"
								onClick={startPrecache}
								className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2 cursor-pointer font-sans"
							>
								もう一度試す
							</button>
						</>
					) : (
						<>
							<h4 className="flex items-center gap-1.5 font-semibold text-sm">
								<TabletSmartphone
									className="h-4 w-4 shrink-0"
									aria-hidden="true"
								/>
								オフラインでツールを使う
							</h4>
							<p className="text-sm text-muted-foreground leading-relaxed font-sans">
								すべてのツールと画面（約{cacheInfo.totalCount || '---'}
								アセット）を一括ダウンロードし、インターネット接続がない状態でも利用できるようにします。
							</p>
							<button
								type="button"
								onClick={startPrecache}
								className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2 cursor-pointer font-sans"
							>
								オフラインモードを有効化（一括ダウンロード）
							</button>
							<div className="border-t border-border/60 my-2 pt-2">
								<p className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
									<Lightbulb
										className="h-3.5 w-3.5 shrink-0"
										aria-hidden="true"
									/>
									PWAとしてインストールすることもできます：
								</p>
								<div className="rounded-md bg-muted p-2.5 text-xs text-muted-foreground space-y-1">
									<p className="flex items-center gap-1.5">
										<Smartphone
											className="h-3.5 w-3.5 shrink-0"
											aria-hidden="true"
										/>
										<span>
											<strong>iOS/Safari:</strong> 共有 → ホーム画面に追加
										</span>
									</p>
									<p className="flex items-center gap-1.5">
										<Smartphone
											className="h-3.5 w-3.5 shrink-0"
											aria-hidden="true"
										/>
										<span>
											<strong>Android/Chrome:</strong> アプリをインストール
										</span>
									</p>
									<p className="flex items-center gap-1.5">
										<MonitorDown
											className="h-3.5 w-3.5 shrink-0"
											aria-hidden="true"
										/>
										<span>
											<strong>PC/Chrome:</strong> アドレスバー右の ＋ をクリック
										</span>
									</p>
								</div>
							</div>
						</>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
