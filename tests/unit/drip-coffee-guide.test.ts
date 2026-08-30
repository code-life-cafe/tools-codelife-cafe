import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	applyImport,
	BREW_FIELD_RANGES,
	type Brew,
	type BrewLogStore,
	calcBrewRatio,
	calcEy,
	computeCumulativeWaterMl,
	computeTotalWaterMl,
	InvalidBrewLogStoreError,
	isInRange,
	mergeStores,
	PRESET_RECIPE_IDS,
	PRESET_RECIPES,
	previewImport,
	type Recipe,
	STORE_VERSION,
	scaleSteps,
	validateBrewInput,
	validateBrewLogStore,
} from '../../src/lib/tools/drip-coffee-guide.ts';

test('PRESET_RECIPES: 5種のプリセットが固定IDと総湯量一致のpour合計を持つ', () => {
	assert.strictEqual(PRESET_RECIPES.length, 5);
	const ids = PRESET_RECIPES.map((r) => r.id);
	assert.deepStrictEqual(ids, [
		PRESET_RECIPE_IDS.fourSix,
		PRESET_RECIPE_IDS.hoffmann1Cup,
		PRESET_RECIPE_IDS.basic3Pour,
		PRESET_RECIPE_IDS.v60Neo,
		PRESET_RECIPE_IDS.switchHybrid,
	]);
	for (const recipe of PRESET_RECIPES) {
		assert.strictEqual(recipe.is_preset, true);
		const pourTotal = recipe.steps
			.filter((s) => s.action_type === 'pour')
			.reduce((sum, s) => sum + s.pour_amount_ml, 0);
		assert.strictEqual(
			pourTotal,
			recipe.total_water_ml,
			`${recipe.id} のpour合計が total_water_ml と一致すること`,
		);
	}
});

test('PRESET_RECIPES: THE NEO BREW（V60 NEO）は30mlのpourを10回・初回のみ30秒後、以降15秒間隔で行い、finishで終わること', () => {
	const recipe = PRESET_RECIPES.find(
		(r) => r.id === PRESET_RECIPE_IDS.v60Neo,
	) as Recipe;
	assert.strictEqual(recipe.method, 'v60_neo');
	assert.strictEqual(recipe.water_temp_c, 96);
	assert.strictEqual(recipe.grind_note, '極粗挽き');
	assert.strictEqual(recipe.steps.length, 11);

	const pourSteps = recipe.steps.filter((s) => s.action_type === 'pour');
	assert.strictEqual(pourSteps.length, 10);
	assert.deepStrictEqual(
		pourSteps.map((s) => s.pour_amount_ml),
		Array(10).fill(30),
	);
	assert.deepStrictEqual(
		pourSteps.map((s) => s.time_sec),
		[0, 30, 45, 60, 75, 90, 105, 120, 135, 150],
	);

	const finishStep = recipe.steps[recipe.steps.length - 1];
	assert.strictEqual(finishStep.action_type, 'finish');
	assert.strictEqual(finishStep.time_sec, 210);
});

test('PRESET_RECIPES: Switch新ハイブリッドは pour→pour→wait→pour→finish の順で浸漬と透過の2フェーズを持つこと', () => {
	const recipe = PRESET_RECIPES.find(
		(r) => r.id === PRESET_RECIPE_IDS.switchHybrid,
	) as Recipe;
	assert.strictEqual(recipe.method, 'switch');
	assert.deepStrictEqual(
		recipe.steps.map((s) => s.action_type),
		['pour', 'pour', 'wait', 'pour', 'finish'],
	);
	assert.deepStrictEqual(
		recipe.steps.map((s) => s.pour_amount_ml),
		[40, 100, 0, 160, 0],
	);
	assert.deepStrictEqual(
		recipe.steps.map((s) => s.time_sec),
		[0, 45, 90, 150, 210],
	);
});

test('scaleSteps: 豆量が2倍なら各pourステップも比例して2倍になる', () => {
	const recipe = PRESET_RECIPES.find(
		(r) => r.id === PRESET_RECIPE_IDS.fourSix,
	) as Recipe;
	const result = scaleSteps(recipe.steps, recipe.dose_g, recipe.dose_g * 2);
	assert.ok(result.ok);
	if (!result.ok) return;
	const pourAmounts = result.steps
		.filter((s) => s.action_type === 'pour')
		.map((s) => s.pour_amount_ml);
	assert.deepStrictEqual(pourAmounts, [120, 120, 120, 120, 120]);
});

