import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {
	type Brew,
	calcBrewRatio,
	calcEy,
	type MethodId,
} from '@/lib/tools/drip-coffee-guide';

const METHOD_LABELS: Record<MethodId, string> = {
	v60: 'V60',
	switch: 'Switch',
	kalita: 'カリタ',
	pour_other: 'その他',
};

function formatDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	});
}

function formatClock(totalSec: number): string {
	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	return `${min}:${sec.toString().padStart(2, '0')}`;
}

interface BrewHistoryProps {
	brews: readonly Brew[];
	onEdit: (brew: Brew) => void;
	onDelete: (id: string) => void;
}

export function BrewHistory({ brews, onEdit, onDelete }: BrewHistoryProps) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const sorted = [...brews].sort((a, b) =>
		b.brewed_at.localeCompare(a.brewed_at),
	);
	const selected = sorted.find((b) => b.id === selectedId) ?? null;

	if (sorted.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
				まだ記録がありません。「抽出」タブから最初の一杯を記録しましょう。
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
				{sorted.map((brew) => {
					const ratio = calcBrewRatio(brew.dose_g, brew.yield_g);
					return (
						<li key={brew.id}>
							<button
								type="button"
								className="w-full px-4 py-3.5 text-left hover:bg-muted/50 transition-colors"
								onClick={() => setSelectedId(brew.id)}
							>
								<div className="space-y-1.5">
									{/* 1行目: 豆名 & 抽出量 / レシオ */}
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0 flex-1">
											<p className="truncate font-semibold text-base">
												{brew.bean_name}
											</p>
										</div>
										<div className="shrink-0 text-right">
											<span className="font-mono text-sm font-semibold tabular-nums">
												{brew.dose_g}g → {brew.yield_g}g
											</span>
											{ratio !== undefined && (
												<span className="ml-2 text-xs font-mono text-muted-foreground tabular-nums">
													(1:{ratio.toFixed(1)})
												</span>
											)}
										</div>
									</div>

									{/* 2行目: 日時・メソッド・レシピ・挽き目・湯温・抽出時間 */}
									<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
										<span>{formatDate(brew.brewed_at)}</span>
										<span>・</span>
										<span className="font-medium text-foreground">
											{METHOD_LABELS[brew.method]}
										</span>
										{brew.recipe_name && (
											<>
												<span>・</span>
												<span>{brew.recipe_name}</span>
											</>
										)}
										{brew.grind_note && (
											<>
												<span>・</span>
												<span>挽き目: {brew.grind_note}</span>
											</>
										)}
										{brew.water_temp_c !== undefined && (
											<>
												<span>・</span>
												<span>{brew.water_temp_c}℃</span>
											</>
										)}
										{brew.brew_time_sec > 0 && (
											<>
												<span>・</span>
												<span className="font-mono tabular-nums">
													時間: {formatClock(brew.brew_time_sec)}
												</span>
											</>
										)}
									</div>

									{/* 3行目: 評価スコア・メモプレビュー */}
									{(brew.overall_score !== undefined || brew.notes) && (
										<div className="flex items-center gap-3 pt-0.5 text-xs">
											{brew.overall_score !== undefined && (
												<span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600 dark:text-amber-400 shrink-0">
													★ {brew.overall_score} / 10
												</span>
											)}
											{brew.notes && (
												<p className="truncate text-muted-foreground italic flex-1">
													“{brew.notes}”
												</p>
											)}
										</div>
									)}
								</div>
							</button>
						</li>
					);
				})}
			</ul>

			<Dialog
				open={selected !== null}
				onOpenChange={(next) => !next && setSelectedId(null)}
			>
				{selected && (
					<DialogContent className="max-h-[85vh] overflow-y-auto">
						<DialogHeader>
							<DialogTitle>{selected.bean_name}</DialogTitle>
						</DialogHeader>
						<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
							<DetailRow label="日時" value={formatDate(selected.brewed_at)} />
							<DetailRow
								label="メソッド"
								value={METHOD_LABELS[selected.method]}
							/>
							<DetailRow label="レシピ" value={selected.recipe_name ?? '—'} />
							<DetailRow label="豆量" value={`${selected.dose_g}g`} />
							<DetailRow label="抽出量" value={`${selected.yield_g}g`} />
							<DetailRow
								label="総湯量"
								value={
									selected.water_amount_ml !== undefined
										? `${selected.water_amount_ml}ml`
										: '—'
								}
							/>
							<DetailRow
								label="湯温"
								value={
									selected.water_temp_c !== undefined
										? `${selected.water_temp_c}℃`
										: '—'
								}
							/>
							<DetailRow
								label="蒸らし"
								value={
									selected.bloom_time_sec !== undefined
										? `${selected.bloom_time_sec}秒`
										: '—'
								}
							/>
							<DetailRow label="挽き目" value={selected.grind_note ?? '—'} />
							<DetailRow
								label="抽出時間"
								value={`${selected.brew_time_sec}秒`}
							/>
							<DetailRow
								label="レシオ"
								value={(() => {
									const r = calcBrewRatio(selected.dose_g, selected.yield_g);
									return r !== undefined ? `1 : ${r.toFixed(1)}` : '—';
								})()}
							/>
							<DetailRow
								label="EY"
								value={(() => {
									const ey = calcEy(
										selected.dose_g,
										selected.yield_g,
										selected.tds,
									);
									return ey !== undefined ? `${ey.toFixed(1)}%` : '—';
								})()}
							/>
							<DetailRow
								label="TDS"
								value={selected.tds !== undefined ? `${selected.tds}%` : '—'}
							/>
							<DetailRow
								label="点数"
								value={
									selected.overall_score !== undefined
										? `${selected.overall_score}/10`
										: '—'
								}
							/>
						</dl>
						{selected.notes && (
							<div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
								{selected.notes}
							</div>
						)}
						<DialogFooter>
							<Button
								variant="destructive"
								onClick={() => setConfirmDeleteId(selected.id)}
							>
								削除
							</Button>
							<Button
								onClick={() => {
									onEdit(selected);
									setSelectedId(null);
								}}
							>
								編集
							</Button>
						</DialogFooter>
					</DialogContent>
				)}
			</Dialog>

			<Dialog
				open={confirmDeleteId !== null}
				onOpenChange={(next) => !next && setConfirmDeleteId(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>この記録を削除しますか？</DialogTitle>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
							キャンセル
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								if (confirmDeleteId) {
									onDelete(confirmDeleteId);
									setConfirmDeleteId(null);
									setSelectedId(null);
								}
							}}
						>
							削除する
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="text-right">{value}</dd>
		</>
	);
}
