import { Info, Wand2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
	describeCronJapanese,
	getNextRunTimes,
	parseCronExpression,
} from '@/lib/tools/cron-checker';
import {
	buildCronFromWizard,
	WIZARD_HOUR_INTERVALS,
	WIZARD_MINUTE_INTERVALS,
	type WizardFrequency,
} from '@/lib/tools/cron-wizard';

interface CronWizardPanelProps {
	/** 生成したcron式を解析欄へ反映する */
	onApply: (expr: string) => void;
}

const FREQUENCY_OPTIONS: { value: WizardFrequency; label: string }[] = [
	{ value: 'minutes', label: 'n分ごと' },
	{ value: 'hours', label: 'n時間ごと' },
	{ value: 'daily', label: '毎日' },
	{ value: 'weekly', label: '毎週' },
	{ value: 'monthly', label: '毎月' },
];

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

const SELECT_CLASS =
	'border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none';

const RUN_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
	timeZone: 'Asia/Tokyo',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	weekday: 'short',
	hourCycle: 'h23',
});

/**
 * 頻度・時刻・曜日・日を選んでcron式を作る欄。
 * 選択内容は保存・送信・計測しない（この欄は tool_run を送らない）。
 */
export default function CronWizardPanel({ onApply }: CronWizardPanelProps) {
	const idPrefix = useId();
	const [frequency, setFrequency] = useState<WizardFrequency>('weekly');
	const [minuteInterval, setMinuteInterval] = useState(15);
	const [hourInterval, setHourInterval] = useState(1);
	const [hour, setHour] = useState(9);
	const [minute, setMinute] = useState(0);
	const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
	const [dayOfMonth, setDayOfMonth] = useState(1);

	const result = useMemo(
		() =>
			buildCronFromWizard({
				frequency,
				interval: frequency === 'minutes' ? minuteInterval : hourInterval,
				hour,
				minute,
				weekdays,
				dayOfMonth,
			}),
		[
			frequency,
			minuteInterval,
			hourInterval,
			hour,
			minute,
			weekdays,
			dayOfMonth,
		],
	);

	const preview = useMemo(() => {
		if (!result.success) return null;
		try {
			const schedule = parseCronExpression(result.expr);
			return {
				description: describeCronJapanese(schedule),
				runs: getNextRunTimes(schedule, { count: 3, timeZone: 'Asia/Tokyo' }),
			};
		} catch {
			return null;
		}
	}, [result]);

	const toggleWeekday = (day: number, checked: boolean) => {
		setWeekdays((prev) =>
			checked
				? [...new Set([...prev, day])].sort((a, b) => a - b)
				: prev.filter((d) => d !== day),
		);
	};

	const needsTime =
		frequency === 'daily' || frequency === 'weekly' || frequency === 'monthly';
	const needsMinute = needsTime || frequency === 'hours';

	const fieldId = (name: string) => `${idPrefix}-${name}`;

	return (
		<div
			className="rounded-xl border bg-muted/30 p-4 sm:p-6 space-y-3"
			data-testid="cron-wizard"
		>
			<div className="flex items-center gap-2 text-sm font-medium">
				<Wand2 className="h-4 w-4 text-primary" aria-hidden="true" />
				ウィザードで作る（選ぶだけでcron式を生成）
			</div>

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div className="col-span-2 sm:col-span-1">
					<Label htmlFor={fieldId('frequency')} className="mb-1 block text-xs">
						頻度
					</Label>
					<select
						id={fieldId('frequency')}
						value={frequency}
						onChange={(e) => setFrequency(e.target.value as WizardFrequency)}
						className={SELECT_CLASS}
					>
						{FREQUENCY_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
				</div>

				{frequency === 'minutes' && (
					<div>
						<Label
							htmlFor={fieldId('minute-interval')}
							className="mb-1 block text-xs"
						>
							間隔（分）
						</Label>
						<select
							id={fieldId('minute-interval')}
							value={minuteInterval}
							onChange={(e) => setMinuteInterval(Number(e.target.value))}
							className={SELECT_CLASS}
						>
							{WIZARD_MINUTE_INTERVALS.map((n) => (
								<option key={n} value={n}>
									{n}分ごと
								</option>
							))}
						</select>
					</div>
				)}

				{frequency === 'hours' && (
					<div>
						<Label
							htmlFor={fieldId('hour-interval')}
							className="mb-1 block text-xs"
						>
							間隔（時間）
						</Label>
						<select
							id={fieldId('hour-interval')}
							value={hourInterval}
							onChange={(e) => setHourInterval(Number(e.target.value))}
							className={SELECT_CLASS}
						>
							{WIZARD_HOUR_INTERVALS.map((n) => (
								<option key={n} value={n}>
									{n}時間ごと
								</option>
							))}
						</select>
					</div>
				)}

				{frequency === 'monthly' && (
					<div>
						<Label htmlFor={fieldId('day')} className="mb-1 block text-xs">
							日
						</Label>
						<select
							id={fieldId('day')}
							value={dayOfMonth}
							onChange={(e) => setDayOfMonth(Number(e.target.value))}
							className={SELECT_CLASS}
						>
							{DAYS.map((d) => (
								<option key={d} value={d}>
									{d}日
								</option>
							))}
						</select>
					</div>
				)}

				{needsTime && (
					<div>
						<Label htmlFor={fieldId('hour')} className="mb-1 block text-xs">
							時
						</Label>
						<select
							id={fieldId('hour')}
							value={hour}
							onChange={(e) => setHour(Number(e.target.value))}
							className={SELECT_CLASS}
						>
							{HOURS.map((h) => (
								<option key={h} value={h}>
									{h}時
								</option>
							))}
						</select>
					</div>
				)}

				{needsMinute && (
					<div>
						<Label htmlFor={fieldId('minute')} className="mb-1 block text-xs">
							分
						</Label>
						<select
							id={fieldId('minute')}
							value={minute}
							onChange={(e) => setMinute(Number(e.target.value))}
							className={SELECT_CLASS}
						>
							{MINUTES.map((m) => (
								<option key={m} value={m}>
									{m}分
								</option>
							))}
						</select>
					</div>
				)}
			</div>

			{frequency === 'weekly' && (
				<fieldset>
					<legend className="mb-1 text-xs font-medium">曜日</legend>
					<div className="flex flex-wrap gap-x-4 gap-y-2">
						{WEEKDAY_LABELS.map((label, day) => {
							const id = fieldId(`weekday-${day}`);
							return (
								<div key={label} className="flex items-center gap-1.5">
									<Checkbox
										id={id}
										checked={weekdays.includes(day)}
										onCheckedChange={(v) => toggleWeekday(day, v === true)}
									/>
									<Label htmlFor={id} className="text-sm">
										{label}曜
									</Label>
								</div>
							);
						})}
					</div>
				</fieldset>
			)}

			<p className="text-xs text-muted-foreground">
				時刻はJST（Asia/Tokyo）です。
			</p>

			<div aria-live="polite">
				{!result.success && (
					<p
						className="text-sm text-destructive"
						data-testid="cron-wizard-error"
					>
						{result.error}
					</p>
				)}
				{result.success && (
					<div className="space-y-2" data-testid="cron-wizard-result">
						<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
							<div className="min-w-0">
								<div className="text-xs text-muted-foreground">
									cron式（JST）
								</div>
								<code
									className="font-mono text-sm break-all"
									data-testid="cron-wizard-expr"
								>
									{result.expr}
								</code>
								{preview && (
									<div className="text-xs text-muted-foreground">
										{preview.description}
									</div>
								)}
							</div>
							<div className="flex items-center gap-2">
								<Button
									size="sm"
									variant="outline"
									onClick={() => onApply(result.expr)}
								>
									解析欄へ反映
								</Button>
								<CopyButton text={result.expr} size="sm" />
							</div>
						</div>
						{preview && preview.runs.length > 0 && (
							<div className="text-xs">
								<div className="text-muted-foreground">
									次回実行（JST・3件）
								</div>
								<ol
									className="font-mono space-y-0.5"
									data-testid="cron-wizard-runs"
								>
									{preview.runs.map((d) => (
										<li key={d.getTime()}>{RUN_FORMATTER.format(d)}</li>
									))}
								</ol>
							</div>
						)}
						{result.notes.length > 0 && (
							<ul className="space-y-1" data-testid="cron-wizard-notes">
								{result.notes.map((note) => (
									<li
										key={note}
										className="flex gap-2 text-xs text-muted-foreground"
									>
										<Info
											className="mt-0.5 h-3.5 w-3.5 shrink-0"
											aria-hidden="true"
										/>
										<span>{note}</span>
									</li>
								))}
							</ul>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
