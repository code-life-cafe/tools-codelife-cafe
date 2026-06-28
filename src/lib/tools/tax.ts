// 消費税・税込計算ツールのロジック（純粋関数のみ）
//
// 浮動小数点誤差を排除するため、税額計算は「整数 * 分子 / 分母」の形で行い、
// 端数処理（floor/round/ceil）は税額に対して1回だけ適用する。

export type RoundingMode = 'floor' | 'round' | 'ceil';

export interface TaxRateEntry {
	rate: number;
	label: string;
	appliedFrom: string;
	appliedTo?: string;
	reduced?: boolean;
}

export interface TaxCalcInput {
	amount: number;
	rate: number;
	direction: 'exclusive-to-inclusive' | 'inclusive-to-exclusive';
	rounding: RoundingMode;
}

export interface TaxCalcResult {
	base: number;
	tax: number;
	total: number;
}

export interface InvoiceLineInput {
	id: string;
	name: string;
	amount: number;
	quantity: number;
	rate: number;
	reduced?: boolean;
}

export interface InvoiceLineResult extends InvoiceLineInput {
	base: number;
	total: number;
}

export interface InvoiceRateSummary {
	rate: number;
	reduced?: boolean;
	base: number;
	tax: number;
	total: number;
}

export interface InvoiceCalcInput {
	lines: InvoiceLineInput[];
	direction: TaxCalcInput['direction'];
	rounding: RoundingMode;
}

export interface InvoiceCalcResult {
	lines: InvoiceLineResult[];
	summaries: InvoiceRateSummary[];
	base: number;
	tax: number;
	total: number;
}

export type AmountValidation =
	| { ok: true; amount: number; normalizedInput: string }
	| { ok: false; message: string; normalizedInput: string };

export type QuantityValidation =
	| { ok: true; quantity: number; normalizedInput: string }
	| { ok: false; message: string; normalizedInput: string };

/** 入力可能な金額の上限（1兆円） */
export const MAX_AMOUNT = 1_000_000_000_000;

/** 入力可能な数量の上限 */
export const MAX_QUANTITY = 999;

/** 消費税率の変遷履歴（適用開始日が新しい順） */
export const TAX_RATE_HISTORY: TaxRateEntry[] = [
	{
		rate: 10,
		label: '10%（標準税率）',
		appliedFrom: '2019-10-01',
	},
	{
		rate: 8,
		label: '8%（軽減税率）',
		appliedFrom: '2019-10-01',
		reduced: true,
	},
	{
		rate: 8,
		label: '8%',
		appliedFrom: '2014-04-01',
		appliedTo: '2019-09-30',
	},
	{
		rate: 5,
		label: '5%',
		appliedFrom: '1997-04-01',
		appliedTo: '2014-03-31',
	},
	{
		rate: 3,
		label: '3%',
		appliedFrom: '1989-04-01',
		appliedTo: '1997-03-31',
	},
];

/** 全角数字を半角数字に変換する */
function toHalfWidthDigits(input: string): string {
	return input.replace(/[０-９]/g, (ch) =>
		String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
	);
}

/** 数値入力文字列を正規化する */
function normalizeNumericInput(raw: string): string {
	return toHalfWidthDigits(raw)
		.trim()
		.replace(/[,，]/g, '')
		.replace(/\s+/g, '');
}

/**
 * 金額入力文字列を正規化・検証する。
 * 全角数字・カンマ（全角/半角）・前後の空白を除去し、0〜1兆円の整数のみ許容する。
 */
export function validateAmount(raw: string): AmountValidation {
	const normalizedInput = normalizeNumericInput(raw);

	if (normalizedInput === '') {
		return { ok: false, message: '金額を入力してください。', normalizedInput };
	}

	if (!/^-?\d+(\.\d+)?$/.test(normalizedInput)) {
		return {
			ok: false,
			message: '数値を入力してください。',
			normalizedInput,
		};
	}

	if (normalizedInput.startsWith('-')) {
		return {
			ok: false,
			message: '0以上の金額を入力してください。',
			normalizedInput,
		};
	}

	if (normalizedInput.includes('.')) {
		return {
			ok: false,
			message: '金額は整数で入力してください。',
			normalizedInput,
		};
	}

	const amount = Number(normalizedInput);

	if (!Number.isSafeInteger(amount)) {
		return {
			ok: false,
			message: '金額が大きすぎます。',
			normalizedInput,
		};
	}

	if (amount > MAX_AMOUNT) {
		return {
			ok: false,
			message: '金額は1兆円以下で入力してください。',
			normalizedInput,
		};
	}

	return { ok: true, amount, normalizedInput };
}

