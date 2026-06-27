import {
	calculateTax,
	type RoundingMode,
	type TaxCalcInput,
} from '../../tools/tax.ts';
import { failure } from '../errors.ts';
import { createWebMcpTool } from '../tool-factory.ts';
import {
	isObject,
	optionalEnum,
	requireEnum,
	requireNumber,
} from '../validation.ts';

const TAX_RATES = ['3', '5', '8', '10', '8_reduced'] as const;
type TaxRateKey = (typeof TAX_RATES)[number];

const TAX_MODES = ['tax_included', 'tax_excluded'] as const;
type TaxMode = (typeof TAX_MODES)[number];

const ROUNDING_MODES = ['floor', 'ceil', 'round'] as const;

interface TaxInput {
	amount: number;
	taxRate: TaxRateKey;
	mode: TaxMode;
	rounding: RoundingMode;
}

interface TaxOutput {
	base: number;
	tax: number;
	total: number;
	result: number;
	taxAmount: number;
}

export const taxTool = createWebMcpTool<TaxInput, TaxOutput>({
	name: 'calc_tax',
	description:
		'Calculate Japanese consumption tax (tax-included ↔ tax-excluded). Runs entirely in the browser; no data is sent externally. / 金額から消費税を計算する（税込→税抜／税抜→税込）。処理はブラウザ内で完結し、外部送信は行わない。',
	inputSchema: {
		type: 'object',
		properties: {
			amount: {
				type: 'number',
				description:
					'Amount (tax-included or tax-excluded) / 税込または税抜の金額',
			},
			taxRate: {
				type: 'string',
				enum: TAX_RATES,
				description:
					'Tax rate key (8_reduced = reduced rate) / 税率区分（8_reduced は軽減税率）',
			},
			mode: {
				type: 'string',
				enum: TAX_MODES,
				description:
					'tax_included: extract base from tax-included amount; tax_excluded: calculate tax-included from base / 税込金額から税抜を求めるか、税抜金額から税込を求めるか',
			},
			rounding: {
				type: 'string',
				enum: ROUNDING_MODES,
				description:
					'Rounding mode for tax fraction (default: floor) / 端数処理（デフォルト: 切り捨て）',
			},
		},
		required: ['amount', 'taxRate', 'mode'],
	},
	outputSchema: {
		type: 'object',
		properties: {
			base: { type: 'number', description: 'Tax-excluded amount / 税抜金額' },
			tax: { type: 'number', description: 'Tax amount / 消費税額' },
			total: {
				type: 'number',
				description: 'Tax-included amount / 税込金額',
			},
			result: {
				type: 'number',
				description: 'Primary result based on mode / モードに応じた主要結果',
			},
			taxAmount: { type: 'number', description: 'Tax amount / 消費税額' },
		},
		required: ['base', 'tax', 'total', 'result', 'taxAmount'],
	},
	validate(input) {
		if (!isObject(input)) return failure('Input must be an object');
		const amount = requireNumber(input, 'amount');
		if (!amount.ok) return amount;
		const taxRate = requireEnum(input, 'taxRate', TAX_RATES);
		if (!taxRate.ok) return taxRate;
		const mode = requireEnum(input, 'mode', TAX_MODES);
		if (!mode.ok) return mode;
		const rounding = optionalEnum(input, 'rounding', ROUNDING_MODES, 'floor');
		if (!rounding.ok) return rounding;
		return {
			ok: true,
			value: {
				amount: amount.value,
				taxRate: taxRate.value,
				mode: mode.value,
				rounding: rounding.value,
			},
		};
	},
	execute(input) {
		const rateNum = Number(input.taxRate.replace('_reduced', ''));
		const dir: TaxCalcInput['direction'] =
			input.mode === 'tax_excluded'
				? 'exclusive-to-inclusive'
				: 'inclusive-to-exclusive';

		const res = calculateTax({
			amount: input.amount,
			rate: rateNum,
			direction: dir,
			rounding: input.rounding,
		});

		return {
			base: res.base,
			tax: res.tax,
			total: res.total,
			result: input.mode === 'tax_excluded' ? res.total : res.base,
			taxAmount: res.tax,
		};
	},
});
