import { Clock, Timer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import {
	batchRowsToDelimitedText,
	convertBatch,
	detectTimestampCandidates,
	formatTimestamp,
	nowInstantNanos,
	parseDateTimeString,
	type TimestampCandidate,
} from '@/lib/tools/unix-time';
import { provideToolsFromFactory } from '@/lib/webmcp';
import { unixTimeTool } from '@/lib/webmcp/tools/unix-time.webmcp';

const TIMEZONES: string[] =
	typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
		? // biome-ignore lint/suspicious/noExplicitAny: supportedValuesOf は型定義が古い環境向けに未対応の場合がある
			(Intl as any).supportedValuesOf('timeZone')
		: ['UTC', 'Asia/Tokyo', 'America/New_York', 'Europe/London'];

const DISCORD_STYLES: {
	key: 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';
	label: string;
}[] = [
	{ key: 'F', label: '長い日時' },
	{ key: 'f', label: '短い日時' },
	{ key: 'D', label: '長い日付' },
	{ key: 'd', label: '短い日付' },
	{ key: 'T', label: '長い時刻' },
	{ key: 't', label: '短い時刻' },
	{ key: 'R', label: '相対時刻' },
];

interface Settings {
	timeZone: string;
}

function OutputRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0">
			<div className="min-w-0 flex-1">
				<div className="text-xs text-muted-foreground mb-0.5">{label}</div>
				<div className="font-mono text-sm break-all">{value}</div>
			</div>
			<CopyButton text={value} />
		</div>
	);
}

