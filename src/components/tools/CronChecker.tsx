import { AlertTriangle, Info, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import {
	CronParseError,
	type CronSchedule,
	describeCronJapanese,
	generateCronFromJapanese,
	getNextRunTimes,
	lintCronSchedule,
	parseCronExpression,
	toAwsEventBridgeCron,
	toCrontabLine,
	toGithubActionsSchedule,
} from '@/lib/tools/cron-checker';

const PRESETS: { label: string; expr: string }[] = [
	{ label: '毎分', expr: '* * * * *' },
	{ label: '毎時0分', expr: '0 * * * *' },
	{ label: '毎日0時', expr: '0 0 * * *' },
	{ label: '平日9時', expr: '0 9 * * 1-5' },
	{ label: '毎月1日0時', expr: '0 0 1 * *' },
	{ label: '5秒おき', expr: '*/5 * * * * *' },
];

const TIMEZONES: string[] =
	typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
		? // biome-ignore lint/suspicious/noExplicitAny: supportedValuesOf は型定義が古い環境向けに未対応の場合がある
			(Intl as any).supportedValuesOf('timeZone')
		: ['UTC', 'Asia/Tokyo', 'America/New_York', 'Europe/London'];

interface Settings {
	extraTimeZone: string;
}

function formatInZone(date: Date, timeZone: string): string {
	const formatter = new Intl.DateTimeFormat('ja-JP', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		weekday: 'short',
		hourCycle: 'h23',
	});
	return formatter.format(date);
}

function severityBadgeVariant(
	severity: 'error' | 'warn' | 'info',
): 'destructive' | 'secondary' | 'outline' {
	if (severity === 'error') return 'destructive';
	if (severity === 'warn') return 'secondary';
	return 'outline';
}