/** 数量入力文字列を正規化・検証する。 */
export function validateQuantity(raw: string): QuantityValidation {
	const normalizedInput = normalizeNumericInput(raw);

	if (normalizedInput === '') {
		return { ok: false, message: '数量を入力してください。', normalizedInput };
	}

	if (!/^-?\d+(\.\d+)?$/.test(normalizedInput)) {
		return {
			ok: false,
			message: '数量は数値で入力してください。',
			normalizedInput,
		};
	}

	if (normalizedInput.startsWith('-') || normalizedInput === '0') {
		return {
			ok: false,
			message: '数量は1以上で入力してください。',
			normalizedInput,
		};
	}

	if (normalizedInput.includes('.')) {
		return {
			ok: false,
			message: '数量は整数で入力してください。',
			normalizedInput,
		};
	}

	const quantity = Number(normalizedInput);

	if (!Number.isSafeInteger(quantity)) {
		return {
			ok: false,
			message: '数量が大きすぎます。',
			normalizedInput,
		};
	}

	if (quantity > MAX_QUANTITY) {
		return {
			ok: false,
			message: `数量は${MAX_QUANTITY.toLocaleString('ja-JP')}以下で入力してください。`,
			normalizedInput,
		};
	}

	return { ok: true, quantity, normalizedInput };
}

/**
 * 端数処理を適用する。
 * numerator / denominator の除算結果に対して floor / round / ceil を適用する整数演算。
 */
function applyRounding(
	numerator: number,
	denominator: number,
	rounding: RoundingMode,
): number {
	const quotient = Math.floor(numerator / denominator);
	const remainder = numerator % denominator;

	if (remainder === 0) return quotient;

	switch (rounding) {
		case 'floor':
			return quotient;
		case 'ceil':
			return quotient + 1;
		case 'round':
			return remainder * 2 >= denominator ? quotient + 1 : quotient;
		default:
			return quotient;
	}
}

function rateGroupKey(rate: number, reduced?: boolean): string {
	return `${rate}:${reduced ? 'reduced' : 'standard'}`;
}

/**
 * 消費税額・税抜金額・税込金額を計算する。
 *
 * - 税抜→税込: tax = round(base * rate / 100), total = base + tax
 * - 税込→税抜: tax = round(total * rate / (100 + rate)), base = total - tax
 *
 * いずれも整数演算（分子 / 分母）で求め、端数処理は税額に対して1回だけ適用する。
 */
export function calculateTax(input: TaxCalcInput): TaxCalcResult {
	const { amount, rate, direction, rounding } = input;

	if (direction === 'exclusive-to-inclusive') {
		const tax = applyRounding(amount * rate, 100, rounding);
		const base = amount;
		return { base, tax, total: base + tax };
	}

	const tax = applyRounding(amount * rate, 100 + rate, rounding);
	const total = amount;
	return { base: total - tax, tax, total };
}

/**
 * インボイス制度向けに、複数明細を税率ごとに集計してから税額を計算する。
 * 適格請求書の消費税額等は、1つの請求書につき税率ごとに1回だけ端数処理する。
 */
export function calculateInvoiceTax(
	input: InvoiceCalcInput,
): InvoiceCalcResult {
	const { lines, direction, rounding } = input;
	const grouped = new Map<string, InvoiceRateSummary>();
	const calculatedLines = lines.map((line) => {
		const lineAmount = line.amount * line.quantity;
		const lineTaxResult = calculateTax({
			amount: lineAmount,
			rate: line.rate,
			direction,
			rounding,
		});
		const lineResult: InvoiceLineResult = {
			...line,
			base: lineTaxResult.base,
			total: lineTaxResult.total,
		};
		const key = rateGroupKey(line.rate, line.reduced);
		const current = grouped.get(key) ?? {
			rate: line.rate,
			reduced: line.reduced,
			base: 0,
			tax: 0,
			total: 0,
		};

		if (direction === 'exclusive-to-inclusive') {
			current.base += lineAmount;
		} else {
			current.total += lineAmount;
		}

		grouped.set(key, current);
		return lineResult;
	});

	const summaries = Array.from(grouped.values()).map((summary) => {
		if (direction === 'exclusive-to-inclusive') {
			const tax = applyRounding(summary.base * summary.rate, 100, rounding);
			return { ...summary, tax, total: summary.base + tax };
		}

		const tax = applyRounding(
			summary.total * summary.rate,
			100 + summary.rate,
			rounding,
		);
		return { ...summary, base: summary.total - tax, tax };
	});

	const result: InvoiceCalcResult = {
		lines: calculatedLines,
		summaries,
		base: 0,
		tax: 0,
		total: 0,
	};

	for (const summary of summaries) {
		result.base += summary.base;
		result.tax += summary.tax;
		result.total += summary.total;
	}

	return result;
}
