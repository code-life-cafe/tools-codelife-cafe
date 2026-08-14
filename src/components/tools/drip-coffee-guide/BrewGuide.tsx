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
			status: 'running',
		},
	);
	const [nowMs, setNowMs] = useState(Date.now());
	const [settings, updateSettings] = useToolSettings('drip-coffee-guide', {
		soundEnabled: true,
		soundVolume: 50,
	});
	const [showAbortConfirm, setShowAbortConfirm] = useState(false);
	const [wakeLockStatus, setWakeLockStatus] = useState<
		'idle' | 'active' | 'unsupported' | 'failed'
	>('idle');
	const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
	const lastStepIndexRef = useRef<number>(session.currentStepIndex);
	const lastCountdownSecRef = useRef<number | null>(null);

	useEffect(() => {
		saveSession(session);
	}, [session]);

	useEffect(() => {
		if (session.status !== 'running') return;
		const id = setInterval(() => setNowMs(Date.now()), 100);
		return () => clearInterval(id);
	}, [session.status]);

	// Wake Lock: 対応していない・取得に失敗してもガイドは止めず、状態表示のみ行う
	useEffect(() => {
		let cancelled = false;
		async function acquire() {
			const nav = navigator as Navigator & {
				wakeLock?: {
					request: (
						type: 'screen',
					) => Promise<{ release: () => Promise<void> }>;
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
				wakeLockRef.current = lock;
				setWakeLockStatus('active');
			} catch {
				setWakeLockStatus('failed');
			}
		}
		if (session.status === 'running') {
			acquire();
		}
		return () => {
			cancelled = true;
		};
	}, [session.status]);

	useEffect(() => {
		function handleVisibilityChange() {
			if (document.visibilityState !== 'visible') return;
			if (session.status !== 'running') return;
			if (wakeLockRef.current) return;
			const nav = navigator as Navigator & {
				wakeLock?: {
					request: (
						type: 'screen',
					) => Promise<{ release: () => Promise<void> }>;
				};
			};
			nav.wakeLock
				?.request('screen')
				.then((lock) => {
					wakeLockRef.current = lock;
					setWakeLockStatus('active');
				})
				.catch(() => setWakeLockStatus('failed'));
		}
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () =>
			document.removeEventListener('visibilitychange', handleVisibilityChange);
	}, [session.status]);

	useEffect(() => {
		return () => {
			wakeLockRef.current?.release().catch(() => {});
			wakeLockRef.current = null;
		};
	}, []);

	const elapsedMs = computeElapsedMs(session, nowMs);
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
		if (stepIndex === lastStepIndexRef.current) return;
		lastStepIndexRef.current = stepIndex;
		lastCountdownSecRef.current = null;
		setSession((prev) => ({ ...prev, currentStepIndex: stepIndex }));
		if (settings.soundEnabled && audioContext) {
			playBeep(audioContext, 'step', settings.soundVolume ?? 50);
		}
	}, [stepIndex, settings.soundEnabled, settings.soundVolume, audioContext]);

	// 次のメモリ（ステップ切替）到達直前（残り3秒、2秒、1秒）の予告時報音
	useEffect(() => {
		if (session.status !== 'running') return;
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
		settings.soundEnabled,
		settings.soundVolume,
		audioContext,
		stepIndex,
		steps,
	]);

	const handlePauseResume = () => {
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
		setSession({
			recipeId: recipe.id,
			startedAtUnix: Date.now(),
			pausedElapsedMs: 0,
			currentStepIndex: 0,
			scaledDoseG: actualDoseG,
			status: 'running',
		});
		lastStepIndexRef.current = 0;
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

	const guide = (
		<div
			className="fixed inset-0 z-50 flex flex-col bg-background"
			style={{ height: '100dvh' }}
		>
			<header className="flex items-center justify-between border-b border-border px-4 py-3">
				<div>
					<p className="text-xs font-medium text-accent">LIVE GUIDE</p>
					<h2 className="text-sm font-semibold">{recipe.name}</h2>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => setShowAbortConfirm(true)}
				>
					<X className="h-4 w-4" />
					中断する
				</Button>
			</header>

			<div
				className="overflow-x-auto border-b border-border px-4 py-2"
				aria-hidden="true"
			>
				<ol className="m-0 flex min-w-max list-none gap-1.5 p-0">
					{steps.map((step, i) => (
						<li
							key={`${step.step_order}-${step.label}`}
							className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs whitespace-nowrap ${
								i === stepIndex
									? 'bg-accent text-accent-foreground font-semibold'
									: i < stepIndex
										? 'bg-muted text-muted-foreground line-through'
										: 'bg-muted/50 text-muted-foreground'
							}`}
						>
							<span>{i + 1}</span>
							<span>{step.label}</span>
						</li>
					))}
				</ol>
			</div>

			<div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-6 text-center">
				<div aria-live="polite">
					<p className="text-sm font-medium text-muted-foreground">
						STEP {stepIndex + 1} / {steps.length}
					</p>
					<p className="mt-1 text-2xl font-bold">{currentStep?.label}</p>
				</div>

				<p
					className="font-mono text-6xl sm:text-7xl font-bold tabular-nums"
					style={{ fontVariantNumeric: 'tabular-nums' }}
					data-testid="guide-timer"
				>
					{formatClock(elapsedSec)}
				</p>

				{currentStep && (
					<div className="space-y-1">
						{currentStep.action_type === 'pour' &&
						currentStep.pour_amount_ml > 0 ? (
							<p className="text-lg text-muted-foreground">
								このステップで{' '}
								<span className="font-semibold text-foreground">
									+{currentStep.pour_amount_ml}g
								</span>{' '}
								注湯
							</p>
						) : null}

						{totalWaterMl > 0 && (
							<div className="flex items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground">
								<span>スケール目標:</span>
								<span className="text-base font-bold text-foreground font-mono tabular-nums">
									{currentCumulativeMl}g
								</span>
								<span className="text-xs text-muted-foreground font-mono tabular-nums">
									/ {totalWaterMl}g（合計）
								</span>
							</div>
						)}
					</div>
				)}

				{getStepHint(currentStep) && (
					<p className="text-sm text-muted-foreground">
						{getStepHint(currentStep)}
					</p>
				)}

				{steps[stepIndex + 1] && (
					<p className="text-xs text-muted-foreground">
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

			<div className="border-t border-border px-4 py-4 space-y-3">
				<div
					className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
					aria-hidden="true"
				>
					<div
						className="h-full bg-accent transition-[width] duration-100 ease-linear"
						style={{ width: `${progressPercent}%` }}
					/>
					{/* マイルストーン: 各ステップの開始位置に目印を置き、次のアクションまでの
					    距離をひと目で把握できるようにする（始点・終点は縁と重なるため除外）。
					    到達済み（塗り部分）と未到達（トラック部分）で背景色が近いため、
					    どちら側にあるかで目印の色を切り替えてコントラストを保つ */}
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
					className="relative h-4 w-full text-[10px] text-muted-foreground tabular-nums"
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
											? 'text-foreground font-medium'
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

				<div className="flex flex-col items-center gap-2">
					<div className="flex items-center justify-center gap-3 w-full">
						<Button
							variant="outline"
							size="icon"
							onClick={handleRestart}
							aria-label="最初から"
						>
							<RotateCcw className="h-4 w-4" />
						</Button>
						<Button size="lg" onClick={handlePauseResume} className="min-w-32">
							{session.status === 'running' ? (
								<>
									<Pause className="h-4 w-4" />
									一時停止
								</>
							) : (
								<>
									<Play className="h-4 w-4" />
									再開
								</>
							)}
						</Button>
						<Button
							variant="outline"
							size="icon"
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
								<Volume2 className="h-4 w-4" />
							) : (
								<VolumeX className="h-4 w-4" />
							)}
						</Button>
					</div>

					{settings.soundEnabled && (
						<div className="flex items-center justify-center gap-2 w-full max-w-xs px-2 text-xs text-muted-foreground">
							<Volume1 className="h-3.5 w-3.5 shrink-0" />
							<input
								type="range"
								min="0"
								max="100"
								value={settings.soundVolume ?? 50}
								onChange={(e) =>
									updateSettings({ soundVolume: Number(e.target.value) })
								}
								className="w-full accent-primary h-1.5 bg-muted rounded-lg cursor-pointer"
								aria-label="音量"
							/>
							<span className="w-8 text-right font-mono text-[11px] tabular-nums">
								{settings.soundVolume ?? 50}%
							</span>
						</div>
					)}
				</div>

				<Button
					className="w-full"
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
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setShowAbortConfirm(false)}
						>
							キャンセル
						</Button>
						<Button variant="destructive" onClick={handleAbortDiscard}>
							破棄する
						</Button>
						<Button onClick={handleAbortRecord}>記録する</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);

	if (typeof document === 'undefined') return null;
	return createPortal(guide, document.body);
}
