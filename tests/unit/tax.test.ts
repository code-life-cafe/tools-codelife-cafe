// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/tax.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	calculateInvoiceTax,
	calculateTax,
	MAX_AMOUNT,
	MAX_QUANTITY,
	TAX_RATE_HISTORY,
	validateAmount,
	validateQuantity,
} from '../../src/lib/tools/tax.ts';

// ---------------------------------------------------------------------------
// calculateTax
// ---------------------------------------------------------------------------

test('calculateTax: 10,000円 × 10% 税抜→税込 で税額1,000円・税込11,000円', () => {
	const result = calculateTax({
		amount: 10_000,
		rate: 10,
		direction: 'exclusive-to-inclusive',
		rounding: 'round',
	});
	assert.deepEqual(result, { base: 10_000, tax: 1_000, total: 11_000 });
});

test('calculateTax: 11,000円 × 10% 税込→税抜 で税額1,000円・税抜10,000円', () => {
	const result = calculateTax({
		amount: 11_000,
		rate: 10,
		direction: 'inclusive-to-exclusive',
		rounding: 'round',
	});
	assert.deepEqual(result, { base: 10_000, tax: 1_000, total: 11_000 });
});

test('calculateTax: 101円 × 10% 税抜→税込の端数処理（floor/round/ceil）', () => {
	const base = {
		amount: 101,
		rate: 10,
		direction: 'exclusive-to-inclusive' as const,
	};

	const floor = calculateTax({ ...base, rounding: 'floor' });
	assert.equal(floor.tax, 10, 'floor: 10.1 -> 10');
	assert.equal(floor.total, 111);

	const round = calculateTax({ ...base, rounding: 'round' });
	assert.equal(round.tax, 10, 'round: 10.1 -> 10');
	assert.equal(round.total, 111);

	const ceil = calculateTax({ ...base, rounding: 'ceil' });
	assert.equal(ceil.tax, 11, 'ceil: 10.1 -> 11');
	assert.equal(ceil.total, 112);
});

test('calculateTax: round の四捨五入境界（remainder * 2 >= denominator）', () => {
	// 15 * 10 / 100 = 1.5 -> round は切り上げて 2
	const halfUp = calculateTax({
		amount: 15,
		rate: 10,
		direction: 'exclusive-to-inclusive',
		rounding: 'round',
	});
	assert.equal(halfUp.tax, 2);

	// 14 * 10 / 100 = 1.4 -> round は切り下げて 1
	const halfDown = calculateTax({
		amount: 14,
		rate: 10,
		direction: 'exclusive-to-inclusive',
		rounding: 'round',
	});
	assert.equal(halfDown.tax, 1);
});

test('calculateTax: 0円はすべて0', () => {
	const exclusive = calculateTax({
		amount: 0,
		rate: 10,
		direction: 'exclusive-to-inclusive',
		rounding: 'round',
	});
	assert.deepEqual(exclusive, { base: 0, tax: 0, total: 0 });

	const inclusive = calculateTax({
		amount: 0,
		rate: 10,
		direction: 'inclusive-to-exclusive',
		rounding: 'round',
	});
	assert.deepEqual(inclusive, { base: 0, tax: 0, total: 0 });
});

test('calculateTax: 軽減税率8%（税抜→税込）', () => {
	const result = calculateTax({
		amount: 1_000,
		rate: 8,
		direction: 'exclusive-to-inclusive',
		rounding: 'round',
	});
	assert.deepEqual(result, { base: 1_000, tax: 80, total: 1_080 });
});

test('calculateTax: 過去税率3%/5%/8%（税抜→税込）', () => {
	const rate3 = calculateTax({
		amount: 1_000,
		rate: 3,
		direction: 'exclusive-to-inclusive',
		rounding: 'round',
	});
	assert.deepEqual(rate3, { base: 1_000, tax: 30, total: 1_030 });

	const rate5 = calculateTax({
		amount: 1_000,
		rate: 5,
		direction: 'exclusive-to-inclusive',
		rounding: 'round',
	});
	assert.deepEqual(rate5, { base: 1_000, tax: 50, total: 1_050 });

	const rate8 = calculateTax({
		amount: 1_000,
		rate: 8,
		direction: 'exclusive-to-inclusive',
		rounding: 'round',
	});
	assert.deepEqual(rate8, { base: 1_000, tax: 80, total: 1_080 });
});

