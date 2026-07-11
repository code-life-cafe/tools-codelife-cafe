import { AlertTriangle, Dices, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import {
	formatUuid,
	GENERATABLE_ID_KINDS,
	generateIdsChunked,
	ID_KIND_LABELS,
	type IdKind,
	joinIdsForCopy,
	MAX_COUNT,
	MIN_COUNT,
	validateCount,
} from '@/lib/tools/uuid';

interface GeneratePanelProps {
	onGenerated: () => void;
}

const isUuidKind = (kind: IdKind) => kind === 'uuid-v4' || kind === 'uuid-v7';

export function GeneratePanel({ onGenerated }: GeneratePanelProps) {
	const [settings, updateSettings] = useToolSettings('uuid', {
		kind: 'uuid-v4' as IdKind,
		count: 10,
		uppercase: false,
		hyphens: true,
	});
	const { kind, count, uppercase, hyphens } = settings;

	const [rawResults, setRawResults] = useState<string[]>([]);
	const [generating, setGenerating] = useState(false);
	const [progress, setProgress] = useState(0);
	const runIdRef = useRef(0);

	const countError = validateCount(count);

	const handleGenerate = useCallback(async () => {
		if (countError) return;
		const runId = ++runIdRef.current;
		setGenerating(true);
		setProgress(0);
		try {
			const ids = await generateIdsChunked(kind, count, {}, (done, total) => {
				if (runIdRef.current === runId) {
					setProgress(total === 0 ? 100 : (done / total) * 100);
				}
			});
			if (runIdRef.current === runId) {
				setRawResults(ids);
				onGenerated();
			}
		} finally {
			if (runIdRef.current === runId) setGenerating(false);
		}
	}, [kind, count, countError, onGenerated]);

	// 初回マウント時に既定件数で自動生成する
	// biome-ignore lint/correctness/useExhaustiveDependencies: 初回マウント時のみ実行
	useEffect(() => {
		handleGenerate();
	}, []);

	const displayedResults = rawResults.map((id) =>
		isUuidKind(kind) ? formatUuid(id, { uppercase, hyphens }) : id,
	);
	const copyAllText = joinIdsForCopy(displayedResults);

	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div>
					<Label htmlFor="id-kind-select" className="mb-2 block font-semibold">
						種類
					</Label>
					<Select
						value={kind}
						onValueChange={(value) => updateSettings({ kind: value as IdKind })}
					>
						<SelectTrigger id="id-kind-select" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{GENERATABLE_ID_KINDS.map((k) => (
								<SelectItem key={k} value={k}>
									{ID_KIND_LABELS[k]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div>
					<Label htmlFor="id-count-input" className="mb-2 block font-semibold">
						生成件数（{MIN_COUNT}〜{MAX_COUNT}）
					</Label>
					<Input
						id="id-count-input"
						type="number"
						min={MIN_COUNT}
						max={MAX_COUNT}
						value={count}
						onChange={(e) => updateSettings({ count: Number(e.target.value) })}
						className={
							countError
								? 'border-destructive focus-visible:ring-destructive'
								: ''
						}
						aria-invalid={countError ? true : undefined}
						aria-describedby={countError ? 'id-count-error' : undefined}
					/>
					{countError && (
						<p
							id="id-count-error"
							className="mt-1 text-xs text-destructive"
							role="alert"
						>
							{countError}
						</p>
					)}
				</div>
			</div>

			<div className="rounded-lg border border-border p-4 space-y-3">
				<p className="text-sm font-semibold">UUID表示オプション</p>
				<div className="flex flex-wrap gap-x-8 gap-y-3">
					<div className="flex items-center gap-2">
						<Switch
							id="uuid-uppercase"
							checked={uppercase}
							disabled={!isUuidKind(kind)}
							onCheckedChange={(checked) =>
								updateSettings({ uppercase: checked })
							}
						/>
						<Label
							htmlFor="uuid-uppercase"
							className={`text-sm ${isUuidKind(kind) ? 'cursor-pointer' : 'text-muted-foreground'}`}
						>
							大文字で表示
						</Label>
					</div>
					<div className="flex items-center gap-2">
						<Switch
							id="uuid-hyphens"
							checked={hyphens}
							disabled={!isUuidKind(kind)}
							onCheckedChange={(checked) =>
								updateSettings({ hyphens: checked })
							}
						/>
						<Label
							htmlFor="uuid-hyphens"
							className={`text-sm ${isUuidKind(kind) ? 'cursor-pointer' : 'text-muted-foreground'}`}
						>
							ハイフンあり
						</Label>
					</div>
				</div>
				{!isUuidKind(kind) && (
					<p className="text-xs text-muted-foreground">
						{kind === 'ulid'
							? 'ULIDは常に大文字26文字の正規形で表示されます。'
							: 'nanoidは生成された文字列をそのまま表示します。'}
					</p>
				)}
			</div>

			<Button
				onClick={handleGenerate}
				disabled={!!countError || generating}
				className="w-full sm:w-auto"
			>
				{generating ? (
					<Loader2 className="h-4 w-4 animate-spin" />
				) : (
					<Dices className="h-4 w-4" />
				)}
				<span className="ml-1.5">生成する</span>
			</Button>

			{generating && (
				<div className="space-y-2">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin text-primary" />
						<span>生成中… {Math.round(progress)}%</span>
					</div>
					<div
						className="h-2 w-full rounded-full bg-muted overflow-hidden"
						role="progressbar"
						aria-valuenow={Math.round(progress)}
						aria-valuemin={0}
						aria-valuemax={100}
					>
						<div
							className="h-full rounded-full bg-primary transition-all duration-200"
							style={{ width: `${progress}%` }}
						/>
					</div>
				</div>
			)}

			{!generating && rawResults.length > 0 && (
				<div className="space-y-3">
					<div className="flex items-center justify-between">
						<p className="text-sm font-semibold" aria-live="polite">
							生成結果（{displayedResults.length}件）
						</p>
						<div data-testid="id-copy-all">
							<CopyButton text={copyAllText} label="全件コピー" />
						</div>
					</div>
					{displayedResults.length > 300 && (
						<p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
							<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
							件数が多いため、一覧の描画に時間がかかる場合があります。
						</p>
					)}
					<ul
						className="max-h-96 overflow-y-auto rounded-lg border border-border divide-y divide-border font-mono-tool text-sm"
						data-testid="id-result-list"
						aria-label="生成されたID一覧"
					>
						{displayedResults.map((id, i) => (
							<li
								// biome-ignore lint/suspicious/noArrayIndexKey: 生成順・件数のみ変わる読み取り専用リストのため
								key={i}
								className="flex items-center justify-between gap-2 px-3 py-1.5"
							>
								<span className="break-all">{id}</span>
								<CopyButton
									text={id}
									variant="ghost"
									size="sm"
									className="shrink-0"
								/>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
