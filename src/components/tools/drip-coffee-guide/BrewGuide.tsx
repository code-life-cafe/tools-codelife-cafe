import { Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
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

	const circleRadius = 44;
	const circumference = 2 * Math.PI * circleRadius;
	const strokeDashoffset =
		circumference *
		(1 - (totalDurationMs > 0 ? Math.min(1, elapsedMs / totalDurationMs) : 0));

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
			className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
			style={{ height: '100dvh' }}
		>
			{/* ヘッダー: 画面上部に固定 */}
			<header className="shrink-0 flex items-center justify-between border-b border-border px-4 py-2.5 sm:py-3 sm:px-6 bg-background/95 backdrop-blur">
				<div>
					<p className="text-xs font-semibold tracking-wider text-accent">
						LIVE GUIDE
					</p>
					<h2 className="text-sm sm:text-base font-bold truncate max-w-xs sm:max-w-md">
						{recipe.name}
					</h2>
				</div>
				<Button
					variant="outline"
					size="sm"
					className="h-8 sm:h-9 text-xs sm:text-sm font-medium gap-1.5"
					onClick={() => setShowAbortConfirm(true)}
				>
					<X className="h-4 w-4" />
					<span>中断</span>
				</Button>
			</header>

			{/* メイン: デスクトップはSplit Deck（左右2分割）、モバイルは縦スタック */}
			<main className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col lg:grid lg:grid-cols-12 max-w-6xl mx-auto w-full">
				{/* 左側: 現在ステップ + 円形タイマー + 注湯指示 */}
				<section className="flex-1 lg:col-span-7 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 text-center min-h-0 lg:overflow-y-auto">
					<div className="mb-2 sm:mb-3">
						<p className="text-xs sm:text-sm font-bold text-accent tracking-wide">
							STEP {stepIndex + 1} / {steps.length}
						</p>
						<h3 className="mt-0.5 text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-foreground">
							{currentStep?.label}
						</h3>
					</div>

					{/* 円形タイマー */}
					<div className="my-2 sm:my-4 relative flex items-center justify-center">
						<div className="relative size-44 sm:size-52 lg:size-60 flex items-center justify-center">
							<svg
								className="size-full -rotate-90"
								viewBox="0 0 100 100"
								aria-hidden="true"
							>
								{/* 背景トラック */}
								<circle
									cx="50"
									cy="50"
									r={circleRadius}
									className="stroke-muted"
									strokeWidth="6"
									fill="none"
								/>
								{/* プログレスリング */}
								<circle
									cx="50"
									cy="50"
									r={circleRadius}
									className="stroke-accent transition-[stroke-dashoffset] duration-100 ease-linear motion-reduce:transition-none"
									strokeWidth="6"
									strokeLinecap="round"
									fill="none"
									style={{
										strokeDasharray: circumference,
										strokeDashoffset,
									}}
								/>
							</svg>

							{/* タイマー中央コンテンツ */}
							<div className="absolute inset-0 flex flex-col items-center justify-center">
								{isCountdownActive ? (
									<div
										className="flex flex-col items-center justify-center gap-1"
										data-testid="guide-countdown"
									>
										<p className="text-[11px] sm:text-xs font-semibold text-muted-foreground">
											準備
										</p>
										<span
											className="font-mono text-5xl sm:text-6xl font-black text-accent tabular-nums animate-pulse"
											aria-hidden="true"
										>
											{countdown}
										</span>
										<span className="sr-only">開始まであと{countdown}秒</span>
										<Button
											variant="outline"
											size="sm"
											onClick={handleSkipCountdown}
											className="mt-1 text-xs h-7 px-2.5"
										>
											今すぐ開始
										</Button>
									</div>
								) : (
									<div className="flex flex-col items-center justify-center">
										<span
											className="font-mono text-4xl sm:text-5xl lg:text-6xl font-black tabular-nums tracking-tight text-foreground"
											style={{ fontVariantNumeric: 'tabular-nums' }}
											data-testid="guide-timer"
										>
											{formatClock(elapsedSec)}
										</span>
										{totalDurationSec > 0 && (
											<span className="text-xs sm:text-sm font-mono font-semibold text-muted-foreground tabular-nums mt-0.5">
												/ {formatClock(totalDurationSec)}
											</span>
										)}
									</div>
								)}

								{/* テスト互換性およびDOM読み取り用の不可視タイマー（カウントダウン中） */}
								{isCountdownActive && (
									<span className="sr-only" data-testid="guide-timer">
										{formatClock(0)}
									</span>
								)}
							</div>
						</div>
					</div>

					{/* 注湯指示（累計gのみ） */}
					<div className="space-y-1.5 sm:space-y-2 max-w-md w-full">
						{currentStep && (
							<div>
								{currentStep.action_type === 'pour' &&
								currentStep.pour_amount_ml > 0 ? (
									<p className="text-base sm:text-lg lg:text-xl text-muted-foreground font-medium">
										このステップで{' '}
										<span className="text-2xl sm:text-3xl lg:text-4xl font-black text-foreground underline decoration-accent decoration-2 underline-offset-4 font-mono tabular-nums">
											{currentCumulativeMl}g
										</span>{' '}
										まで注ぐ
									</p>
								) : currentStep.action_type === 'finish' ? (
									<p className="text-base sm:text-lg lg:text-xl font-bold text-foreground">
										お湯が落ちきったら「抽出完了」
									</p>
								) : (
									<p className="text-base sm:text-lg lg:text-xl font-medium text-muted-foreground">
										{currentStep.label}
									</p>
								)}
							</div>
						)}

						{getStepHint(currentStep) && (
							<p className="text-xs sm:text-sm text-foreground/85 bg-muted/50 rounded-lg px-3 py-1.5 inline-block">
								{getStepHint(currentStep)}
							</p>
						)}

						{steps[stepIndex + 1] && (
							<p className="text-xs sm:text-sm font-medium text-muted-foreground">
								次: {steps[stepIndex + 1].label}（
								{formatClock(steps[stepIndex + 1].time_sec)}〜）
							</p>
						)}

						{wakeLockStatus === 'unsupported' || wakeLockStatus === 'failed' ? (
							<p className="text-xs text-muted-foreground pt-1" role="status">
								画面の自動消灯を防止できませんでした。端末の設定でスリープを延長してください。
							</p>
						) : null}
					</div>
				</section>

				{/* 右側: 全ステップ一覧（モバイルでは下部） */}
				<section
					aria-label="ステップ一覧"
					className="border-t lg:border-t-0 lg:border-l border-border lg:col-span-5 flex flex-col p-4 sm:p-5 lg:p-6 min-h-0 bg-muted/20 overflow-y-auto"
				>
					<div className="flex items-center justify-between mb-3 shrink-0">
						<h4 className="text-xs font-bold text-muted-foreground tracking-wider uppercase">
							ステップ一覧
						</h4>
						<span className="text-xs text-muted-foreground font-mono">
							目標合計: {totalWaterMl}g
						</span>
					</div>

					<ol className="space-y-2 m-0 p-0 list-none flex-1 overflow-y-auto">
						{steps.map((step, i) => {
							const isActive = i === stepIndex;
							const isPassed = i < stepIndex;
							const stepCumulativeMl = computeCumulativeWaterMl(steps, i);

							return (
								<li key={`${step.step_order}-${step.label}`}>
									<button
										type="button"
										onClick={() => setPendingJumpStepIndex(i)}
										disabled={isActive}
										aria-current={isActive ? 'step' : undefined}
										className={`w-full text-left flex items-center justify-between p-3 rounded-xl transition-all border ${
											isActive
												? 'bg-card border-accent shadow-sm ring-1 ring-accent'
												: isPassed
													? 'bg-muted/40 border-transparent text-muted-foreground hover:bg-muted/70 hover:border-border'
													: 'bg-card/60 border-border/50 text-foreground hover:bg-card hover:border-border'
										}`}
									>
										<div className="flex items-center gap-3">
											<span
												className={`size-6 sm:size-7 rounded-full flex items-center justify-center text-xs sm:text-sm font-mono font-bold shrink-0 ${
													isActive
														? 'bg-accent text-accent-foreground'
														: isPassed
															? 'bg-muted text-muted-foreground'
															: 'bg-muted/80 text-foreground'
												}`}
											>
												{i + 1}
											</span>
											<div>
												<p
													className={`text-sm font-bold ${
														isActive
															? 'text-foreground'
															: isPassed
																? 'text-muted-foreground line-through'
																: 'text-foreground'
													}`}
												>
													{step.label}
												</p>
												<p className="text-xs font-mono text-muted-foreground tabular-nums">
													{formatClock(step.time_sec)}〜
												</p>
											</div>
										</div>

										<div className="text-right">
											{step.action_type === 'pour' &&
											step.pour_amount_ml > 0 ? (
												<span
													className={`font-mono text-sm sm:text-base font-bold tabular-nums ${
														isActive
															? 'text-accent'
															: isPassed
																? 'text-muted-foreground'
																: 'text-foreground'
													}`}
												>
													{stepCumulativeMl}g
												</span>
											) : (
												<span className="text-xs text-muted-foreground font-medium">
													{step.action_type === 'finish' ? '完了' : '—'}
												</span>
											)}
										</div>
									</button>
								</li>
							);
						})}
					</ol>
				</section>
			</main>

			{/* 操作ドック: 画面最下部に固定 */}
			<footer className="shrink-0 border-t border-border bg-background px-4 py-3 sm:py-4 sm:px-6">
				<div className="max-w-xl mx-auto flex items-center justify-between gap-2.5 sm:gap-4">
					{/* 最初から */}
					<Button
						variant="outline"
						size="icon"
						className="size-11 sm:size-12 shrink-0 rounded-xl"
						onClick={handleRestart}
						aria-label="最初から"
					>
						<RotateCcw className="size-5" />
					</Button>

					{/* 主操作：一時停止 / 再開 */}
					<Button
						size="lg"
						onClick={handlePauseResume}
						className="flex-1 h-11 sm:h-12 text-sm sm:text-base font-bold rounded-xl shadow-sm gap-2"
					>
						{isCountdownActive ? (
							<>
								<Play className="size-5" />
								<span>今すぐ開始</span>
							</>
						) : session.status === 'running' ? (
							<>
								<Pause className="size-5" />
								<span>一時停止</span>
							</>
						) : (
							<>
								<Play className="size-5" />
								<span>再開</span>
							</>
						)}
					</Button>

					{/* 音声トグル */}
					<Button
						variant="outline"
						size="icon"
						className="size-11 sm:size-12 shrink-0 rounded-xl"
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
							<Volume2 className="size-5" />
						) : (
							<VolumeX className="size-5 text-muted-foreground" />
						)}
					</Button>

					{/* 抽出完了: 二次ボタン（誤タップ防止） */}
					<Button
						variant="secondary"
						className="h-11 sm:h-12 px-3.5 sm:px-5 text-xs sm:text-sm font-bold rounded-xl border border-border shrink-0 hover:bg-secondary/80"
						onClick={handleComplete}
						data-testid="guide-complete-button"
					>
						抽出完了
					</Button>
				</div>
			</footer>

			{/* 中断確認ダイアログ */}
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

			{/* ステップ移動確認ダイアログ */}
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