test('scaleSteps: 丸め誤差は最後のpourステップで吸収され合計が一致する', () => {
	const recipe = PRESET_RECIPES.find(
		(r) => r.id === PRESET_RECIPE_IDS.hoffmann1Cup,
	) as Recipe;
	// 15g -> 13g は割り切れない比率になり、各ステップの丸めで誤差が出うる
	const result = scaleSteps(recipe.steps, recipe.dose_g, 13);
	assert.ok(result.ok);
	if (!result.ok) return;
	const pourSteps = result.steps.filter((s) => s.action_type === 'pour');
	const total = pourSteps.reduce((sum, s) => sum + s.pour_amount_ml, 0);
	const idealTotal = Math.round((recipe.total_water_ml * 13) / recipe.dose_g);
	assert.strictEqual(total, idealTotal);
	// 最後のpourステップがマイナスになっていないこと
	assert.ok(pourSteps[pourSteps.length - 1].pour_amount_ml >= 0);
});

test('scaleSteps: dose <= 0 は拒否される', () => {
	const recipe = PRESET_RECIPES[0];
	const result = scaleSteps(recipe.steps, recipe.dose_g, 0);
	assert.strictEqual(result.ok, false);
});

test('scaleSteps: pourステップが1つも無いレシピは拒否される', () => {
	const result = scaleSteps(
		[
			{
				step_order: 1,
				time_sec: 0,
				pour_amount_ml: 0,
				label: '抽出終了',
				action_type: 'finish',
			},
		],
		15,
		15,
	);
	assert.strictEqual(result.ok, false);
});

test('scaleSteps: 各ステップの丸め上振れが蓄積し最後のpourがマイナスになる場合は拒否される', () => {
	// 0.6ml刻みのpourを5つ並べると、各ステップの丸め(→1)の合計(5)が
	// 総量の丸め(→3)を上回り、最後のpourで吸収しきれずマイナスになる
	const steps = Array.from({ length: 5 }, (_, i) => ({
		step_order: i + 1,
		time_sec: i * 30,
		pour_amount_ml: 0.6,
		label: `${i + 1}投目`,
		action_type: 'pour' as const,
	}));
	const result = scaleSteps(steps, 20, 20);
	assert.strictEqual(result.ok, false);
});

test('calcBrewRatio / calcEy: レシオとEYを正しく算出する', () => {
	assert.strictEqual(calcBrewRatio(20, 300), 15);
	assert.strictEqual(calcBrewRatio(0, 300), undefined);
	assert.strictEqual(calcEy(20, 300, 1.35), (300 * 1.35) / 20);
	assert.strictEqual(calcEy(20, 300, undefined), undefined);
});

test('isInRange: BREW_FIELD_RANGES の境界値を正しく判定する', () => {
	const [min, max] = BREW_FIELD_RANGES.dose_g;
	assert.strictEqual(isInRange(min, 'dose_g'), true);
	assert.strictEqual(isInRange(max, 'dose_g'), true);
	assert.strictEqual(isInRange(min - 0.01, 'dose_g'), false);
	assert.strictEqual(isInRange(max + 0.01, 'dose_g'), false);
	assert.strictEqual(isInRange(Number.NaN, 'dose_g'), false);
});

test('validateBrewInput: 必須項目欠落・範囲外を検出する', () => {
	const ok = validateBrewInput({
		bean_name: 'エチオピア イルガチェフェ',
		method: 'v60',
		dose_g: 20,
		yield_g: 300,
		brew_time_sec: 180,
	});
	assert.strictEqual(ok.ok, true);

	const invalid = validateBrewInput({
		bean_name: '',
		method: 'v60',
		dose_g: -1,
		yield_g: 300,
		brew_time_sec: 180,
		tds: 10,
	});
	assert.strictEqual(invalid.ok, false);
	if (invalid.ok) return;
	assert.ok(invalid.errors.length >= 3);
});

function makeBrew(overrides: Partial<Brew> = {}): Brew {
	return {
		id: 'brew-1',
		brewed_at: '2026-08-01T00:00:00.000Z',
		updated_at: '2026-08-01T00:00:00.000Z',
		bean_name: '豆A',
		method: 'v60',
		dose_g: 20,
		yield_g: 300,
		brew_time_sec: 180,
		...overrides,
	};
}

function emptyStore(): BrewLogStore {
	return { version: STORE_VERSION, recipes: [], brews: [] };
}