export default function UnixTime() {
	const [settings, updateSettings] = useToolSettings<Settings>('unix-time', {
		timeZone: 'Asia/Tokyo',
	});
	const { timeZone } = settings;

	const [mode, setMode] = useState<'single' | 'batch'>('single');
	const [input, setInput] = useState('');
	const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
	const [nowSeconds, setNowSeconds] = useState(() =>
		Math.floor(Date.now() / 1000),
	);
	const [nowCopied, setNowCopied] = useState(false);
	const [batchText, setBatchText] = useState('');

	useEffect(() => {
		const timer = setInterval(() => {
			setNowSeconds(Math.floor(Date.now() / 1000));
		}, 1000);
		return () => clearInterval(timer);
	}, []);

	useEffect(() => {
		const cleanup = provideToolsFromFactory([unixTimeTool]);
		return cleanup;
	}, []);

	const candidates = useMemo<TimestampCandidate[]>(() => {
		const trimmed = input.trim();
		if (trimmed === '') return [];
		return detectTimestampCandidates(trimmed);
	}, [input]);

	const reverseParsed = useMemo(() => {
		const trimmed = input.trim();
		if (trimmed === '' || candidates.length > 0) return null;
		return parseDateTimeString(trimmed, timeZone);
	}, [input, timeZone, candidates.length]);

	const activeCandidate = useMemo(() => {
		if (candidates.length === 0) return null;
		return candidates.find((c) => c.format === selectedFormat) ?? candidates[0];
	}, [candidates, selectedFormat]);

	const outputs = useMemo(() => {
		if (activeCandidate) {
			return formatTimestamp(activeCandidate.instantNanos, timeZone);
		}
		if (reverseParsed) {
			return formatTimestamp(reverseParsed.instantNanos, timeZone);
		}
		return null;
	}, [activeCandidate, reverseParsed, timeZone]);

	const showUnableToParse =
		input.trim() !== '' && candidates.length === 0 && !reverseParsed;

	const batchRows = useMemo(() => {
		if (batchText.trim() === '') return [];
		return convertBatch(batchText, timeZone);
	}, [batchText, timeZone]);

	const handleNowClick = () => {
		const nanos = nowInstantNanos();
		const seconds = nanos / 1_000_000_000n;
		setInput(seconds.toString());
		setSelectedFormat(null);
	};

	const handleCopyNow = async () => {
		try {
			await navigator.clipboard.writeText(String(nowSeconds));
			setNowCopied(true);
			setTimeout(() => setNowCopied(false), 2000);
		} catch {
			// クリップボードAPI非対応環境では無視する
		}
	};

	return (
		<div className="space-y-6">
			{/* 現在時刻ライブ表示 */}
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Clock className="h-4 w-4" />
					<span>現在のUNIX秒</span>
					<button
						type="button"
						onClick={handleCopyNow}
						className="font-mono text-foreground font-semibold hover:underline"
						aria-label="現在のUNIX秒をコピー"
					>
						{nowCopied ? 'コピーしました' : nowSeconds}
					</button>
				</div>
				<Button variant="outline" size="sm" onClick={handleNowClick}>
					<Timer className="h-4 w-4" />
					現在時刻を入力欄へ
				</Button>
			</div>

			<Tabs
				value={mode}
				onValueChange={(v) => setMode(v as 'single' | 'batch')}
			>
				<TabsList>
					<TabsTrigger value="single">単体変換</TabsTrigger>
					<TabsTrigger value="batch">一括変換</TabsTrigger>
				</TabsList>
			</Tabs>

			{/* タイムゾーン選択（共通） */}
			<div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
				<Label
					htmlFor="unix-time-timezone"
					className="text-sm font-medium whitespace-nowrap"
				>
					タイムゾーン
				</Label>
				<Select
					value={timeZone}
					onValueChange={(v) => updateSettings({ timeZone: v })}
				>
					<SelectTrigger id="unix-time-timezone" className="rounded-xl sm:w-72">
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="max-h-80">
						<SelectItem value="UTC">UTC</SelectItem>
						<SelectItem value="Asia/Tokyo">Asia/Tokyo（JST）</SelectItem>
						{TIMEZONES.filter((tz) => tz !== 'UTC' && tz !== 'Asia/Tokyo').map(
							(tz) => (
								<SelectItem key={tz} value={tz}>
									{tz}
								</SelectItem>
							),
						)}
					</SelectContent>
				</Select>
			</div>

			{mode === 'single' ? (
				<div className="space-y-4">
					<div>
						<Label
							htmlFor="unix-time-input"
							className="text-sm font-medium mb-2 block"
						>
							タイムスタンプまたは日時
						</Label>
						<Input
							id="unix-time-input"
							value={input}
							onChange={(e) => {
								setInput(e.target.value);
								setSelectedFormat(null);
							}}
							placeholder="例: 1783385779 / 2026-07-07T00:56:19Z"
							className="rounded-xl font-mono focus:ring-2 focus:ring-primary"
							aria-describedby="unix-time-hint"
							autoComplete="off"
						/>
						<p
							id="unix-time-hint"
							className="mt-1 text-xs text-muted-foreground"
						>
							数値（秒/ミリ秒/マイクロ秒/ナノ秒/Slack
							TS）または日時文字列を入力すると自動判定します。
						</p>
					</div>

					{candidates.length > 1 && (
						<div
							className="flex flex-wrap gap-2"
							role="group"
							aria-label="解釈候補の切り替え"
						>
							{candidates.map((c) => (
								<button
									key={c.format}
									type="button"
									onClick={() => setSelectedFormat(c.format)}
									className={`rounded-full border px-3 py-1 text-xs transition-colors ${
										(activeCandidate?.format ?? candidates[0].format) ===
										c.format
											? 'border-primary bg-primary/10 text-primary font-medium'
											: 'border-border text-muted-foreground hover:bg-muted'
									}`}
								>
									{c.label}
									{c.confidence === 'low' && '（低確度）'}
								</button>
							))}
						</div>
					)}

					{showUnableToParse && (
						<p className="text-sm text-muted-foreground" aria-live="polite">
							解釈できません
						</p>
					)}

					{outputs && (
						<div
							className="rounded-xl border bg-card p-4 sm:p-6"
							data-testid="unix-time-result"
						>
							<OutputRow
								label={`ISO 8601（${timeZone}）`}
								value={outputs.isoLocal}
							/>
							<OutputRow label="ISO 8601（UTC）" value={outputs.isoUtc} />
							<OutputRow label="RFC 3339" value={outputs.rfc3339} />
							<OutputRow label="和暦" value={outputs.wareki} />
							<OutputRow label="UNIX秒" value={outputs.unixSeconds} />
							<OutputRow label="UNIXミリ秒" value={outputs.unixMilliseconds} />
							<OutputRow label="相対時刻" value={outputs.relative} />
							<div className="pt-3">
								<div className="text-xs text-muted-foreground mb-2">
									Discordタイムスタンプタグ
								</div>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
									{DISCORD_STYLES.map(({ key, label }) => (
										<div
											key={key}
											className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
										>
											<div className="min-w-0">
												<div className="text-xs text-muted-foreground">
													{label}
												</div>
												<div className="font-mono text-sm truncate">
													{outputs.discord[key]}
												</div>
											</div>
											<CopyButton text={outputs.discord[key]} size="sm" />
										</div>
									))}
								</div>
							</div>
						</div>
					)}
				</div>
			) : (
				<div className="space-y-4">
					<div>
						<Label
							htmlFor="unix-time-batch-input"
							className="text-sm font-medium mb-2 block"
						>
							一括入力（1行1値）
						</Label>
						<Textarea
							id="unix-time-batch-input"
							value={batchText}
							onChange={(e) => setBatchText(e.target.value)}
							placeholder={
								'1783385779\n2026-07-07T00:56:19Z\n1355517523.000005'
							}
							className="rounded-xl font-mono min-h-40"
						/>
					</div>

					{batchRows.length > 0 && (
						<div className="space-y-3">
							<div className="flex justify-end gap-2">
								<CopyButton
									text={batchRowsToDelimitedText(batchRows, '\t')}
									label="TSVをコピー"
								/>
								<CopyButton
									text={batchRowsToDelimitedText(batchRows, ',')}
									label="CSVをコピー"
								/>
							</div>
							<div className="overflow-x-auto rounded-xl border">
								<Table data-testid="unix-time-batch-result">
									<TableHeader>
										<TableRow>
											<TableHead>入力</TableHead>
											<TableHead>形式</TableHead>
											<TableHead>ISO 8601（UTC）</TableHead>
											<TableHead>UNIX秒</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{batchRows.map((row, i) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: 行の順序は変化しても内容が重複し得るため入力値のみでは一意性を保証できない
											<TableRow key={`${row.input}-${i}`}>
												<TableCell className="font-mono">{row.input}</TableCell>
												<TableCell>
													{row.ok ? (
														row.formatLabel
													) : (
														<span className="text-destructive">エラー</span>
													)}
												</TableCell>
												<TableCell className="font-mono">
													{row.ok ? row.isoUtc : row.error}
												</TableCell>
												<TableCell className="font-mono">
													{row.ok ? row.unixSeconds : '-'}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
