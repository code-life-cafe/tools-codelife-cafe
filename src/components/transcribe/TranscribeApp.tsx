// TranscribeApp — /transcribe の状態管理ルート
//
// 正本: https://app.notion.com/p/396dfd36033681cba834ecd64d6167b3
//
// 不変条件:
// - 音声・文字起こし結果を外部へ送らない。計測イベントも送らない（useToolAnalytics を使わない）。
// - 推論は Web Worker 内のみ。キャンセルはここで worker.terminate() する。

import { AlertTriangle, Loader2, Play, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	decodeAudioFile,
	readDurationSec,
	validateAudioFile,
} from '@/lib/transcribe/audio-browser';
import {
	ASSUMED_CHANNELS,
	ASSUMED_SAMPLE_RATE,
	assessDuration,
	assessMemory,
	estimatePeakMemoryBytes,
} from '@/lib/transcribe/audio-core';
import {
	evictModelCache,
	isModelCached,
	resolveModelLoadSource,
} from '@/lib/transcribe/cache';
import { TranscribeClient } from '@/lib/transcribe/client';
import {
	getDeviceMemoryGb,
	isBrowserSupported,
	resolveDevice,
} from '@/lib/transcribe/detect';
import { isSmallRecommended, modelPeakBytes } from '@/lib/transcribe/models';
import {
	ERROR_GUIDANCE,
	type ErrorCode,
	isBusy,
	type ModelId,
	type TranscribeDevice,
	type TranscribeLanguage,
	type TranscribeState,
	type TranscriptSegment,
	type WorkerResponse,
} from '@/lib/transcribe/protocol';
import { upsertSegment } from '@/lib/transcribe/segments';
import { DropZone } from './DropZone';
import { ExportBar } from './ExportBar';
import { ModelSelector } from './ModelSelector';
import { ProgressPanel } from './ProgressPanel';
import { SegmentList } from './SegmentList';

