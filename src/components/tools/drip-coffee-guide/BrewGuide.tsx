import {
	Pause,
	Play,
	RotateCcw,
	Volume1,
	Volume2,
	VolumeX,
	X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import {
	type BrewSession,
	computeCumulativeWaterMl,
	computeTotalWaterMl,
	type Recipe,
	type RecipeStep,
} from '@/lib/tools/drip-coffee-guide';
import { clearSession, saveSession } from '@/lib/tools/drip-coffee-guide-store';

interface BrewGuideProps {
	recipe: Recipe;
	steps: readonly RecipeStep[];
	actualDoseG: number;
	initialSession: BrewSession | null;
	audioContext: AudioContext | null;
	onFinish: (measuredSeconds: number) => void;
	onDiscard: () => void;
}

function computeElapsedMs(session: BrewSession, nowMs: number): number {
	if (session.status === 'running') {
		return session.pausedElapsedMs + Math.max(0, nowMs - session.startedAtUnix);
	}
	return session.pausedElapsedMs;
}

function deriveStepIndex(
	steps: readonly RecipeStep[],
	elapsedSec: number,
): number {
	let idx = 0;
	for (let i = 0; i < steps.length; i++) {
		if (steps[i].time_sec <= elapsedSec) idx = i;
	}
	return idx;
}

const VOLUME_PREVIEW_DEBOUNCE_MS = 200;

function formatClock(totalSec: number): string {
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${m}:${String(s).padStart(2, '0')}`;
}

/** action_typeごとの操作説明。「スワール」など専門用語の意味を補足する。 */
function getStepHint(step: RecipeStep | undefined): string | null {
	if (!step) return null;
	switch (step.action_type) {
		case 'swirl':
			return 'スワール: ドリッパーを軽く揺すり、コーヒー粉の層を平らにならします。';
		case 'wait':
			return 'そのまま待ちます。';
		case 'finish':
			return 'お湯が落ちきったら「抽出完了」を押してください。';
		default:
			return null;
	}
}

export function playBeep(
	ctx: AudioContext,
	type: 'step' | 'pre' = 'step',
	volumePercent = 50,
) {
	try {
		const volumeScale = Math.max(0, Math.min(100, volumePercent)) / 100;
		if (volumeScale <= 0) return;

		const oscillator = ctx.createOscillator();
		const gain = ctx.createGain();
		oscillator.type = 'sine';

		if (type === 'pre') {
			oscillator.frequency.value = 440;
			const maxGain = 0.08 * volumeScale;
			gain.gain.setValueAtTime(maxGain, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
			oscillator.connect(gain);
			gain.connect(ctx.destination);
			oscillator.start();
			oscillator.stop(ctx.currentTime + 0.08);
		} else {
			oscillator.frequency.value = 880;
			const maxGain = 0.15 * volumeScale;
			gain.gain.setValueAtTime(maxGain, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
			oscillator.connect(gain);
			gain.connect(ctx.destination);
			oscillator.start();
			oscillator.stop(ctx.currentTime + 0.35);
		}
	} catch {
		// 効果音の再生失敗はガイドの進行を止めない
	}
}

export function BrewGuide({
	recipe,
	steps,
	actualDoseG,
	initialSession,
	audioContext,
	onFinish,
	onDiscard,
}: BrewGuideProps) {
	const [session, setSession] = useState<BrewSession>(
		initialSession ?? {
			recipeId: recipe.id,
			startedAtUnix: Date.now(),
			pausedElapsedMs: 0,
			currentStepIndex: 0,
			scaledDoseG: actualDoseG,
			status: initialSession ? 'running' : 'paused',
		},
	);
	const [countdown, setCountdown] = useState<number | null>(
		initialSession ? null : 3,
	);
	const [nowMs, setNowMs] = useState(Date.now());
	const [settings, updateSettings] = useToolSettings('drip-coffee-guide', {
		soundEnabled: true,
		soundVolume: 50,
	});
	const [showAbortConfirm, setShowAbortConfirm] = useState(false);
	const [pendingJumpStepIndex, setPendingJumpStepIndex] = useState<
		number | null
	>(null);
	const [wakeLockStatus, setWakeLockStatus] = useState<
		'idle' | 'active' | 'unsupported' | 'failed'
	>('idle');
	const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
	const lastStepIndexRef = useRef<number>(session.currentStepIndex);
	const lastCountdownSecRef = useRef<number | null>(null);
	const volumePreviewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	useEffect(() => {
		return () => {
			if (volumePreviewTimeoutRef.current) {
				clearTimeout(volumePreviewTimeoutRef.current);
			}
		};
	}, []);

	// カウントダウン処理（3 -> 2 -> 1 -> 開始）
	useEffect(() => {
		if (countdown === null) return;
		if (countdown > 0) {
			if (settings.soundEnabled && audioContext) {
				playBeep(audioContext, 'pre', settings.soundVolume ?? 50);
			}
			const timer = setTimeout(() => {
				setCountdown((prev) => (prev !== null ? prev - 1 : null));
			}, 1000);
			return () => clearTimeout(timer);
		}

		// countdown === 0: カウントダウン完了、タイマースタート
		if (settings.soundEnabled && audioContext) {
			playBeep(audioContext, 'step', settings.soundVolume ?? 50);
		}
		const now = Date.now();
		setSession({
			recipeId: recipe.id,
			startedAtUnix: now,
			pausedElapsedMs: 0,
			currentStepIndex: 0,
			scaledDoseG: actualDoseG,
			status: 'running',
		});
		setNowMs(now);
		setCountdown(null);
	}, [
		countdown,
		settings.soundEnabled,
		settings.soundVolume,
		audioContext,
		recipe.id,
		actualDoseG,
	]);

	const handleSkipCountdown = () => {
		if (settings.soundEnabled && audioContext) {
			playBeep(audioContext, 'step', settings.soundVolume ?? 50);
		}
		const now = Date.now();
		setSession({
			recipeId: recipe.id,
			startedAtUnix: now,
			pausedElapsedMs: 0,
			currentStepIndex: 0,
			scaledDoseG: actualDoseG,
			status: 'running',
		});
		setNowMs(now);
		setCountdown(null);
	};

	useEffect(() => {
		if (countdown === null) {
			saveSession(session);
		}
	}, [session, countdown]);

	useEffect(() => {
		if (session.status !== 'running' || countdown !== null) return;
		const id = setInterval(() => setNowMs(Date.now()), 100);
		return () => clearInterval(id);
	}, [session.status, countdown]);

	// Wake Lock: 対応していない・取得に失敗してもガイドは止めず、状態表示のみ行う
	useEffect(() => {
		let cancelled = false;
		async function acquire() {
			const nav = navigator as Navigator & {
				wakeLock?: {
					request: (type: 'screen') => Promise<{
						release: () => Promise<void>;
						addEventListener?: (type: string, listener: () => void) => void;
					}>;
				};
			};
			if (!nav.wakeLock) {
				setWakeLockStatus('unsupported');
				return;
			}
			try {
				const lock = await nav.wakeLock.request('screen');
				if (cancelled) {
					await lock.release();
					return;
				}
				lock.addEventListener?.('release', () => {
					wakeLockRef.current = null;
					setWakeLockStatus('idle');
				});
				wakeLockRef.current = lock;
				setWakeLockStatus('active');
			} catch {
				setWakeLockStatus('failed');
			}
		}
		if (session.status === 'running' && countdown === null) {
			acquire();
		}
		return () => {
			cancelled = true;
		};
	}, [session.status, countdown]);

	useEffect(() => {
		function handleVisibilityChange() {
			if (document.visibilityState !== 'visible') return;
			if (session.status !== 'running' || countdown !== null) return;
			if (wakeLockRef.current) return;
			const nav = navigator as Navigator & {
				wakeLock?: {
					request: (type: 'screen') => Promise<{
						release: () => Promise<void>;
						addEventListener?: (type: string, listener: () => void) => void;
					}>;
				};
			};
			nav.wakeLock
				?.request('screen')
				.then((lock) => {
					lock.addEventListener?.('release', () => {
						wakeLockRef.current = null;
						setWakeLockStatus('idle');
					});
					wakeLockRef.current = lock;
					setWakeLockStatus('active');
				})
				.catch(() => setWakeLockStatus('failed'));
		}
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () =>
			document.removeEventListener('visibilitychange', handleVisibilityChange);
	}, [session.status, countdown]);

	useEffect(() => {
		return () => {
			wakeLockRef.current?.release().catch(() => {});
			wakeLockRef.current = null;
		};
	}, []);

	const elapsedMs = countdown !== null ? 0 : computeElapsedMs(session, nowMs);
	const elapsedSec = Math.floor(elapsedMs / 1000);
	const stepIndex = deriveStepIndex(steps, elapsedSec);
	const currentStep = steps[stepIndex];
	const currentCumulativeMl = computeCumulativeWaterMl(steps, stepIndex);
	const totalWaterMl = computeTotalWaterMl(steps);
	const totalDurationSec = steps[steps.length - 1]?.time_sec ?? 0;
	const totalDurationMs = totalDurationSec * 1000;
	const progressPercent =
		totalDurationMs > 0
			? Math.min(100, (elapsedMs / totalDurationMs) * 100)
			: 0;

	useEffect(() => {
		if (countdown !== null) return;
		if (stepIndex === lastStepIndexRef.current) return;
		lastStepIndexRef.current = stepIndex;
		lastCountdownSecRef.current = null;
		setSession((prev) => ({ ...prev, currentStepIndex: stepIndex }));
		if (settings.soundEnabled && audioContext) {
			playBeep(audioContext, 'step', settings.soundVolume ?? 50);
		}
	}, [
		stepIndex,
		countdown,
		settings.soundEnabled,
		settings.soundVolume,
		audioContext,
	]);

	// 次のメモリ（ステップ切替）到達直前（残り3秒、2秒、1秒）の予告時報音
	useEffect(() => {
		if (session.status !== 'running' || countdown !== null) return;
		if (!settings.soundEnabled || !audioContext) return;

		const nextStep = steps[stepIndex + 1];
		if (!nextStep) return;

		const remainingSec = nextStep.time_sec - elapsedSec;
		if (remainingSec >= 1 && remainingSec <= 3) {
			if (lastCountdownSecRef.current !== remainingSec) {
				lastCountdownSecRef.current = remainingSec;
				playBeep(audioContext, 'pre', settings.soundVolume ?? 50);
			}
		}
	}, [
		elapsedSec,
		session.status,
		countdown,
		settings.soundEnabled,
		settings.soundVolume,
		audioContext,
		stepIndex,
		steps,
	]);

	const handleVolumeChange = (value: number) => {
		updateSettings({ soundVolume: value });
		if (!settings.soundEnabled || !audioContext) return;
		if (volumePreviewTimeoutRef.current) {
			clearTimeout(volumePreviewTimeoutRef.current);
		}
		volumePreviewTimeoutRef.current = setTimeout(() => {
			playBeep(audioContext, 'step', value);
		}, VOLUME_PREVIEW_DEBOUNCE_MS);
	};

	const handlePauseResume = () => {
		if (countdown !== null) {
			handleSkipCountdown();
			return;
		}
		setSession((prev) => {
			if (prev.status === 'running') {
				return {
					...prev,
					pausedElapsedMs: computeElapsedMs(prev, Date.now()),
					status: 'paused',
				};
			}
			return { ...prev, startedAtUnix: Date.now(), status: 'running' };
		});
	};

	const handleRestart = () => {
		setPendingJumpStepIndex(null);
		lastStepIndexRef.current = 0;
		setCountdown(3);
	};

	const handleConfirmJump = () => {
		if (pendingJumpStepIndex === null) return;
		const targetStep = steps[pendingJumpStepIndex];
		if (!targetStep) return;

		const targetElapsedMs = targetStep.time_sec * 1000;
		const now = Date.now();

		if (countdown !== null) {
			setCountdown(null);
		}

		setSession((prev) => {
			if (prev.status === 'running') {
				return {
					...prev,
					startedAtUnix: now - targetElapsedMs,
					pausedElapsedMs: 0,
					currentStepIndex: pendingJumpStepIndex,
				};
			}
			return {
				...prev,
				startedAtUnix: now,
				pausedElapsedMs: targetElapsedMs,
				currentStepIndex: pendingJumpStepIndex,
			};
		});

		lastStepIndexRef.current = pendingJumpStepIndex;
		setPendingJumpStepIndex(null);
	};

	const handleComplete = () => {
		clearSession();
		onFinish(elapsedSec);
	};

	const handleAbortRecord = () => {
		clearSession();
		onFinish(elapsedSec);
	};

	const handleAbortDiscard = () => {
		clearSession();
		onDiscard();
	};

	const isCountdownActive = countdown !== null && countdown > 0;

	const guide = (
		<div
			className="fixed inset-0 z-50 flex flex-col bg-background"
			style={{ height: '100dvh' }}
		>
			<header className="shrink-0 flex items-center justify-between border-b border-border px-4 py-2.5 sm:py-3 sm:px-6">
				<div>
					<p className="text-xs sm:text-sm font-semibold tracking-wider text-accent">
						LIVE GUIDE
					</p>
					<h2 className="text-base sm:text-lg font-bold">{recipe.name}</h2>
				</div>
				<Button
					variant="outline"
					size="sm"
					className="h-9 sm:h-10 text-sm font-medium"
					onClick={() => setShowAbortConfirm(true)}
				>
					<X className="h-4 w-4" />
					中断する
				</Button>
			</header>

			<nav
				aria-label="ステップ選択"
				className="shrink-0 overflow-x-auto border-b border-border px-4 py-2 sm:py-2.5 sm:px-6"
			>
				<ol className="m-0 flex min-w-max list-none gap-2 p-0">
					{steps.map((step, i) => {
						const isActive = i === stepIndex;
						return (
							<li key={`${step.step_order}-${step.label}`}>
								<button
									type="button"
									onClick={() => setPendingJumpStepIndex(i)}
									disabled={isActive}
									aria-label={`STEP ${i + 1}: ${step.label}（${formatClock(step.time_sec)}〜）へ移動`}
									className={`flex items-center gap-2 rounded-full px-3.5 py-1 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
										isActive
											? 'bg-accent text-accent-foreground font-bold cursor-default'
											: i < stepIndex
												? 'bg-muted text-muted-foreground line-through hover:bg-muted/80 cursor-pointer'
												: 'bg-muted/50 text-muted-foreground hover:bg-muted cursor-pointer'
									}`}
								>
									<span className="font-mono font-bold">{i + 1}</span>
									<span>{step.label}</span>
								</button>
							</li>
						);
					})}
				</ol>
			</nav>

			<div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-3 sm:gap-6 px-4 py-4 text-center max-w-xl mx-auto w-full">
				<div aria-live="polite">
					<p className="text-sm sm:text-base font-bold text-accent tracking-wide">
						STEP {stepIndex + 1} / {steps.length}
					</p>
					<p className="mt-0.5 text-2xl sm:text-4xl font-black tracking-tight">
						{currentStep?.label}
					</p>
				</div>

				{isCountdownActive ? (
					<div
						className="flex flex-col items-center justify-center gap-1.5 py-1"
						data-testid="guide-countdown"
					>
						<p className="text-xs sm:text-sm font-semibold text-muted-foreground">
							注湯の準備をしてください（まもなく開始）
						</p>
						<div className="flex items-center justify-center">
							<span
								className="font-mono text-7xl sm:text-9xl font-black text-accent animate-pulse tabular-nums"
								aria-hidden="true"
							>
								{countdown}
							</span>
							<span className="sr-only">開始まであと{countdown}秒</span>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={handleSkipCountdown}
							className="mt-1 text-xs sm:text-sm h-7 sm:h-8"
						>
							今すぐ開始
						</Button>
					</div>
				) : (
					<p
						className="font-mono text-6xl sm:text-8xl font-black tabular-nums tracking-tight text-foreground"
						style={{ fontVariantNumeric: 'tabular-nums' }}
						data-testid="guide-timer"
					>
						{formatClock(elapsedSec)}
					</p>
				)}

				{/* テスト互換性およびDOM読み取り用の不可視タイマー（カウントダウン中） */}
				{isCountdownActive && (
					<span className="sr-only" data-testid="guide-timer">
						{formatClock(0)}
					</span>
				)}

				{currentStep && (
					<div className="space-y-1 sm:space-y-2">
						{currentStep.action_type === 'pour' &&
						currentStep.pour_amount_ml > 0 ? (
							<p className="text-lg sm:text-2xl text-muted-foreground font-medium">
								このステップで{' '}
								<span className="text-2xl sm:text-4xl font-black text-foreground underline decoration-accent decoration-2 underline-offset-4">
									+{currentStep.pour_amount_ml}g
								</span>{' '}
								注湯
							</p>
						) : null}

						{totalWaterMl > 0 && (
							<div className="flex items-center justify-center gap-2 text-sm sm:text-lg font-semibold text-muted-foreground">
								<span>スケール目標:</span>
								<span className="text-xl sm:text-2xl font-black text-foreground font-mono tabular-nums">
									{currentCumulativeMl}g
								</span>
								<span className="text-xs sm:text-sm text-muted-foreground font-mono tabular-nums">
									/ {totalWaterMl}g（合計）
								</span>
							</div>
						)}
					</div>
				)}

				{getStepHint(currentStep) && (
					<p className="text-xs sm:text-sm text-foreground/90 bg-muted/40 rounded-xl px-3 py-1.5 max-w-md">
						{getStepHint(currentStep)}
					</p>
				)}

				{steps[stepIndex + 1] && (
					<p className="text-xs sm:text-sm font-semibold text-muted-foreground">
						次: {steps[stepIndex + 1].label}（
						{formatClock(steps[stepIndex + 1].time_sec)}〜）
					</p>
				)}

				{wakeLockStatus === 'unsupported' || wakeLockStatus === 'failed' ? (
					<p className="text-xs text-muted-foreground" role="status">
						画面の自動消灯を防止できませんでした。端末の設定でスリープを延長してください。
					</p>
				) : null}
			</div>

			<div className="shrink-0 border-t border-border px-4 pt-3 pb-4 sm:pb-6 space-y-3 sm:space-y-4 sm:px-6">
				<div
					className="relative h-3 w-full overflow-hidden rounded-full bg-muted"
					aria-hidden="true"
				>
					<div
						className="h-full bg-accent transition-[width] duration-100 ease-linear"
						style={{ width: `${progressPercent}%` }}
					/>
					{totalDurationSec > 0 &&
						steps.slice(1, -1).map((step) => {
							const tickPercent = (step.time_sec / totalDurationSec) * 100;
							const passed = tickPercent <= progressPercent;
							return (
								<span
									key={`${step.step_order}-${step.label}`}
									className={`absolute top-0 h-full w-0.5 ${passed ? 'bg-background/90' : 'bg-foreground/40'}`}
									style={{ left: `${tickPercent}%` }}
								/>
							);
						})}
				</div>

				<div
					className="relative h-4 w-full text-xs sm:text-sm font-medium text-muted-foreground tabular-nums"
					aria-hidden="true"
				>
					<span className="absolute left-0 top-0">0:00</span>
					{totalDurationSec > 0 &&
						steps.slice(1, -1).map((step) => {
							const tickPercent = (step.time_sec / totalDurationSec) * 100;
							const passed = tickPercent <= progressPercent;
							return (
								<span
									key={`time-${step.step_order}-${step.label}`}
									className={`absolute top-0 -translate-x-1/2 transition-colors ${
										passed
											? 'text-foreground font-bold'
											: 'text-muted-foreground'
									}`}
									style={{ left: `${tickPercent}%` }}
								>
									{formatClock(step.time_sec)}
								</span>
							);
						})}
					<span className="absolute right-0 top-0">
						{formatClock(totalDurationSec)}
					</span>
				</div>

				<div className="flex flex-col items-center gap-3">
					<div className="flex items-center justify-center gap-4 w-full">
						<Button
							variant="outline"
							size="icon"
							className="size-12 sm:size-14"
							onClick={handleRestart}
							aria-label="最初から"
						>
							<RotateCcw className="h-5 w-5" />
						</Button>
						<Button
							size="lg"
							onClick={handlePauseResume}
							className="h-12 sm:h-14 min-w-36 sm:min-w-44 text-base sm:text-lg font-bold"
						>
							{isCountdownActive ? (
								<>
									<Play className="h-5 w-5" />
									今すぐ開始
								</>
							) : session.status === 'running' ? (
								<>
									<Pause className="h-5 w-5" />
									一時停止
								</>
							) : (
								<>
									<Play className="h-5 w-5" />
									再開
								</>
							)}
						</Button>
						<Button
							variant="outline"
							size="icon"
							className="size-12 sm:size-14"
							onClick={() =>
								updateSettings({ soundEnabled: !settings.soundEnabled })
							}
							aria-label={
								settings.soundEnabled
									? '効果音をオフにする'
									: '効果音をオンにする'
							}
						>
							{settings.soundEnabled ? (
								<Volume2 className="h-5 w-5" />
							) : (
								<VolumeX className="h-5 w-5" />
							)}
						</Button>
					</div>

					{settings.soundEnabled && (
						<div className="flex items-center justify-center gap-2 w-full max-w-xs px-2 text-xs sm:text-sm text-muted-foreground">
							<Volume1 className="h-4 w-4 shrink-0" />
							<input
								type="range"
								min="0"
								max="100"
								value={settings.soundVolume ?? 50}
								onChange={(e) => handleVolumeChange(Number(e.target.value))}
								className="w-full accent-primary h-2 bg-muted rounded-lg cursor-pointer"
								aria-label="音量"
							/>
							<span className="w-9 text-right font-mono text-xs sm:text-sm tabular-nums font-semibold">
								{settings.soundVolume ?? 50}%
							</span>
						</div>
					)}
				</div>

				<Button
					className="h-12 sm:h-14 w-full text-lg sm:text-xl font-bold"
					size="lg"
					onClick={handleComplete}
					data-testid="guide-complete-button"
				>
					抽出完了
				</Button>
			</div>

			<Dialog open={showAbortConfirm} onOpenChange={setShowAbortConfirm}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>抽出を中断しますか？</DialogTitle>
						<DialogDescription>
							ここまでの内容を記録に残すか、破棄するかを選んでください。
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="gap-3">
						<Button
							variant="outline"
							className="h-11"
							onClick={() => setShowAbortConfirm(false)}
						>
							キャンセル
						</Button>
						<Button
							variant="destructive"
							className="h-11"
							onClick={handleAbortDiscard}
						>
							破棄する
						</Button>
						<Button className="h-11" onClick={handleAbortRecord}>
							記録する
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={pendingJumpStepIndex !== null}
				onOpenChange={(open) => !open && setPendingJumpStepIndex(null)}
			>
				{pendingJumpStepIndex !== null && steps[pendingJumpStepIndex] && (
					<DialogContent>
						<DialogHeader>
							<DialogTitle>
								STEP {pendingJumpStepIndex + 1}:{' '}
								{steps[pendingJumpStepIndex].label} に移動しますか？
							</DialogTitle>
							<DialogDescription>
								タイマーの時間を{' '}
								{formatClock(steps[pendingJumpStepIndex].time_sec)}{' '}
								に合わせて、このステップから再開します。
							</DialogDescription>
						</DialogHeader>
						<DialogFooter className="gap-3">
							<Button
								variant="outline"
								className="h-11"
								onClick={() => setPendingJumpStepIndex(null)}
							>
								キャンセル
							</Button>
							<Button className="h-11" onClick={handleConfirmJump}>
								移動する
							</Button>
						</DialogFooter>
					</DialogContent>
				)}
			</Dialog>
		</div>
	);

	if (typeof document === 'undefined') return null;
	return createPortal(guide, document.body);
}
