import { ChevronDown, Info } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
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
import {
	calculateTax,
	type RoundingMode,
	TAX_RATE_HISTORY,
	type TaxCalcInput,
	validateAmount,
} from '@/lib/tools/tax';

type Direction = TaxCalcInput['direction'];

const ROUNDING_OPTIONS: { value: RoundingMode; label: string }[] = [
	{ value: 'floor', label: '切り捨て' },
	{ value: 'round', label: '四捨五入' },
	{ value: 'ceil', label: '切り上げ' },
];

// 税率セレクタの選択肢（現行税率と過去税率をグループ表示）
const CURRENT_RATES = TAX_RATE_HISTORY.filter((entry) => !entry.appliedTo);
const PAST_RATES = TAX_RATE_HISTORY.filter((entry) => entry.appliedTo);

function rateKey(rate: number, reduced?: boolean): string {
	return reduced ? `${rate}-reduced` : `${rate}`;
}

function formatYen(value: number): string {
	return `${value.toLocaleString('ja-JP')}円`;
}

export function TaxCalcPage() {
	const [rawAmount, setRawAmount] = useState('');
	const [direction, setDirection] = useState<Direction>(
		'exclusive-to-inclusive',
	);
	const [rateSelection, setRateSelection] = useState('10');
	const [rounding, setRounding] = useState<RoundingMode>('floor');

	const validation = useMemo(() => validateAmount(rawAmount), [rawAmount]);

	const selectedRate = useMemo(() => {
		const reduced = rateSelection.endsWith('-reduced');
		const rate = Number(rateSelection.replace('-reduced', ''));
		return { rate, reduced };
	}, [rateSelection]);

	const result = useMemo(() => {
		if (rawAmount.trim() === '' || !validation.ok) return null;
		return calculateTax({
			amount: validation.amount,
			rate: selectedRate.rate,
			direction,
			rounding,
		});
	}, [rawAmount, validation, selectedRate.rate, direction, rounding]);

	const handleAmountChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			setRawAmount(e.target.value);
		},
		[],
	);

	const showError = rawAmount.trim() !== '' && !validation.ok;

	return (
		<div className="space-y-6">
			{/* 方向切替 */}
			<Tabs
				value={direction}
				onValueChange={(value) => setDirection(value as Direction)}
			>
				<TabsList className="w-full grid grid-cols-2">
					<TabsTrigger value="exclusive-to-inclusive">税抜 → 税込</TabsTrigger>
					<TabsTrigger value="inclusive-to-exclusive">税込 → 税抜</TabsTrigger>
				</TabsList>
			</Tabs>

			{/* 入力エリア */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<div className="space-y-2 md:col-span-1">
					<Label htmlFor="tax-amount">
						{direction === 'exclusive-to-inclusive' ? '税抜金額' : '税込金額'}
					</Label>
					<Input
						id="tax-amount"
						type="text"
						inputMode="numeric"
						value={rawAmount}
						onChange={handleAmountChange}
						placeholder="例: 10000"
						aria-label="金額"
						aria-invalid={showError}
					/>
				</div>

				<div className="space-y-2 md:col-span-1">
					<Label htmlFor="tax-rate">税率</Label>
					<Select value={rateSelection} onValueChange={setRateSelection}>
						<SelectTrigger id="tax-rate" className="w-full" aria-label="税率">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								<SelectLabel>現行税率</SelectLabel>
								{CURRENT_RATES.map((entry) => (
									<SelectItem
										key={rateKey(entry.rate, entry.reduced)}
										value={rateKey(entry.rate, entry.reduced)}
									>
										{entry.label}
									</SelectItem>
								))}
							</SelectGroup>
							<SelectGroup>
								<SelectLabel>過去税率</SelectLabel>
								{PAST_RATES.map((entry) => (
									<SelectItem
										key={`${rateKey(entry.rate, entry.reduced)}-${entry.appliedFrom}`}
										value={rateKey(entry.rate, entry.reduced)}
									>
										{entry.label}（{entry.appliedFrom}〜{entry.appliedTo}）
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-2 md:col-span-1">
					<Label htmlFor="tax-rounding">端数処理</Label>
					<Select
						value={rounding}
						onValueChange={(value) => setRounding(value as RoundingMode)}
					>
						<SelectTrigger
							id="tax-rounding"
							className="w-full"
							aria-label="端数処理"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{ROUNDING_OPTIONS.map((opt) => (
								<SelectItem key={opt.value} value={opt.value}>
									{opt.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			{/* エラー表示 */}
			{showError && !validation.ok && (
				<div
					className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
					role="alert"
					data-testid="tax-error"
				>
					{validation.message}
				</div>
			)}

			{/* 結果表示 */}
			{result && (
				<div
					className="grid grid-cols-1 sm:grid-cols-3 gap-4"
					data-testid="tax-result"
				>
					<ResultCard label="税抜金額" value={result.base} />
					<ResultCard label="消費税額" value={result.tax} />
					<ResultCard label="税込金額" value={result.total} highlight />
				</div>
			)}

			{/* 端数処理の注記 */}
			{result && direction === 'inclusive-to-exclusive' && (
				<div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
					<Info className="h-4 w-4 shrink-0 mt-0.5" />
					<p>
						税込→税抜の逆算は端数処理の影響で、税抜→税込の結果と1円単位で一致しない場合があります。
					</p>
				</div>
			)}

			{/* 税率履歴テーブル */}
			<Collapsible>
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="group flex w-full items-center justify-between rounded-lg border border-border p-3 text-sm font-semibold transition-colors hover:bg-muted"
					>
						消費税率の変遷
						<ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent className="mt-2">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>税率</TableHead>
								<TableHead>適用期間</TableHead>
								<TableHead>備考</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{TAX_RATE_HISTORY.map((entry) => (
								<TableRow
									key={`${rateKey(entry.rate, entry.reduced)}-${entry.appliedFrom}`}
								>
									<TableCell className="font-medium">{entry.rate}%</TableCell>
									<TableCell>
										{entry.appliedFrom}
										{entry.appliedTo ? `〜${entry.appliedTo}` : '〜現在'}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{entry.reduced ? '軽減税率' : '標準税率'}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}

function ResultCard({
	label,
	value,
	highlight = false,
}: {
	label: string;
	value: number;
	highlight?: boolean;
}) {
	const text = formatYen(value);
	return (
		<div
			className={`rounded-xl border p-4 space-y-2 ${
				highlight
					? 'border-primary/50 bg-primary/5'
					: 'border-border bg-muted/20'
			}`}
		>
			<div className="flex items-center justify-between">
				<span className="text-sm font-medium text-muted-foreground">
					{label}
				</span>
				<CopyButton text={String(value)} size="sm" />
			</div>
			<p
				className={`text-2xl font-bold tabular-nums ${highlight ? 'text-primary' : ''}`}
			>
				{text}
			</p>
		</div>
	);
}