export default function TranscribeApp() {
	const [supported, setSupported] = useState(true);
	const [device, setDevice] = useState<TranscribeDevice | null>(null);
	const [deviceMemoryGb, setDeviceMemoryGb] = useState<number | null>(null);
	const [cachedModelIds, setCachedModelIds] = useState<ModelId[]>([]);

	const [modelId, setModelId] = useState<ModelId>('tiny');
	const [language, setLanguage] = useState<TranscribeLanguage>('ja');

	const [file, setFile] = useState<File | null>(null);
	const [durationSec, setDurationSec] = useState<number | null>(null);
	const [metadataStatus, setMetadataStatus] = useState<
		'idle' | 'checking' | 'available' | 'unavailable'
	>('idle');
	const [warning, setWarning] = useState<string | null>(null);
	const [inputError, setInputError] = useState<string | null>(null);

	const [state, setState] = useState<TranscribeState>({ phase: 'idle' });
	const [segments, setSegments] = useState<TranscriptSegment[]>([]);

	const clientRef = useRef<TranscribeClient | null>(null);
	const fileRef = useRef<File | null>(null);
	const durationRef = useRef<number | null>(null);
	const metadataGenerationRef = useRef(0);
	const cacheRetriedRef = useRef(false);
	// handleCancel/handleClear/handleModelChange と非forcedなhandleRunの呼び出しで
	// インクリメントする。retryWithCacheEviction の非同期処理（キャッシュ削除）完了時に
	// この値が変わっていれば、その間にキャンセル等が起きたということなので再取得を中止する。
	const runGenerationRef = useRef(0);
	const runRef = useRef<(options?: { forceNetworkSource?: boolean }) => void>(
		() => undefined,
	);

	// --- 環境判定 ---
	useEffect(() => {
		let alive = true;
		if (!isBrowserSupported()) {
			setSupported(false);
			return;
		}
		setDeviceMemoryGb(getDeviceMemoryGb());
		void resolveDevice().then((resolved) => {
			if (alive) setDevice(resolved);
		});
		return () => {
			alive = false;
		};
	}, []);

	// --- キャッシュ済みモデルの確認 ---
	useEffect(() => {
		if (!device) return;
		let alive = true;
		void (async () => {
			const ids: ModelId[] = [];
			for (const id of ['tiny', 'base', 'small'] as const) {
				if (await isModelCached(id, device)) ids.push(id);
			}
			if (alive) setCachedModelIds(ids);
		})();
		return () => {
			alive = false;
		};
	}, [device]);

	// --- 処理中の離脱防止 ---
	useEffect(() => {
		if (!isBusy(state)) return;
		const handler = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	}, [state]);

	// --- アンマウント時に Worker を破棄 ---
	useEffect(() => {
		return () => {
			clientRef.current?.terminate();
			clientRef.current = null;
		};
	}, []);

	const fail = useCallback((code: ErrorCode, message: string) => {
		setState({ phase: 'error', code, message });
	}, []);

	/** モデルロード完了後: デコード → 事前判定 → 推論開始 */
	const decodeAndTranscribe = useCallback(async () => {
		const target = fileRef.current;
		const client = clientRef.current;
		if (!target || !client) return;

		setState({ phase: 'decoding' });
		let decoded: Awaited<ReturnType<typeof decodeAudioFile>>;
		try {
			decoded = await decodeAudioFile(target);
		} catch (error) {
			fail(
				'decode-failed',
				error instanceof Error ? error.message : String(error),
			);
			return;
		}

		// duration が事前に取れなかった場合に備え、デコード後の実測値で再判定する
		const durationCheck = assessDuration(decoded.durationSec);
		if (!durationCheck.ok) {
			fail(durationCheck.code, durationCheck.message);
			return;
		}
		durationRef.current = decoded.durationSec;
		setDurationSec(decoded.durationSec);

		const memory = assessMemory({
			estimatedBytes: estimatePeakMemoryBytes({
				durationSec: decoded.durationSec,
				sampleRate: decoded.sampleRate,
				channels: decoded.channels,
				modelPeakBytes: modelPeakBytes(modelId, device ?? 'wasm'),
			}),
			deviceMemoryGb,
			modelId,
			device: device ?? 'wasm',
		});
		if (memory.level === 'stop') {
			fail(memory.code, memory.message);
			return;
		}
		setWarning(memory.level === 'warn' ? memory.message : null);

		setState({
			phase: 'transcribing',
			progress: 0,
			elapsedMs: 0,
			partial: [],
		});
		const audio = decoded.audio;
		client.post({ type: 'transcribe', audio, language }, [audio.buffer]);
	}, [deviceMemoryGb, device, fail, language, modelId]);

	/**
	 * 対象モデルのキャッシュを削除し、source: network を強制して1回だけ再取得する。
	 * - 手動実行: エラー画面の「キャッシュを削除して再取得」ボタンから（network起点の失敗向け）
	 * - 自動実行: handleMessage の error ケースから（cache起点の失敗時。正本の自動再取得要件）
	 * cacheRetriedRef で二重発火を防ぎ、runGenerationRef でキャンセル等の後の再開を防ぐ。
	 */
	const retryWithCacheEviction = useCallback(() => {
		if (!device || cacheRetriedRef.current) return;
		cacheRetriedRef.current = true;
		const generation = runGenerationRef.current;
		clientRef.current?.terminate();
		clientRef.current = null;
		void (async () => {
			await evictModelCache(modelId, device);
			setCachedModelIds((prev) => prev.filter((id) => id !== modelId));
			// キャッシュ削除の待機中にキャンセル・クリア・モデル変更があれば再開しない
			if (runGenerationRef.current !== generation) return;
			runRef.current({ forceNetworkSource: true });
		})();
	}, [device, modelId]);

	const handleMessage = useCallback(
		(message: WorkerResponse) => {
			switch (message.type) {
				case 'progress':
					if (message.kind === 'model') {
						setState((prev) =>
							prev.phase === 'loading-model' && prev.source === 'network'
								? { ...prev, progress: message.pct }
								: prev,
						);
					} else {
						setState((prev) =>
							prev.phase === 'transcribing'
								? {
										...prev,
										progress: message.pct,
										elapsedMs: message.elapsedMs,
									}
								: prev,
						);
					}
					break;
				case 'ready':
					setCachedModelIds((prev) =>
						prev.includes(message.modelId) ? prev : [...prev, message.modelId],
					);
					void decodeAndTranscribe();
					break;
				case 'segment':
					setState((prev) =>
						prev.phase === 'transcribing'
							? {
									...prev,
									partial: upsertSegment(prev.partial, message.segment),
								}
							: prev,
					);
					break;
				case 'done':
					setSegments(message.segments);
					setState({
						phase: 'done',
						segments: message.segments,
						durationSec: durationRef.current ?? 0,
					});
					break;
				case 'error':
					// source: cache でのロード失敗のみ、自動でキャッシュ削除→network再取得を1回試みる。
					// 通常の network 起点の失敗は自動リトライしない（手動ボタンのみが復旧手段）。
					if (
						message.code === 'model-load-failed' &&
						state.phase === 'loading-model' &&
						state.source === 'cache' &&
						!cacheRetriedRef.current
					) {
						retryWithCacheEviction();
						return;
					}
					setState({
						phase: 'error',
						code: message.code,
						message: message.message,
					});
					break;
			}
		},
		[decodeAndTranscribe, state, retryWithCacheEviction],
	);

	const handleFailure = useCallback(() => {
		setState({
			phase: 'error',
			code: 'unsupported-browser',
			message: '推論の実行中に予期しないエラーが発生しました。',
		});
	}, []);

	// ハンドラは依存の変化で作り直されるが、Worker は作り直さない
	// （実行中の Worker を差し替えると推論が失われるため、ref 経由で最新版を呼ぶ）
	const handlersRef = useRef({
		onMessage: handleMessage,
		onFailure: handleFailure,
	});
	handlersRef.current = { onMessage: handleMessage, onFailure: handleFailure };

	const ensureClient = useCallback((): TranscribeClient => {
		if (!clientRef.current) {
			clientRef.current = new TranscribeClient({
				onMessage: (message) => handlersRef.current.onMessage(message),
				onFailure: () => handlersRef.current.onFailure(),
			});
		}
		return clientRef.current;
	}, []);

	// ファイル選択のフィードバック（ファイル名描画）を優先し、duration解析は
	// 下の useEffect（file を key にする）へ分離する。ここは同期処理のみ。
	const handleFileSelect = useCallback((selected: File) => {
		setInputError(null);
		setWarning(null);
		setSegments([]);
		setState({ phase: 'idle' });
		cacheRetriedRef.current = false;

		const validation = validateAudioFile(selected);
		if (!validation.ok) {
			setInputError(validation.message);
			return;
		}

		setFile(selected);
		fileRef.current = selected;
		setDurationSec(null);
		durationRef.current = null;
	}, []);

	// --- duration 解析（ファイル選択の描画後に開始する） ---
	// setMetadataStatus('checking') は即座に反映し、開始ボタンの無効化はここから効く。
	// 重い解析（readDurationSec）は二重 requestAnimationFrame の後まで遅らせる:
	// 1回目の rAF コールバックは次のペイント"直前"に発火するため、その中で2回目の rAF を
	// 予約することで「ファイル名を含む今回の描画が実際にペイントされた後」を明示的に保証する
	// （useEffectがペイント後に実行される、という前提だけには依存しない）。
	useEffect(() => {
		if (!file) {
			setMetadataStatus('idle');
			return;
		}
		const generation = ++metadataGenerationRef.current;
		const controller = new AbortController();
		setMetadataStatus('checking');

		let rafId1 = 0;
		let rafId2 = 0;
		rafId1 = requestAnimationFrame(() => {
			rafId2 = requestAnimationFrame(() => {
				void readDurationSec(file, controller.signal).then((seconds) => {
					// 世代ガード + signal の二重防御。abort後に resolve された stale な結果を破棄する
					if (metadataGenerationRef.current !== generation) return;
					if (controller.signal.aborted) return;

					if (!Number.isFinite(seconds)) {
						// 取得不能。デコード後の AudioBuffer 長で再判定する
						setDurationSec(null);
						durationRef.current = null;
						setMetadataStatus('unavailable');
						return;
					}
					const check = assessDuration(seconds);
					setDurationSec(seconds);
					durationRef.current = seconds;
					if (!check.ok) {
						setState({
							phase: 'error',
							code: check.code,
							message: check.message,
						});
					}
					setMetadataStatus('available');
				});
			});
		});

		return () => {
			controller.abort();
			cancelAnimationFrame(rafId1);
			cancelAnimationFrame(rafId2);
		};
	}, [file]);

	const handleClear = useCallback(() => {
		runGenerationRef.current++;
		clientRef.current?.terminate();
		clientRef.current = null;
		setFile(null);
		fileRef.current = null;
		setDurationSec(null);
		durationRef.current = null;
		setSegments([]);
		setWarning(null);
		setInputError(null);
		setState({ phase: 'idle' });
	}, []);

	const handleRun = useCallback(
		(options?: { forceNetworkSource?: boolean }) => {
			if (!fileRef.current || !device) return;
			runGenerationRef.current++;
			// forced（内部リトライ）以外の新規実行では、前回の再試行済みフラグを持ち越さない
			if (!options?.forceNetworkSource) {
				cacheRetriedRef.current = false;
			}
			setSegments([]);
			setWarning(null);

			// duration が事前に分かる場合は、デコード前にメモリ安全性も判定する
			const seconds = durationRef.current;
			if (seconds !== null) {
				const memory = assessMemory({
					estimatedBytes: estimatePeakMemoryBytes({
						durationSec: seconds,
						sampleRate: ASSUMED_SAMPLE_RATE,
						channels: ASSUMED_CHANNELS,
						modelPeakBytes: modelPeakBytes(modelId, device),
					}),
					deviceMemoryGb,
					modelId,
					device,
				});
				if (memory.level === 'stop') {
					setState({
						phase: 'error',
						code: memory.code,
						message: memory.message,
					});
					return;
				}
				if (memory.level === 'warn') setWarning(memory.message);
			}

			const source = resolveModelLoadSource(modelId, cachedModelIds, options);
			setState({
				phase: 'loading-model',
				modelId,
				source,
				progress: source === 'network' ? 0 : null,
			});
			ensureClient().post({ type: 'load', modelId, device });
		},
		[device, deviceMemoryGb, ensureClient, modelId, cachedModelIds],
	);

	useEffect(() => {
		runRef.current = handleRun;
	}, [handleRun]);

	const handleCancel = useCallback(() => {
		// キャンセルはエラー扱いしない。Worker を破棄して idle に戻す
		runGenerationRef.current++;
		clientRef.current?.terminate();
		clientRef.current = null;
		setState({ phase: 'idle' });
	}, []);

	const handleModelChange = useCallback((next: ModelId) => {
		// モデル切替時は旧 Worker を破棄する（別モデルのセッションを残さない）
		runGenerationRef.current++;
		clientRef.current?.terminate();
		clientRef.current = null;
		setModelId(next);
		setState({ phase: 'idle' });
	}, []);

	const handleSegmentChange = useCallback((id: number, text: string) => {
		setSegments((prev) =>
			prev.map((segment) =>
				segment.id === id ? { ...segment, text } : segment,
			),
		);
	}, []);

	if (!supported) {
		const guidance = ERROR_GUIDANCE['unsupported-browser'];
		return (
			<Alert variant="destructive">
				<AlertTriangle className="h-4 w-4" aria-hidden="true" />
				<AlertTitle>{guidance.title}</AlertTitle>
				<AlertDescription>
					{guidance.description}
					{guidance.hint}
				</AlertDescription>
			</Alert>
		);
	}

	const busy = isBusy(state);
	const displaySegments =
		state.phase === 'transcribing' ? state.partial : segments;

	return (
		<div className="flex flex-col gap-6">
			<ModelSelector
				modelId={modelId}
				onModelChange={handleModelChange}
				language={language}
				onLanguageChange={setLanguage}
				device={device}
				cachedModelIds={cachedModelIds}
				smallRecommended={isSmallRecommended({
					device,
					deviceMemoryGb,
					durationSec,
				})}
				disabled={busy}
			/>

			<DropZone
				fileName={file?.name ?? null}
				onFileSelect={handleFileSelect}
				onValidationError={setInputError}
				onClear={handleClear}
				disabled={busy}
			/>

			{inputError && (
				<Alert variant="destructive">
					<AlertTriangle className="h-4 w-4" aria-hidden="true" />
					<AlertTitle>ファイルを読み込めません</AlertTitle>
					<AlertDescription>{inputError}</AlertDescription>
				</Alert>
			)}

			{warning && (
				<Alert>
					<AlertTriangle className="h-4 w-4" aria-hidden="true" />
					<AlertTitle>メモリに注意が必要です</AlertTitle>
					<AlertDescription>{warning}</AlertDescription>
				</Alert>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<Button
					onClick={() => handleRun()}
					disabled={!file || busy || !device || metadataStatus === 'checking'}
					data-testid="transcribe-run"
				>
					{busy ? (
						<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
					) : (
						<Play className="h-4 w-4" aria-hidden="true" />
					)}
					文字起こしを開始
				</Button>
				{busy && (
					<Button
						variant="outline"
						onClick={handleCancel}
						data-testid="transcribe-cancel"
					>
						<X className="h-4 w-4" aria-hidden="true" />
						キャンセル
					</Button>
				)}
				{metadataStatus === 'checking' && (
					<span
						className="text-sm text-muted-foreground"
						data-testid="transcribe-metadata-checking"
					>
						音声の長さを確認しています…
					</span>
				)}
				{metadataStatus !== 'checking' && durationSec !== null && (
					<span className="text-sm text-muted-foreground">
						長さ {Math.floor(durationSec / 60)}分
						{String(Math.round(durationSec % 60)).padStart(2, '0')}秒
					</span>
				)}
			</div>

			<ProgressPanel state={state} />

			{state.phase === 'error' && (
				<Alert variant="destructive" data-testid="transcribe-error">
					<AlertTriangle className="h-4 w-4" aria-hidden="true" />
					<AlertTitle>{ERROR_GUIDANCE[state.code].title}</AlertTitle>
					<AlertDescription>
						<span>{ERROR_GUIDANCE[state.code].description}</span>
						<span>{ERROR_GUIDANCE[state.code].hint}</span>
						<span className="text-xs opacity-80">詳細: {state.message}</span>
						<span className="flex flex-wrap gap-2 pt-1">
							<Button size="sm" variant="outline" onClick={() => handleRun()}>
								<RotateCcw className="h-4 w-4" aria-hidden="true" />
								再試行
							</Button>
							{state.code === 'model-load-failed' &&
								!cacheRetriedRef.current && (
									<Button
										size="sm"
										variant="ghost"
										onClick={() => retryWithCacheEviction()}
									>
										キャッシュを削除して再取得
									</Button>
								)}
						</span>
					</AlertDescription>
				</Alert>
			)}

			{displaySegments.length > 0 && (
				<div className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h2 className="text-sm font-medium">
							文字起こし結果
							{state.phase === 'transcribing' && (
								<span className="ml-2 text-xs font-normal text-muted-foreground">
									（暫定表示・完了後に編集できます）
								</span>
							)}
						</h2>
						{state.phase === 'done' && (
							<ExportBar
								segments={segments}
								baseName={file?.name ?? 'transcript'}
							/>
						)}
					</div>
					<SegmentList
						segments={displaySegments}
						editable={state.phase === 'done'}
						onChange={handleSegmentChange}
					/>
				</div>
			)}
		</div>
	);
}