test('calculateTax: 税込→税抜は端数処理によって税抜→税込の逆算と一致しない場合がある', () => {
	// 税込104円(round)を税抜に戻すと: tax = round(104 * 10 / 110) = round(9.45..) = 9, base = 95
	const backToExclusive = calculateTax({
		amount: 104,
		rate: 10,
		direction: 'inclusive-to-exclusive',
		rounding: 'round',
	});
	assert.deepEqual(backToExclusive, { base: 95, tax: 9, total: 104 });

	// その税抜95円を税込にすると: tax = round(95 * 10 / 100) = round(9.5) = 10, total = 105
	// となり、元の税込104円とは一致しない（非対称性の具体例）
	const toInclusive = calculateTax({
		amount: backToExclusive.base,
		rate: 10,
		direction: 'exclusive-to-inclusive',
		rounding: 'round',
	});
	assert.deepEqual(toInclusive, { base: 95, tax: 10, total: 105 });
	assert.notEqual(toInclusive.total, 104);
});

// ---------------------------------------------------------------------------
// calculateInvoiceTax
// ---------------------------------------------------------------------------

test('calculateInvoiceTax: 複数明細は税率ごとに合計してから端数処理する', () => {
	const result = calculateInvoiceTax({
		direction: 'exclusive-to-inclusive',
		rounding: 'floor',
		lines: [
			{
				id: 'food-1',
				name: '食品A',
				amount: 101,
				quantity: 1,
				rate: 8,
				reduced: true,
			},
			{
				id: 'food-2',
				name: '食品B',
				amount: 101,
				quantity: 1,
				rate: 8,
				reduced: true,
			},
		],
	});

	// 明細ごとに切り捨てると 8円 + 8円 = 16円だが、
	// インボイス対応では 202円 × 8% = 16.16円 を税率ごとに1回だけ切り捨てる。
	assert.deepEqual(result.summaries, [
		{ rate: 8, reduced: true, base: 202, tax: 16, total: 218 },
	]);
	assert.deepEqual(
		{ base: result.base, tax: result.tax, total: result.total },
		{ base: 202, tax: 16, total: 218 },
	);
});

test('calculateInvoiceTax: 8%軽減税率と10%標準税率を別々に集計する', () => {
	const result = calculateInvoiceTax({
		direction: 'exclusive-to-inclusive',
		rounding: 'round',
		lines: [
			{
				id: 'food',
				name: '食品',
				amount: 1_000,
				quantity: 2,
				rate: 8,
				reduced: true,
			},
			{
				id: 'goods',
				name: '雑貨',
				amount: 1_500,
				quantity: 1,
				rate: 10,
			},
		],
	});

	assert.deepEqual(result.summaries, [
		{ rate: 8, reduced: true, base: 2_000, tax: 160, total: 2_160 },
		{ rate: 10, reduced: undefined, base: 1_500, tax: 150, total: 1_650 },
	]);
	assert.deepEqual(
		{ base: result.base, tax: result.tax, total: result.total },
		{ base: 3_500, tax: 310, total: 3_810 },
	);
});

test('calculateInvoiceTax: 税込明細は税率ごとの税込合計から税額を逆算する', () => {
	const result = calculateInvoiceTax({
		direction: 'inclusive-to-exclusive',
		rounding: 'round',
		lines: [
			{ id: 'a', name: 'A', amount: 55, quantity: 1, rate: 10 },
			{ id: 'b', name: 'B', amount: 55, quantity: 1, rate: 10 },
		],
	});

	assert.deepEqual(result.summaries, [
		{ rate: 10, reduced: undefined, base: 100, tax: 10, total: 110 },
	]);
	// 各明細行の base が正値（50）になっていることを検証
	assert.strictEqual(result.lines[0].base, 50);
	assert.strictEqual(result.lines[1].base, 50);
});

test('calculateInvoiceTax: 税込→税抜で8%と10%が混在する複数明細の各行base計算と金額整合性', () => {
	const result = calculateInvoiceTax({
		direction: 'inclusive-to-exclusive',
		rounding: 'floor',
		lines: [
			{
				id: 'item1',
				name: '食品',
				amount: 108,
				quantity: 1,
				rate: 8,
				reduced: true,
			},
			{ id: 'item2', name: '日用品', amount: 110, quantity: 2, rate: 10 },
		],
	});

	// 各明細行の base と total が正しく計算されている
	assert.strictEqual(result.lines[0].base, 100);
	assert.strictEqual(result.lines[0].total, 108);
	assert.strictEqual(result.lines[1].base, 200); // 220 / 1.1 = 200
	assert.strictEqual(result.lines[1].total, 220);

	// 集計結果の検証
	assert.deepEqual(result.summaries, [
		{ rate: 8, reduced: true, base: 100, tax: 8, total: 108 },
		{ rate: 10, reduced: undefined, base: 200, tax: 20, total: 220 },
	]);
	assert.strictEqual(result.base, 300);
	assert.strictEqual(result.tax, 28);
	assert.strictEqual(result.total, 328);
});

