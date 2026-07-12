import { ArrowLeftRight, Calendar } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	buildConversionTable,
	buildConversionTableFromWareki,
	type ConversionTableResult,
	DEFAULT_TABLE_RANGE_YEARS,
	formatAgeColumnText,
	formatEraColumnText,
	formatTableForCopy,
	normalizeWarekiInput,
	TABLE_RANGE_YEAR_OPTIONS,
	type TableRangeYears,
} from '@/lib/tools/wareki-converter';
import { cn } from '@/lib/utils';

type Direction = 'toWareki' | 'toSeireki';

const NO_MONTH_DAY = 0;

function MonthDaySelects({
	month,
	day,
	onMonthChange,
	onDayChange,
}: {
	month: number;
	day: number;
	onMonthChange: (value: number) => void;
	onDayChange: (value: number) => void;
}) {
	return (
		<>
			<div className="sm:col-span-3">
				<Label className="text-sm font-medium mb-2 block">月（任意）</Label>
				<Select
					value={String(month)}
					onValueChange={(v) => onMonthChange(Number(v))}
				>
					<SelectTrigger aria-label="月（任意）" className="rounded-xl w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={String(NO_MONTH_DAY)}>未指定</SelectItem>
						{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
							<SelectItem key={m} value={String(m)}>
								{m}月
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="sm:col-span-3">
				<Label className="text-sm font-medium mb-2 block">日（任意）</Label>
				<Select
					value={String(day)}
					onValueChange={(v) => onDayChange(Number(v))}
				>
					<SelectTrigger aria-label="日（任意）" className="rounded-xl w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={String(NO_MONTH_DAY)}>未指定</SelectItem>
						{Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
							<SelectItem key={d} value={String(d)}>
								{d}日
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</>
	);
}

export default function WarekiConverter() {
	const { trackRun } = useToolAnalytics('wareki-converter');
	const referenceDate = useMemo(() => new Date(), []);

	const [direction, setDirection] = useState<Direction>('toWareki');
	const [rangeYears, setRangeYears] = useState<TableRangeYears>(
		DEFAULT_TABLE_RANGE_YEARS,
	);

	// State for Seireki -> Wareki
	const [seirekiYearInput, setSeirekiYearInput] = useState<string>(
		String(referenceDate.getFullYear()),
	);
	const [seirekiMonth, setSeirekiMonth] = useState<number>(NO_MONTH_DAY);
	const [seirekiDay, setSeirekiDay] = useState<number>(NO_MONTH_DAY);

	// State for Wareki -> Seireki
	const [warekiInput, setWarekiInput] = useState<string>('令和元年');
	const [warekiMonth, setWarekiMonth] = useState<number>(NO_MONTH_DAY);
	const [warekiDay, setWarekiDay] = useState<number>(NO_MONTH_DAY);

	// 月を「未指定」へ戻した場合は、日も「未指定」へ戻す（片方だけの指定はエラーになるため）
	const handleSeirekiMonthChange = (value: number) => {
		setSeirekiMonth(value);
		if (value === NO_MONTH_DAY) setSeirekiDay(NO_MONTH_DAY);
	};
	const handleWarekiMonthChange = (value: number) => {
		setWarekiMonth(value);
		if (value === NO_MONTH_DAY) setWarekiDay(NO_MONTH_DAY);
	};

	const { table, error } = useMemo((): {
		table: ConversionTableResult | null;
		error: string | null;
	} => {
		if (direction === 'toWareki') {
			const year = Number(seirekiYearInput);
			if (seirekiYearInput.trim() === '' || Number.isNaN(year)) {
				return { table: null, error: '西暦年を入力してください' };
			}
			const month = seirekiMonth === NO_MONTH_DAY ? undefined : seirekiMonth;
			const day = seirekiDay === NO_MONTH_DAY ? undefined : seirekiDay;
			const t = buildConversionTable(
				year,
				referenceDate,
				rangeYears,
				month,
				day,
			);
			return { table: t, error: t.error ?? null };
		}

		const normalized = normalizeWarekiInput(warekiInput);
		if (!normalized.ok) {
			return { table: null, error: normalized.error };
		}
		const month = warekiMonth === NO_MONTH_DAY ? undefined : warekiMonth;
		const day = warekiDay === NO_MONTH_DAY ? undefined : warekiDay;
		const t = buildConversionTableFromWareki(
			normalized.eraId,
			normalized.eraYear,
			referenceDate,
			rangeYears,
			month,
			day,
		);
		return { table: t, error: t.error ?? null };
	}, [
		direction,
		seirekiYearInput,
		seirekiMonth,
		seirekiDay,
		warekiInput,
		warekiMonth,
		warekiDay,
		rangeYears,
		referenceDate,
	]);

	const copyText = useMemo(() => {
		if (!table || error) return '';
		return formatTableForCopy(table);
	}, [table, error]);

	useEffect(() => {
		if (table && !error) {
			trackRun();
		}
	}, [table, error, trackRun]);

	return (
		<div className="space-y-6">
			{/* Direction toggle */}
			<div className="flex items-center gap-3">
				<Label className="text-sm font-medium whitespace-nowrap">
					{direction === 'toWareki' ? '西暦 → 和暦' : '和暦 → 西暦'}
				</Label>
				<Switch
					checked={direction === 'toSeireki'}
					onCheckedChange={(checked) =>
						setDirection(checked ? 'toSeireki' : 'toWareki')
					}
				/>
				<ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
			</div>

			{/* Inputs */}
			<div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
				{direction === 'toWareki' ? (
					<>
						<div className="sm:col-span-6">
							<Label className="text-sm font-medium mb-2 block">
								西暦（年）
							</Label>
							<Input
								type="number"
								inputMode="numeric"
								step={1}
								min={1}
								value={seirekiYearInput}
								onChange={(e) => setSeirekiYearInput(e.target.value)}
								className="rounded-xl focus:ring-2 focus:ring-primary"
							/>
						</div>
						<MonthDaySelects
							month={seirekiMonth}
							day={seirekiDay}
							onMonthChange={handleSeirekiMonthChange}
							onDayChange={setSeirekiDay}
						/>
					</>
				) : (
					<>
						<div className="sm:col-span-6">
							<Label className="text-sm font-medium mb-2 block">
								和暦（例: 昭和45年 / S45 / 令和元年）
							</Label>
							<Input
								type="text"
								value={warekiInput}
								onChange={(e) => setWarekiInput(e.target.value)}
								placeholder="昭和45年"
								className="rounded-xl focus:ring-2 focus:ring-primary"
							/>
						</div>
						<MonthDaySelects
							month={warekiMonth}
							day={warekiDay}
							onMonthChange={handleWarekiMonthChange}
							onDayChange={setWarekiDay}
						/>
					</>
				)}
			</div>

			<p className="text-xs text-muted-foreground">
				入力内容はサーバーへ送信しません。処理はブラウザ内で完結します。
			</p>

			{/* Range selector */}
			<div className="flex items-center gap-3 flex-wrap">
				<Label className="text-sm font-medium whitespace-nowrap">
					表示範囲
				</Label>
				<Tabs
					value={String(rangeYears)}
					onValueChange={(v) => setRangeYears(Number(v) as TableRangeYears)}
				>
					<TabsList>
						{TABLE_RANGE_YEAR_OPTIONS.map((option) => (
							<TabsTrigger key={option} value={String(option)}>
								±{option}年
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
			</div>

			{/* Result */}
			<Card className="rounded-xl overflow-hidden border-2">
				<div className="bg-muted/50 p-4 border-b flex justify-between items-center gap-2 flex-wrap">
					<div className="flex items-center gap-2 text-foreground font-medium">
						<Calendar className="h-4 w-4 text-primary" />
						<span>
							変換結果（早見表）
							{table && !error && (
								<span className="ml-1 font-normal text-sm text-muted-foreground">
									{table.centerWesternYear}年を中心に前後{table.rangeYears}年
								</span>
							)}
						</span>
					</div>
					{copyText && <CopyButton text={copyText} />}
				</div>
				<CardContent className="p-6 sm:p-8 space-y-4">
					{error ? (
						<div className="text-center text-red-500 py-4 font-medium">
							{error}
						</div>
					) : table ? (
						<>
							{/* PC: 4-column table listing multiple years */}
							<div className="hidden sm:block">
								<Table>
									<caption className="sr-only">
										{table.centerWesternYear}
										年を中心とした前後{table.rangeYears}
										年の和暦・西暦・干支・年齢の早見表。基準年の行はハイライト表示されています。
									</caption>
									<TableHeader>
										<TableRow>
											<TableHead>和暦</TableHead>
											<TableHead>西暦</TableHead>
											<TableHead>干支</TableHead>
											<TableHead>年齢</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{table.rows.map((row) => (
											<TableRow
												key={row.westernYear}
												data-testid="wareki-row"
												data-year={row.westernYear}
												className={cn(
													row.isInputYear &&
														'bg-primary/10 hover:bg-primary/15',
												)}
											>
												<TableCell className="whitespace-pre-line font-bold text-foreground">
													{formatEraColumnText(row.result).replace(
														/ \/ /g,
														'\n',
													)}
												</TableCell>
												<TableCell className="font-bold text-foreground">
													<span className="inline-flex items-center gap-2">
														{row.westernYear}年
														{row.isInputYear && (
															<Badge variant="default">基準年</Badge>
														)}
													</span>
												</TableCell>
												<TableCell className="font-bold text-foreground">
													{row.result.zodiac}年
												</TableCell>
												<TableCell className="font-bold text-foreground">
													{formatAgeColumnText(row.result)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>

							{/* Mobile: card list to avoid horizontal scroll */}
							<div className="sm:hidden space-y-2">
								{table.rows.map((row) => (
									<div
										key={row.westernYear}
										data-testid="wareki-row"
										data-year={row.westernYear}
										className={cn(
											'rounded-xl border p-3 space-y-2',
											row.isInputYear && 'border-primary bg-primary/5',
										)}
									>
										<div className="flex items-center justify-between">
											<span className="font-bold text-foreground">
												{row.westernYear}年
											</span>
											{row.isInputYear && (
												<Badge variant="default">基準年</Badge>
											)}
										</div>
										<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
											<div className="col-span-2">
												<span className="text-muted-foreground">和暦: </span>
												<span className="font-medium text-foreground">
													{formatEraColumnText(row.result)}
												</span>
											</div>
											<div>
												<span className="text-muted-foreground">干支: </span>
												<span className="font-medium text-foreground">
													{row.result.zodiac}年
												</span>
											</div>
											<div>
												<span className="text-muted-foreground">年齢: </span>
												<span className="font-medium text-foreground">
													{formatAgeColumnText(row.result)}
												</span>
											</div>
										</div>
									</div>
								))}
							</div>

							{table.notices.length > 0 && (
								<Alert>
									<AlertDescription>
										{table.notices.map((notice) => (
											<p key={notice}>{notice}</p>
										))}
									</AlertDescription>
								</Alert>
							)}
						</>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
