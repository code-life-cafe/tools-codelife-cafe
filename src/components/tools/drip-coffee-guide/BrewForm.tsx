import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
	type BrewInput,
	calcBrewRatio,
	calcEy,
	type MethodId,
	validateBrewInput,
} from '@/lib/tools/drip-coffee-guide';

const METHOD_LABELS: Record<MethodId, string> = {
	v60: 'V60',
	switch: 'Switch',
	kalita: 'カリタ',
	pour_other: 'その他（透過式）',
};

export interface BrewFormValues {
	bean_name: string;
	method: MethodId;
	dose_g: string;
	yield_g: string;
	water_amount_ml: string;
	water_temp_c: string;
	bloom_time_sec: string;
	grind_note: string;
	brew_time_sec: string;
	tds: string;
	overall_score: string;
	notes: string;
	recipe_id?: string;
	recipe_name?: string;
}

export function createEmptyBrewFormValues(): BrewFormValues {
	return {
		bean_name: '',
		method: 'v60',
		dose_g: '',
		yield_g: '',
		water_amount_ml: '',
		water_temp_c: '',
		bloom_time_sec: '',
		grind_note: '',
		brew_time_sec: '',
		tds: '',
		overall_score: '',
		notes: '',
	};
}

function parseNumber(raw: string): number | undefined {
	if (raw.trim() === '') return undefined;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

function parseFormValues(
	values: BrewFormValues,
): { ok: true; input: BrewInput } | { ok: false; errors: string[] } {
	const dose = parseNumber(values.dose_g);
	const yieldG = parseNumber(values.yield_g);
	const brewTime = parseNumber(values.brew_time_sec);
	const errors: string[] = [];
	if (values.bean_name.trim() === '') errors.push('豆名を入力してください。');
	if (dose === undefined) errors.push('豆量を入力してください。');
	if (yieldG === undefined) errors.push('抽出量を入力してください。');
	if (brewTime === undefined) errors.push('抽出時間を入力してください。');
	if (errors.length > 0) return { ok: false, errors };

	const input: BrewInput = {
		bean_name: values.bean_name.trim(),
		method: values.method,
		// biome-ignore lint/style/noNonNullAssertion: 直前のerrors.lengthチェックでundefinedでないことを保証済み
		dose_g: dose!,
		// biome-ignore lint/style/noNonNullAssertion: 直前のerrors.lengthチェックでundefinedでないことを保証済み
		yield_g: yieldG!,
		// biome-ignore lint/style/noNonNullAssertion: 直前のerrors.lengthチェックでundefinedでないことを保証済み
		brew_time_sec: brewTime!,
		water_amount_ml: parseNumber(values.water_amount_ml),
		water_temp_c: parseNumber(values.water_temp_c),
		bloom_time_sec: parseNumber(values.bloom_time_sec),
		grind_note: values.grind_note.trim() || undefined,
		tds: parseNumber(values.tds),
		overall_score: parseNumber(values.overall_score),
		notes: values.notes.trim() || undefined,
		recipe_id: values.recipe_id || undefined,
		recipe_name: values.recipe_name || undefined,
	};
	const validation = validateBrewInput(input);
	if (!validation.ok) return { ok: false, errors: validation.errors };
	return { ok: true, input };
}

interface BrewFormProps {
	open: boolean;
	mode: 'new' | 'edit';
	initialValues: BrewFormValues;
	recentBeanNames: readonly string[];
	onCancel: () => void;
	onSubmit: (input: BrewInput) => void;
}

export function BrewForm({
	open,
	mode,
	initialValues,
	recentBeanNames,
	onCancel,
	onSubmit,
}: BrewFormProps) {
	const [values, setValues] = useState(initialValues);
	const [openValues, setOpenValues] = useState(initialValues);
	const [errors, setErrors] = useState<string[]>([]);

	// ダイアログを開くたびに、その時点の初期値でフォームを再初期化する
	if (open && openValues !== initialValues) {
		setOpenValues(initialValues);
		setValues(initialValues);
		setErrors([]);
	}

	const patch = (partial: Partial<BrewFormValues>) => {
		setValues((prev) => ({ ...prev, ...partial }));
	};

	const doseNum = parseNumber(values.dose_g);
	const yieldNum = parseNumber(values.yield_g);
	const tdsNum = parseNumber(values.tds);
	const ratio = useMemo(
		() =>
			doseNum !== undefined && yieldNum !== undefined
				? calcBrewRatio(doseNum, yieldNum)
				: undefined,
		[doseNum, yieldNum],
	);
	const ey = useMemo(
		() =>
			doseNum !== undefined && yieldNum !== undefined
				? calcEy(doseNum, yieldNum, tdsNum)
				: undefined,
		[doseNum, yieldNum, tdsNum],
	);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const parsed = parseFormValues(values);
		if (!parsed.ok) {
			setErrors(parsed.errors);
			return;
		}
		try {
			onSubmit(parsed.input);
		} catch (err) {
			setErrors([err instanceof Error ? err.message : '保存に失敗しました。']);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{mode === 'new' ? '抽出を記録' : '記録を編集'}
					</DialogTitle>
					<DialogDescription>
						豆名・抽出器具・豆量・抽出量・抽出時間は必須です。このデータはブラウザ内だけに保存されます。
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div className="space-y-2 sm:col-span-2">
							<Label htmlFor="brew-bean-name">豆名</Label>
							<BeanNameField
								id="brew-bean-name"
								value={values.bean_name}
								suggestions={recentBeanNames}
								onChange={(v) => patch({ bean_name: v })}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="brew-method">抽出器具</Label>
							<Select
								value={values.method}
								onValueChange={(v) => patch({ method: v as MethodId })}
							>
								<SelectTrigger
									id="brew-method"
									className="w-full"
									aria-label="抽出器具"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{(Object.keys(METHOD_LABELS) as MethodId[]).map((id) => (
										<SelectItem key={id} value={id}>
											{METHOD_LABELS[id]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<NumberField
							id="brew-dose"
							label="豆量"
							unit="g"
							value={values.dose_g}
							onChange={(v) => patch({ dose_g: v })}
							required
						/>
						<NumberField
							id="brew-yield"
							label="抽出量"
							unit="g"
							value={values.yield_g}
							onChange={(v) => patch({ yield_g: v })}
							required
						/>
						<NumberField
							id="brew-time"
							label="抽出時間"
							unit="秒"
							value={values.brew_time_sec}
							onChange={(v) => patch({ brew_time_sec: v })}
							required
						/>
						<NumberField
							id="brew-bloom-time"
							label="蒸らし時間"
							unit="秒"
							value={values.bloom_time_sec}
							onChange={(v) => patch({ bloom_time_sec: v })}
						/>
						<NumberField
							id="brew-water-amount"
							label="総湯量"
							unit="ml"
							value={values.water_amount_ml}
							onChange={(v) => patch({ water_amount_ml: v })}
						/>
						<NumberField
							id="brew-water-temp"
							label="湯温"
							unit="℃"
							value={values.water_temp_c}
							onChange={(v) => patch({ water_temp_c: v })}
						/>
						<div className="space-y-2">
							<Label htmlFor="brew-grind">挽き目</Label>
							<Input
								id="brew-grind"
								value={values.grind_note}
								onChange={(e) => patch({ grind_note: e.target.value })}
								placeholder="例: 中細挽き"
							/>
						</div>
						<NumberField
							id="brew-tds"
							label="TDS"
							unit="%"
							value={values.tds}
							onChange={(v) => patch({ tds: v })}
						/>
						<NumberField
							id="brew-score"
							label="点数"
							unit="/10"
							value={values.overall_score}
							onChange={(v) => patch({ overall_score: v })}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="brew-notes">メモ</Label>
						<Textarea
							id="brew-notes"
							value={values.notes}
							onChange={(e) => patch({ notes: e.target.value })}
							placeholder="味の印象などを自由に記録できます"
							resize="vertical"
						/>
					</div>

					{(ratio !== undefined || ey !== undefined) && (
						<div
							className="grid grid-cols-2 gap-4"
							data-testid="brew-calculated-metrics"
						>
							<div className="rounded-lg border border-border bg-muted/20 p-3">
								<p className="text-xs text-muted-foreground">レシオ</p>
								<p className="text-lg font-semibold tabular-nums">
									{ratio !== undefined ? `1 : ${ratio.toFixed(1)}` : '—'}
								</p>
							</div>
							<div className="rounded-lg border border-border bg-muted/20 p-3">
								<p className="text-xs text-muted-foreground">EY（抽出収率）</p>
								<p className="text-lg font-semibold tabular-nums">
									{ey !== undefined ? `${ey.toFixed(1)}%` : '—'}
								</p>
							</div>
						</div>
					)}

					{errors.length > 0 && (
						<div
							className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
							role="alert"
						>
							<ul className="list-disc pl-5">
								{errors.map((error) => (
									<li key={error}>{error}</li>
								))}
							</ul>
						</div>
					)}

					<DialogFooter className="gap-3">
						<Button
							type="button"
							variant="outline"
							className="h-11"
							onClick={onCancel}
						>
							キャンセル
						</Button>
						<Button type="submit" className="h-11">
							保存する
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function NumberField({
	id,
	label,
	unit,
	value,
	onChange,
	required,
}: {
	id: string;
	label: string;
	unit: string;
	value: string;
	onChange: (value: string) => void;
	required?: boolean;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>
				{label}
				{required ? '（必須）' : ''}
			</Label>
			<div className="relative">
				<Input
					id={id}
					type="text"
					inputMode="decimal"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					aria-label={label}
					className="pr-10"
				/>
				<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
					{unit}
				</span>
			</div>
		</div>
	);
}

function BeanNameField({
	id,
	value,
	suggestions,
	onChange,
}: {
	id: string;
	value: string;
	suggestions: readonly string[];
	onChange: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const filtered = suggestions.filter(
		(name) =>
			value.trim() === '' ||
			name.toLowerCase().includes(value.trim().toLowerCase()),
	);

	return (
		<Popover open={open && filtered.length > 0} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Input
					id={id}
					type="text"
					value={value}
					onChange={(e) => {
						onChange(e.target.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					placeholder="例: エチオピア イルガチェフェ"
					autoComplete="off"
					aria-label="豆名"
				/>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-(--radix-popover-trigger-width) p-1"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<ul className="max-h-48 overflow-y-auto">
					{filtered.map((name) => (
						<li key={name}>
							<button
								type="button"
								className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
								onClick={() => {
									onChange(name);
									setOpen(false);
								}}
							>
								{name}
							</button>
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	);
}