// ---------------------------------------------------------------------------
// validateAmount
// ---------------------------------------------------------------------------

test('validateAmount: 通常の半角数字', () => {
	const result = validateAmount('10000');
	assert.deepEqual(result, {
		ok: true,
		amount: 10_000,
		normalizedInput: '10000',
	});
});

test('validateAmount: 全角数字・全角カンマを正規化', () => {
	const result = validateAmount('１２，３４５');
	assert.deepEqual(result, {
		ok: true,
		amount: 12_345,
		normalizedInput: '12345',
	});
});

test('validateAmount: 半角カンマ・前後の空白を正規化', () => {
	const result = validateAmount('  1,234,567  ');
	assert.deepEqual(result, {
		ok: true,
		amount: 1_234_567,
		normalizedInput: '1234567',
	});
});

test('validateAmount: 0円は有効', () => {
	const result = validateAmount('0');
	assert.deepEqual(result, { ok: true, amount: 0, normalizedInput: '0' });
});

test('validateAmount: 1兆円は有効、1兆円超はエラー', () => {
	const max = validateAmount(String(MAX_AMOUNT));
	assert.deepEqual(max, {
		ok: true,
		amount: MAX_AMOUNT,
		normalizedInput: String(MAX_AMOUNT),
	});

	const overMax = validateAmount(String(MAX_AMOUNT + 1));
	assert.equal(overMax.ok, false);
	if (!overMax.ok) {
		assert.match(overMax.message, /1兆円以下/);
	}
});

test('validateAmount: 空入力はエラー', () => {
	const result = validateAmount('');
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.match(result.message, /入力してください/);
	}
});

test('validateAmount: 負数はエラー', () => {
	const result = validateAmount('-100');
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.match(result.message, /0以上/);
	}
});

test('validateAmount: 小数はエラー', () => {
	const result = validateAmount('100.5');
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.match(result.message, /整数/);
	}
});

test('validateAmount: 非数値はエラー', () => {
	const result = validateAmount('abc');
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.match(result.message, /数値を入力/);
	}
});

// ---------------------------------------------------------------------------
// validateQuantity
// ---------------------------------------------------------------------------

test('validateQuantity: 全角数字とカンマを正規化する', () => {
	const result = validateQuantity('１，２３');
	assert.deepEqual(result, {
		ok: true,
		quantity: 123,
		normalizedInput: '123',
	});
});

test('validateQuantity: 0・小数・上限超過はエラー', () => {
	const zero = validateQuantity('0');
	assert.equal(zero.ok, false);

	const decimal = validateQuantity('1.5');
	assert.equal(decimal.ok, false);

	const overMax = validateQuantity(String(MAX_QUANTITY + 1));
	assert.equal(overMax.ok, false);
});

// ---------------------------------------------------------------------------
// TAX_RATE_HISTORY
// ---------------------------------------------------------------------------

test('TAX_RATE_HISTORY: 標準10%・軽減8%・過去税率3/5/8%を含む', () => {
	const standard10 = TAX_RATE_HISTORY.find(
		(entry) => entry.rate === 10 && !entry.reduced,
	);
	assert.ok(standard10);
	assert.equal(standard10?.appliedFrom, '2019-10-01');
	assert.equal(standard10?.appliedTo, undefined);

	const reduced8 = TAX_RATE_HISTORY.find((entry) => entry.reduced === true);
	assert.ok(reduced8);
	assert.equal(reduced8?.rate, 8);
	assert.equal(reduced8?.appliedFrom, '2019-10-01');

	const past8 = TAX_RATE_HISTORY.find(
		(entry) => entry.rate === 8 && !entry.reduced,
	);
	assert.ok(past8);
	assert.equal(past8?.appliedFrom, '2014-04-01');
	assert.equal(past8?.appliedTo, '2019-09-30');

	const past5 = TAX_RATE_HISTORY.find((entry) => entry.rate === 5);
	assert.ok(past5);
	assert.equal(past5?.appliedFrom, '1997-04-01');
	assert.equal(past5?.appliedTo, '2014-03-31');

	const past3 = TAX_RATE_HISTORY.find((entry) => entry.rate === 3);
	assert.ok(past3);
	assert.equal(past3?.appliedFrom, '1989-04-01');
	assert.equal(past3?.appliedTo, '1997-03-31');
});
