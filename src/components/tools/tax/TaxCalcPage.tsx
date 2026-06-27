import { ChevronDown, Info, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
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
	calculateInvoiceTax,
	calculateTax,
	type InvoiceLineInput,
	type RoundingMode,
	TAX_RATE_HISTORY,
	type TaxCalcInput,
	validateAmount,
	validateQuantity,
} from '@/lib/tools/tax';
import { provideToolsFromFactory } from '@/lib/webmcp';
import { taxTool } from '@/lib/webmcp/tools/tax.webmcp';

type Direction = TaxCalcInput['direction'];
type CalcMode = 'single' | 'invoice';

interface InvoiceLineForm {
	id: string;
	name: string;
	amount: string;
	quantity: string;
	rateSelection: string;
}

const ROUNDING_OPTIONS: { value: RoundingMode; label: string }[] = [
	{ value: 'floor', label: '切り捨て' },
	{ value: 'round', label: '四捨五入' },
	{ value: 'ceil', label: '切り上げ' },
];

// 税率セレクタの選択肢（現行税率と過去税率をグループ表示）
const CURRENT_RATES = TAX_RATE_HISTORY.filter((entry) => !entry.appliedTo);
const PAST_RATES = TAX_RATE_HISTORY.filter((entry) => entry.appliedTo);

