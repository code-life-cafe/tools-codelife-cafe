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
import type {
	BrewSession,
	Recipe,
	RecipeStep,
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

function playBeep(ctx: AudioContext) {
	try {
		const oscillator = ctx.createOscillator();
		const gain = ctx.createGain();
		oscillator.type = 'sine';
		oscillator.frequency.value = 880;
		gain.gain.setValueAtTime(0.15, ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
		oscillator.connect(gain);
		gain.connect(ctx.destination);
		oscillator.start();
		oscillator.stop(ctx.currentTime + 0.35);
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
	});
	const [showAbortConfirm, setShowAbortConfirm] = useState(false);
	const [wakeLockStatus, setWakeLockStatus] = useState<
		'idle' | 'active' | 'unsupported' | 'failed'
	>('idle');
	const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
	const lastStepIndexRef = useRef<number>(session.currentStepIndex);

	useEffect(() => {
		saveSession(session);
	}, [session]);

	useEffect(() => {
		if (session.status !== 'running') return;
		const id = setInterval(() => setNowMs(Date.now()), 250);
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
	const totalDurationSec = steps[steps.length - 1]?.time_sec ?? 0;
	const progressPercent =
		totalDurationSec > 0
			? Math.min(100, Math.round((elapsedSec / totalDurationSec) * 100))
			: 0;

	useEffect(() => {
		if (stepIndex === lastStepIndexRef.current) return;
		lastStepIndexRef.current = stepIndex;
		setSession((prev) => ({ ...prev, currentStepIndex: stepIndex }));
		if (settings.soundEnabled && audioContext) {
			playBeep(audioContext);
		}
	}, [stepIndex, settings.soundEnabled, audioContext]);

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

				{currentStep &&
					currentStep.action_type === 'pour' &&
					currentStep.pour_amount_ml > 0 && (
						<p className="text-lg text-muted-foreground">
							このステップで{' '}
							<span className="font-semibold text-foreground">
								{currentStep.pour_amount_ml}g
							</span>{' '}
							注湯
						</p>
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
						className="h-full bg-accent transition-all"
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
									className={`absolute top-0 h-full w-0.5 ${passed ? 'bg-background/80' : 'bg-foreground/25'}`}
									style={{ left: `${tickPercent}%` }}
								/>
							);
						})}
				</div>
				<div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
					<span>0:00</span>
					<span>{formatClock(totalDurationSec)}</span>
				</div>

				<div className="flex items-center justify-center gap-3">
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