test('validateBrewLogStore: version不一致や壊れた形式はInvalidBrewLogStoreErrorを投げる', () => {
	assert.throws(
		() => validateBrewLogStore({ version: 2, recipes: [], brews: [] }),
		InvalidBrewLogStoreError,
	);
	assert.throws(
		() => validateBrewLogStore({ version: 1, recipes: 'x', brews: [] }),
		InvalidBrewLogStoreError,
	);
	assert.throws(() => validateBrewLogStore(null), InvalidBrewLogStoreError);
	assert.throws(
		() =>
			validateBrewLogStore({ version: 1, recipes: [], brews: [{ id: 'b1' }] }),
		InvalidBrewLogStoreError,
	);
});

test('validateBrewLogStore: 正しい形式のstoreをそのまま返す', () => {
	const store: BrewLogStore = {
		version: 1,
		recipes: [PRESET_RECIPES[0]],
		brews: [makeBrew()],
	};
	const result = validateBrewLogStore(store);
	assert.strictEqual(result.recipes.length, 1);
	assert.strictEqual(result.brews.length, 1);
});

test('mergeStores: ID一致は新しいupdated_atを採用する', () => {
	const existing = emptyStore();
	existing.brews.push(
		makeBrew({
			id: 'b1',
			updated_at: '2026-08-01T00:00:00.000Z',
			notes: 'old',
		}),
	);
	const incoming = emptyStore();
	incoming.brews.push(
		makeBrew({
			id: 'b1',
			updated_at: '2026-08-05T00:00:00.000Z',
			notes: 'new',
		}),
	);

	const merged = mergeStores(existing, incoming);
	assert.strictEqual(merged.brews.length, 1);
	assert.strictEqual(merged.brews[0].notes, 'new');
});

test('mergeStores: IDが異なる場合は両方保持する', () => {
	const existing = emptyStore();
	existing.brews.push(makeBrew({ id: 'b1' }));
	const incoming = emptyStore();
	incoming.brews.push(makeBrew({ id: 'b2' }));

	const merged = mergeStores(existing, incoming);
	assert.strictEqual(merged.brews.length, 2);
});

test('previewImport / applyImport: replaceは取込側の件数、mergeは併合後の件数を返す', () => {
	const existing = emptyStore();
	existing.brews.push(makeBrew({ id: 'b1' }));
	const incoming = emptyStore();
	incoming.brews.push(makeBrew({ id: 'b2' }));

	const replacePreview = previewImport(existing, incoming, 'replace');
	assert.strictEqual(replacePreview.resultBrewCount, 1);
	const replaced = applyImport(existing, incoming, 'replace');
	assert.strictEqual(replaced.brews.length, 1);
	assert.strictEqual(replaced.brews[0].id, 'b2');

	const mergePreview = previewImport(existing, incoming, 'merge');
	assert.strictEqual(mergePreview.resultBrewCount, 2);
	const merged = applyImport(existing, incoming, 'merge');
	assert.strictEqual(merged.brews.length, 2);
});

test('computeCumulativeWaterMl & computeTotalWaterMl: ステップごとの累積注水量と全体の総注水量を正しく計算する', () => {
	const steps = [
		{
			step_order: 1,
			time_sec: 0,
			pour_amount_ml: 50,
			label: '1投目',
			action_type: 'pour' as const,
		},
		{
			step_order: 2,
			time_sec: 30,
			pour_amount_ml: 0,
			label: '待つ',
			action_type: 'wait' as const,
		},
		{
			step_order: 3,
			time_sec: 45,
			pour_amount_ml: 70,
			label: '2投目',
			action_type: 'pour' as const,
		},
		{
			step_order: 4,
			time_sec: 90,
			pour_amount_ml: 80,
			label: '3投目',
			action_type: 'pour' as const,
		},
	];

	assert.strictEqual(computeCumulativeWaterMl(steps, 0), 50);
	assert.strictEqual(computeCumulativeWaterMl(steps, 1), 50);
	assert.strictEqual(computeCumulativeWaterMl(steps, 2), 120);
	assert.strictEqual(computeCumulativeWaterMl(steps, 3), 200);

	assert.strictEqual(computeTotalWaterMl(steps), 200);
});

test('PRESET_RECIPES: すべてのプリセットで最後のステップがfinish（抽出終了）になっていること', () => {
	for (const recipe of PRESET_RECIPES) {
		const lastStep = recipe.steps[recipe.steps.length - 1];
		assert.strictEqual(
			lastStep?.action_type,
			'finish',
			`${recipe.name} の最終ステップは finish であること`,
		);
	}
});