function createInvoiceLine(index: number): InvoiceLineForm {
	return {
		id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${index}`,
		name: `明細${index}`,
		amount: '',
		quantity: '1',
		rateSelection: index % 2 === 0 ? '8-reduced' : '10',
	};
}

function rateKey(rate: number, reduced?: boolean): string {
	return reduced ? `${rate}-reduced` : `${rate}`;
}

function parseRateSelection(selection: string): {
	rate: number;
	reduced?: boolean;
} {
	const reduced = selection.endsWith('-reduced');
	const rate = Number(selection.replace('-reduced', ''));
	return { rate, reduced: reduced || undefined };
}

function formatYen(value: number): string {
	return `${value.toLocaleString('ja-JP')}円`;
}

export function TaxCalcPage() {
	const [mode, setMode] = useState<CalcMode>('single');
	const [rawAmount, setRawAmount] = useState('');
	const [direction, setDirection] = useState<Direction>(
		'exclusive-to-inclusive',
	);
	const [rateSelection, setRateSelection] = useState('10');
	const [rounding, setRounding] = useState<RoundingMode>('floor');
	const [invoiceLines, setInvoiceLines] = useState<InvoiceLineForm[]>([
		createInvoiceLine(1),
		createInvoiceLine(2),
	]);

	// --- WebMCP Tool Registration ---
	useEffect(() => {
		const cleanup = provideToolsFromFactory([taxTool]);
		return cleanup;
	}, []);

	const validation = useMemo(() => validateAmount(rawAmount), [rawAmount]);

	const selectedRate = useMemo(
		() => parseRateSelection(rateSelection),
		[rateSelection],
	);

	const result = useMemo(() => {
		if (rawAmount.trim() === '' || !validation.ok) return null;
		return calculateTax({
			amount: validation.amount,
			rate: selectedRate.rate,
			direction,
			rounding,
		});
	}, [rawAmount, validation, selectedRate.rate, direction, rounding]);

	const invoiceValidation = useMemo(() => {
		const errors: string[] = [];
		const lines: InvoiceLineInput[] = [];

		invoiceLines.forEach((line, index) => {
			const amount = validateAmount(line.amount);
			const quantity = validateQuantity(line.quantity);

			if (!amount.ok && line.amount.trim() !== '') {
				errors.push(`${index + 1}行目: ${amount.message}`);
			}
			if (!quantity.ok && line.quantity.trim() !== '') {
				errors.push(`${index + 1}行目: ${quantity.message}`);
			}
			if (amount.ok && quantity.ok) {
				const rate = parseRateSelection(line.rateSelection);
				lines.push({
					id: line.id,
					name: line.name.trim() || `明細${index + 1}`,
					amount: amount.amount,
					quantity: quantity.quantity,
					rate: rate.rate,
					reduced: rate.reduced,
				});
			}
		});

		return { errors, lines };
	}, [invoiceLines]);

	const invoiceResult = useMemo(() => {
		if (
			invoiceValidation.errors.length > 0 ||
			invoiceValidation.lines.length === 0
		) {
			return null;
		}

		return calculateInvoiceTax({
			lines: invoiceValidation.lines,
			direction,
			rounding,
		});
	}, [invoiceValidation, direction, rounding]);

	const handleAmountChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			setRawAmount(e.target.value);
		},
		[],
	);

	const updateInvoiceLine = useCallback(
		(id: string, patch: Partial<InvoiceLineForm>) => {
			setInvoiceLines((current) =>
				current.map((line) => (line.id === id ? { ...line, ...patch } : line)),
			);
		},
		[],
	);

	const addInvoiceLine = useCallback(() => {
		setInvoiceLines((current) => [
			...current,
			createInvoiceLine(current.length + 1),
		]);
	}, []);

	const removeInvoiceLine = useCallback((id: string) => {
		setInvoiceLines((current) =>
			current.length <= 1 ? current : current.filter((line) => line.id !== id),
		);
	}, []);

	const showError = rawAmount.trim() !== '' && !validation.ok;

	return (
		<div className="space-y-6">
			<Tabs value={mode} onValueChange={(value) => setMode(value as CalcMode)}>
				<TabsList className="w-full grid grid-cols-2">
					<TabsTrigger value="single">単一金額</TabsTrigger>
					<TabsTrigger value="invoice">複数明細（インボイス）</TabsTrigger>
				</TabsList>
			</Tabs>

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

			{mode === 'single' ? (
				<SingleAmountPanel
					direction={direction}
					rawAmount={rawAmount}
					rateSelection={rateSelection}
					rounding={rounding}
					result={result}
					showError={showError}
					errorMessage={!validation.ok ? validation.message : ''}
					onAmountChange={handleAmountChange}
					onRateChange={setRateSelection}
					onRoundingChange={setRounding}
				/>
			) : (
				<InvoicePanel
					direction={direction}
					lines={invoiceLines}
					rounding={rounding}
					result={invoiceResult}
					errors={invoiceValidation.errors}
					onLineChange={updateInvoiceLine}
					onAddLine={addInvoiceLine}
					onRemoveLine={removeInvoiceLine}
					onRoundingChange={setRounding}
				/>
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

function SingleAmountPanel({
	direction,
	rawAmount,
	rateSelection,
	rounding,
	result,
	showError,
	errorMessage,
	onAmountChange,
	onRateChange,
	onRoundingChange,
}: {
	direction: Direction;
	rawAmount: string;
	rateSelection: string;
	rounding: RoundingMode;
	result: ReturnType<typeof calculateTax> | null;
	showError: boolean;
	errorMessage: string;
	onAmountChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
	onRateChange: (value: string) => void;
	onRoundingChange: (value: RoundingMode) => void;
}) {
	return (
		<>
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
						onChange={onAmountChange}
						placeholder="例: 10000"
						aria-label="金額"
						aria-invalid={showError}
					/>
				</div>

				<div className="space-y-2 md:col-span-1">
					<Label htmlFor="tax-rate">税率</Label>
					<TaxRateSelect
						id="tax-rate"
						value={rateSelection}
						onChange={onRateChange}
					/>
				</div>

				<RoundingSelect value={rounding} onChange={onRoundingChange} />
			</div>

			{/* エラー表示 */}
			{showError && (
				<div
					className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
					role="alert"
					data-testid="tax-error"
				>
					{errorMessage}
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
			{result && direction === 'inclusive-to-exclusive' && <InclusiveNote />}
		</>
	);
}

function InvoicePanel({
	direction,
	lines,
	rounding,
	result,
	errors,
	onLineChange,
	onAddLine,
	onRemoveLine,
	onRoundingChange,
}: {
	direction: Direction;
	lines: InvoiceLineForm[];
	rounding: RoundingMode;
	result: ReturnType<typeof calculateInvoiceTax> | null;
	errors: string[];
	onLineChange: (id: string, patch: Partial<InvoiceLineForm>) => void;
	onAddLine: () => void;
	onRemoveLine: (id: string) => void;
	onRoundingChange: (value: RoundingMode) => void;
}) {
	return (
		<div className="space-y-5">
			<div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm text-muted-foreground">
				<div className="flex items-start gap-2">
					<Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
					<p>
						インボイス制度に合わせ、明細ごとではなく「1つの請求書につき税率ごとに1回」端数処理して消費税額を計算します。
					</p>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<RoundingSelect value={rounding} onChange={onRoundingChange} />
			</div>

			<div className="overflow-x-auto rounded-xl border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="min-w-36">品目名</TableHead>
							<TableHead className="min-w-32">
								{direction === 'exclusive-to-inclusive'
									? '税抜単価'
									: '税込単価'}
							</TableHead>
							<TableHead className="min-w-24">数量</TableHead>
							<TableHead className="min-w-40">税率</TableHead>
							<TableHead className="w-16">削除</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{lines.map((line) => (
							<TableRow key={line.id}>
								<TableCell>
									<Input
										value={line.name}
										onChange={(e) =>
											onLineChange(line.id, { name: e.target.value })
										}
										placeholder="例: 食品"
										aria-label="品目名"
									/>
								</TableCell>
								<TableCell>
									<Input
										value={line.amount}
										onChange={(e) =>
											onLineChange(line.id, { amount: e.target.value })
										}
										placeholder="1000"
										inputMode="numeric"
										aria-label="単価"
									/>
								</TableCell>
								<TableCell>
									<Input
										value={line.quantity}
										onChange={(e) =>
											onLineChange(line.id, { quantity: e.target.value })
										}
										inputMode="numeric"
										aria-label="数量"
									/>
								</TableCell>
								<TableCell>
									<TaxRateSelect
										value={line.rateSelection}
										onChange={(value) =>
											onLineChange(line.id, { rateSelection: value })
										}
									/>
								</TableCell>
								<TableCell>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										onClick={() => onRemoveLine(line.id)}
										disabled={lines.length <= 1}
										aria-label="明細を削除"
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			<Button type="button" variant="outline" onClick={onAddLine}>
				<Plus className="h-4 w-4" />
				明細を追加
			</Button>

			{errors.length > 0 && (
				<div
					className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
					role="alert"
				>
					<ul className="list-disc pl-5">
						{errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
				</div>
			)}

			{result && (
				<div className="space-y-4" data-testid="tax-invoice-result">
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
						<ResultCard label="税抜合計" value={result.base} />
						<ResultCard label="消費税額合計" value={result.tax} />
						<ResultCard label="税込合計" value={result.total} highlight />
					</div>

					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>税率区分</TableHead>
								<TableHead className="text-right">税抜対象額</TableHead>
								<TableHead className="text-right">消費税額</TableHead>
								<TableHead className="text-right">税込対象額</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{result.summaries.map((summary) => (
								<TableRow key={rateKey(summary.rate, summary.reduced)}>
									<TableCell className="font-medium">
										{summary.rate}%{summary.reduced ? '（軽減税率）' : ''}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatYen(summary.base)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatYen(summary.tax)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatYen(summary.total)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{result && direction === 'inclusive-to-exclusive' && <InclusiveNote />}
		</div>
	);
}

function TaxRateSelect({
	id,
	value,
	onChange,
}: {
	id?: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger id={id} className="w-full" aria-label="税率">
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
	);
}

function RoundingSelect({
	value,
	onChange,
}: {
	value: RoundingMode;
	onChange: (value: RoundingMode) => void;
}) {
	return (
		<div className="space-y-2 md:col-span-1">
			<Label htmlFor="tax-rounding">端数処理</Label>
			<Select
				value={value}
				onValueChange={(next) => onChange(next as RoundingMode)}
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
	);
}

function InclusiveNote() {
	return (
		<div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
			<Info className="h-4 w-4 shrink-0 mt-0.5" />
			<p>
				税込→税抜の逆算は端数処理の影響で、税抜→税込の結果と1円単位で一致しない場合があります。
			</p>
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
