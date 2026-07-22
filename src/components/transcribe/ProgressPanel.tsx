// ProgressPanel — 3フェーズ進捗表示（モデルDL% → デコード中 → 推論%／経過時間）
//
// decodeAudioData は信頼できる途中パーセンテージを返さないため、
// デコード中はインデターミネート表示とする（正本「詳細設計書 8.」）。

import { Loader2 } from 'lucide-react';
import type { TranscribeState } from '@/lib/transcribe/protocol';

type ProgressPanelProps = {
	state: TranscribeState;
};

const PHASES = [
	{ key: 'loading-model', label: 'モデル取得' },
	{ key: 'decoding', label: '音声デコード' },
	{ key: 'transcribing', label: '文字起こし' },
] as const;

function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const m = Math.floor(total / 60);
	const s = total % 60;
	return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`;
}

export function ProgressPanel({ state }: ProgressPanelProps) {
	let index = -1;
	let percent: number | null = null;
	let detail = '';

	if (state.phase === 'loading-model') {
		index = 0;
		percent = state.progress;
		detail = `モデルをダウンロードしています（${Math.round(state.progress)}%）`;
	} else if (state.phase === 'decoding') {
		index = 1;
		detail = '音声をデコードしています…';
	} else if (state.phase === 'transcribing') {
		index = 2;
		percent = state.progress;
		detail =
			state.progress !== null
				? `文字起こし中（${Math.round(state.progress)}%・経過 ${formatElapsed(state.elapsedMs)}）`
				: `文字起こし中（経過 ${formatElapsed(state.elapsedMs)}）`;
	}

	if (index < 0) return null;

	return (
		<div
			className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4"
			data-testid="transcribe-progress"
		>
			<ol className="flex flex-wrap items-center gap-2 text-xs">
				{PHASES.map((phase, i) => (
					<li key={phase.key} className="flex items-center gap-2">
						<span
							className={
								i < index
									? 'text-muted-foreground'
									: i === index
										? 'font-medium text-foreground'
										: 'text-muted-foreground/60'
							}
						>
							{i + 1}. {phase.label}
						</span>
						{i < PHASES.length - 1 && (
							<span aria-hidden="true" className="text-muted-foreground/40">
								›
							</span>
						)}
					</li>
				))}
			</ol>

			<div
				className="h-2 w-full overflow-hidden rounded-full bg-muted"
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent === null ? undefined : Math.round(percent)}
				aria-label={PHASES[index].label}
			>
				<div
					className={
						percent === null
							? 'h-full w-1/3 animate-pulse rounded-full bg-primary'
							: 'h-full rounded-full bg-primary transition-[width] duration-300'
					}
					style={percent === null ? undefined : { width: `${percent}%` }}
				/>
			</div>

			<p
				className="flex items-center gap-2 text-sm text-muted-foreground"
				aria-live="polite"
			>
				<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
				<span data-testid="transcribe-progress-detail">{detail}</span>
			</p>
			<p className="text-xs text-muted-foreground">
				タブを非アクティブにしても処理は続きます。ページを閉じると中断されます。
			</p>
		</div>
	);
}