export default function CronChecker() {
	const { trackRun } = useToolAnalytics('cron-checker');
	const [settings, updateSettings] = useToolSettings<Settings>('cron-checker', {
		extraTimeZone: 'UTC',
	});

	const [input, setInput] = useState('0 9 * * 1');
	const [jaInput, setJaInput] = useState('');
	const [shareCopied, setShareCopied] = useState(false);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const exprParam = params.get('expr');
		if (exprParam) setInput(exprParam);
	}, []);

	useEffect(() => {
		const url = new URL(window.location.href);
		if (input.trim()) {
			url.searchParams.set('expr', input.trim());
		} else {
			url.searchParams.delete('expr');
		}
		window.history.replaceState({}, '', url.toString());
	}, [input]);

	const parseResult = useMemo(():
		| { schedule: CronSchedule }
		| { error: string } => {
		try {
			return { schedule: parseCronExpression(input) };
		} catch (e) {
			return {
				error:
					e instanceof CronParseError
						? e.message
						: 'cron式を解釈できませんでした',
			};
		}
	}, [input]);

	const schedule = 'schedule' in parseResult ? parseResult.schedule : null;

	const description = useMemo(
		() => (schedule ? describeCronJapanese(schedule) : null),
		[schedule],
	);

	const lintIssues = useMemo(
		() => (schedule ? lintCronSchedule(schedule) : []),
		[schedule],
	);

	const nextRuns = useMemo(() => {
		if (!schedule) return [];
		try {
			return getNextRunTimes(schedule, { count: 10, timeZone: 'Asia/Tokyo' });
		} catch {
			return [];
		}
	}, [schedule]);

	useEffect(() => {
		if (schedule) trackRun();
	}, [schedule, trackRun]);

	const crontabCopy = schedule ? toCrontabLine(schedule) : null;
	const githubCopy = schedule ? toGithubActionsSchedule(schedule) : null;
	const awsCopy = schedule ? toAwsEventBridgeCron(schedule) : null;

	const reverseResult = useMemo(() => {
		if (jaInput.trim() === '') return null;
		return generateCronFromJapanese(jaInput);
	}, [jaInput]);

	const shareUrl = useMemo(() => {
		if (typeof window === 'undefined') return '';
		const url = new URL(window.location.href);
		url.searchParams.set('expr', input.trim());
		return url.toString();
	}, [input]);

	const handleCopyShare = async () => {
		try {
			await navigator.clipboard.writeText(shareUrl);
			setShareCopied(true);
			setTimeout(() => setShareCopied(false), 2000);
		} catch {
			// クリップボードAPI非対応環境では無視する
		}
	};

	return (
		<div className="space-y-6">
			<div>
				<Label
					htmlFor="cron-checker-input"
					className="text-sm font-medium mb-2 block"
				>
					cron式
				</Label>
				<Input
					id="cron-checker-input"
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder="例: 0 9 * * 1（標準5フィールド）または */5 * * * * *（秒付き6フィールド）"
					className="rounded-xl font-mono focus:ring-2 focus:ring-primary"
					autoComplete="off"
					spellCheck={false}
				/>
				<div
					className="mt-2 flex flex-wrap gap-2"
					role="group"
					aria-label="プリセット"
				>
					{PRESETS.map((p) => (
						<button
							key={p.label}
							type="button"
							onClick={() => setInput(p.expr)}
							className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
						>
							{p.label}
						</button>
					))}
				</div>
			</div>

			{'error' in parseResult && (
				<Alert variant="destructive" role="alert">
					<AlertTriangle className="h-4 w-4" aria-hidden="true" />
					<AlertDescription>{parseResult.error}</AlertDescription>
				</Alert>
			)}

			{schedule && description && (
				<div className="space-y-6" data-testid="cron-checker-result">
					<div className="rounded-xl border bg-card p-4 sm:p-6">
						<div className="text-xs text-muted-foreground mb-1">日本語解説</div>
						<div
							className="text-lg font-semibold"
							data-testid="cron-description"
						>
							{description}
						</div>
					</div>

					{lintIssues.length > 0 && (
						<div className="space-y-2" data-testid="cron-lint-issues">
							{lintIssues.map((issue) => (
								<Alert
									key={issue.message}
									variant={
										issue.severity === 'error' ? 'destructive' : 'default'
									}
								>
									{issue.severity === 'info' ? (
										<Info className="h-4 w-4" aria-hidden="true" />
									) : (
										<AlertTriangle className="h-4 w-4" aria-hidden="true" />
									)}
									<AlertDescription className="flex items-center gap-2">
										<Badge variant={severityBadgeVariant(issue.severity)}>
											{issue.severity === 'error'
												? 'エラー'
												: issue.severity === 'warn'
													? '注意'
													: '情報'}
										</Badge>
										<span>{issue.message}</span>
									</AlertDescription>
								</Alert>
							))}
						</div>
					)}

					<div>
						<div className="flex flex-wrap items-center justify-between gap-2 mb-2">
							<Label
								htmlFor="cron-checker-extra-tz"
								className="text-sm font-medium"
							>
								次回実行日時（10件）
							</Label>
							<div className="flex items-center gap-2">
								<span className="text-xs text-muted-foreground">
									追加タイムゾーン
								</span>
								<Select
									value={settings.extraTimeZone}
									onValueChange={(v) => updateSettings({ extraTimeZone: v })}
								>
									<SelectTrigger
										id="cron-checker-extra-tz"
										size="sm"
										className="rounded-xl"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent className="max-h-80">
										<SelectItem value="UTC">UTC</SelectItem>
										<SelectItem value="Asia/Tokyo">
											Asia/Tokyo（JST）
										</SelectItem>
										{TIMEZONES.filter(
											(tz) => tz !== 'UTC' && tz !== 'Asia/Tokyo',
										).map((tz) => (
											<SelectItem key={tz} value={tz}>
												{tz}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
						<div className="overflow-x-auto rounded-xl border">
							<Table data-testid="cron-next-runs">
								<TableHeader>
									<TableRow>
										<TableHead>#</TableHead>
										<TableHead>JST</TableHead>
										<TableHead>UTC</TableHead>
										{settings.extraTimeZone !== 'UTC' &&
											settings.extraTimeZone !== 'Asia/Tokyo' && (
												<TableHead>{settings.extraTimeZone}</TableHead>
											)}
									</TableRow>
								</TableHeader>
								<TableBody>
									{nextRuns.map((d, i) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: 次回実行順を維持したいだけの表示専用リスト
										<TableRow key={i}>
											<TableCell className="text-muted-foreground">
												{i + 1}
											</TableCell>
											<TableCell className="font-mono">
												{formatInZone(d, 'Asia/Tokyo')}
											</TableCell>
											<TableCell className="font-mono">
												{formatInZone(d, 'UTC')}
											</TableCell>
											{settings.extraTimeZone !== 'UTC' &&
												settings.extraTimeZone !== 'Asia/Tokyo' && (
													<TableCell className="font-mono">
														{formatInZone(d, settings.extraTimeZone)}
													</TableCell>
												)}
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</div>

					<div className="space-y-2">
						<div className="text-sm font-medium">フォーマット別コピー</div>
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
							{crontabCopy && (
								<div className="rounded-lg border p-3">
									<div className="text-xs text-muted-foreground mb-1">
										crontab
									</div>
									<div className="flex items-center justify-between gap-2">
										<code className="font-mono text-sm break-all">
											{crontabCopy.value}
										</code>
										<CopyButton text={crontabCopy.value} size="sm" />
									</div>
								</div>
							)}
							{githubCopy && (
								<div className="rounded-lg border p-3">
									<div className="text-xs text-muted-foreground mb-1">
										GitHub Actions
									</div>
									{githubCopy.warning ? (
										<p className="text-xs text-destructive">
											{githubCopy.warning}
										</p>
									) : (
										<div className="flex items-center justify-between gap-2">
											<pre className="font-mono text-xs whitespace-pre-wrap break-all">
												{githubCopy.value}
											</pre>
											<CopyButton text={githubCopy.value} size="sm" />
										</div>
									)}
								</div>
							)}
							{awsCopy && (
								<div className="rounded-lg border p-3">
									<div className="text-xs text-muted-foreground mb-1">
										AWS EventBridge
									</div>
									{awsCopy.warning && (
										<p className="text-xs text-muted-foreground mb-1">
											{awsCopy.warning}
										</p>
									)}
									{awsCopy.value ? (
										<div className="flex items-center justify-between gap-2">
											<code className="font-mono text-sm break-all">
												{awsCopy.value}
											</code>
											<CopyButton text={awsCopy.value} size="sm" />
										</div>
									) : (
										<p className="text-xs text-destructive">
											{awsCopy.warning}
										</p>
									)}
								</div>
							)}
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<Button variant="outline" size="sm" onClick={handleCopyShare}>
							{shareCopied ? 'コピーしました' : '共有URLをコピー'}
						</Button>
					</div>
				</div>
			)}

			<div className="rounded-xl border bg-muted/30 p-4 sm:p-6 space-y-3">
				<div className="flex items-center gap-2 text-sm font-medium">
					<Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
					逆引き生成（日本語→cron式）
				</div>
				<div>
					<Label htmlFor="cron-checker-ja-input" className="sr-only">
						日本語での実行タイミング指定
					</Label>
					<Input
						id="cron-checker-ja-input"
						value={jaInput}
						onChange={(e) => setJaInput(e.target.value)}
						placeholder="例: 平日の9時と18時 / 毎週月曜9時 / 15分おき"
						className="rounded-xl"
						autoComplete="off"
					/>
				</div>
				{reverseResult && reverseResult.success && (
					<div
						className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2"
						data-testid="cron-reverse-result"
					>
						<code className="font-mono text-sm">{reverseResult.expr}</code>
						<div className="flex items-center gap-2">
							<Button
								size="sm"
								variant="outline"
								onClick={() => setInput(reverseResult.expr)}
							>
								解析欄へ反映
							</Button>
							<CopyButton text={reverseResult.expr} size="sm" />
						</div>
					</div>
				)}
				{reverseResult && !reverseResult.success && (
					<div className="space-y-2" data-testid="cron-reverse-fallback">
						<p className="text-sm text-muted-foreground" aria-live="polite">
							解釈できませんでした。以下の候補もお試しください。
						</p>
						<div className="flex flex-wrap gap-2">
							{reverseResult.suggestions.map((s) => (
								<button
									key={s}
									type="button"
									onClick={() => setJaInput(s)}
									className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
								>
									{s}
								</button>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
