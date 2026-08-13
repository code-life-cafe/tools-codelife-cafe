// ドリップコーヒー抽出ガイドのロジック（純粋関数のみ）
//
// 注湯量のスケーリングは「各pourステップの目標量を比例配分→1g単位で丸め→
// 丸め誤差は最後のpourステップで吸収」という方式を取る。これにより
// 実際の投入湯量の合計が常にスケール後の総湯量と一致する。

export type MethodId = 'v60' | 'switch' | 'kalita' | 'pour_other';

export type RecipeStepActionType = 'pour' | 'wait' | 'swirl' | 'finish';

export interface RecipeStep {
	step_order: number;
	time_sec: number;
	pour_amount_ml: number;
	label: string;
	action_type: RecipeStepActionType;
}

export interface Recipe {
	id: string;
	name: string;
	method: MethodId;
	dose_g: number;
	total_water_ml: number;
	water_temp_c?: number;
	grind_note?: string;
	is_preset: boolean;
	description?: string;
	steps: RecipeStep[];
	updated_at: string;
}

export interface Brew {
	id: string;
	brewed_at: string;
	updated_at: string;
	bean_name: string;
	method: MethodId;
	dose_g: number;
	yield_g: number;
	water_amount_ml?: number;
	water_temp_c?: number;
	grind_note?: string;
	brew_time_sec: number;
	bloom_time_sec?: number;
	tds?: number;
	overall_score?: number;
	notes?: string;
	recipe_id?: string;
	recipe_name?: string;
}

export const STORE_VERSION = 1 as const;

export interface BrewLogStore {
	version: typeof STORE_VERSION;
	recipes: Recipe[];
	brews: Brew[];
}

export interface BrewSession {
	recipeId: string;
	startedAtUnix: number;
	pausedElapsedMs: number;
	currentStepIndex: number;
	scaledDoseG: number;
	status: 'running' | 'paused';
}

// --- プリセットレシピ -------------------------------------------------

const PRESET_UPDATED_AT = '2026-08-13T00:00:00.000Z';

export const PRESET_RECIPE_IDS = {
	fourSix: 'drip-coffee-guide-preset-4-6',
	hoffmann1Cup: 'drip-coffee-guide-preset-hoffmann-1cup',
	basic3Pour: 'drip-coffee-guide-preset-basic-3pour',
} as const;

export const PRESET_RECIPES: readonly Recipe[] = [
	{
		id: PRESET_RECIPE_IDS.fourSix,
		name: '4:6メソッド',
		method: 'v60',
		dose_g: 20,
		total_water_ml: 300,
		water_temp_c: 93,
		grind_note: '中粗挽き',
		is_preset: true,
		description: '公式基本形（60g×5投）。50+70の調整形は複製して作る。',
		updated_at: PRESET_UPDATED_AT,
		steps: [
			{
				step_order: 1,
				time_sec: 0,
				pour_amount_ml: 60,
				label: '1投目',
				action_type: 'pour',
			},
			{
				step_order: 2,
				time_sec: 45,
				pour_amount_ml: 60,
				label: '2投目',
				action_type: 'pour',
			},
			{
				step_order: 3,
				time_sec: 90,
				pour_amount_ml: 60,
				label: '3投目',
				action_type: 'pour',
			},
			{
				step_order: 4,
				time_sec: 135,
				pour_amount_ml: 60,
				label: '4投目',
				action_type: 'pour',
			},
			{
				step_order: 5,
				time_sec: 165,
				pour_amount_ml: 60,
				label: '5投目',
				action_type: 'pour',
			},
			{
				step_order: 6,
				time_sec: 210,
				pour_amount_ml: 0,
				label: '抽出終了',
				action_type: 'finish',
			},
		],
	},
	{
		id: PRESET_RECIPE_IDS.hoffmann1Cup,
		name: 'Hoffmann 1-Cup',
		method: 'v60',
		dose_g: 15,
		total_water_ml: 250,
		water_temp_c: 96,
		grind_note: '中細挽き',
		is_preset: true,
		description: 'James Hoffmann の1杯抽出レシピ。',
		updated_at: PRESET_UPDATED_AT,
		steps: [
			{
				step_order: 1,
				time_sec: 0,
				pour_amount_ml: 50,
				label: 'ブルーム',
				action_type: 'pour',
			},
			{
				step_order: 2,
				time_sec: 10,
				pour_amount_ml: 0,
				label: 'スワール',
				action_type: 'swirl',
			},
			{
				step_order: 3,
				time_sec: 45,
				pour_amount_ml: 50,
				label: '100gまで注湯',
				action_type: 'pour',
			},
			{
				step_order: 4,
				time_sec: 70,
				pour_amount_ml: 50,
				label: '150gまで注湯',
				action_type: 'pour',
			},
			{
				step_order: 5,
				time_sec: 90,
				pour_amount_ml: 50,
				label: '200gまで注湯',
				action_type: 'pour',
			},
			{
				step_order: 6,
				time_sec: 110,
				pour_amount_ml: 50,
				label: '250gまで注湯',
				action_type: 'pour',
			},
			{
				step_order: 7,
				time_sec: 120,
				pour_amount_ml: 0,
				label: 'スワール',
				action_type: 'swirl',
			},
			{
				step_order: 8,
				time_sec: 180,
				pour_amount_ml: 0,
				label: '抽出終了',
				action_type: 'finish',
			},
		],
	},
	{
		id: PRESET_RECIPE_IDS.basic3Pour,
		name: 'ベーシック3投',
		method: 'v60',
		dose_g: 15,
		total_water_ml: 250,
		water_temp_c: 93,
		grind_note: '中細挽き',
		is_preset: true,
		description: '5投が面倒な日用。Hario基本形に寄せた3投構成。',
		updated_at: PRESET_UPDATED_AT,
		steps: [
			{
				step_order: 1,
				time_sec: 0,
				pour_amount_ml: 50,
				label: '蒸らし',
				action_type: 'pour',
			},
			{
				step_order: 2,
				time_sec: 45,
				pour_amount_ml: 100,
				label: '150gまで注湯',
				action_type: 'pour',
			},
			{
				step_order: 3,
				time_sec: 90,
				pour_amount_ml: 100,
				label: '250gまで注湯',
				action_type: 'pour',
			},
			{
				step_order: 4,
				time_sec: 180,
				pour_amount_ml: 0,
				label: '抽出終了',
				action_type: 'finish',
			},
		],
	},
];

// --- 注湯量スケーリング -------------------------------------------------

export type ScaleStepsResult =
	| { ok: true; steps: RecipeStep[] }
	| { ok: false; message: string };

/**
 * レシピ基準の豆量(recipeDoseG)に対する実際の豆量(actualDoseG)の比率で、
 * pourステップの注湯量を比例配分する。1g単位に丸め、丸め誤差は最後の
 * pourステップで吸収する（合計が総湯量スケール後の値と一致するように）。
 */
export function scaleSteps(
	steps: readonly RecipeStep[],
	recipeDoseG: number,
	actualDoseG: number,
): ScaleStepsResult {
	if (recipeDoseG <= 0 || actualDoseG <= 0) {
		return { ok: false, message: '豆量は0より大きい値を指定してください。' };
	}
	const pourIndices = steps.reduce<number[]>((acc, step, index) => {
		if (step.action_type === 'pour') acc.push(index);
		return acc;
	}, []);
	if (pourIndices.length === 0) {
		return { ok: false, message: 'このレシピには注湯ステップがありません。' };
	}

	const ratio = actualDoseG / recipeDoseG;
	const rawTotal = pourIndices.reduce(
		(sum, i) => sum + steps[i].pour_amount_ml,
		0,
	);
	const idealScaledTotal = Math.round(rawTotal * ratio);

	const roundedAmounts = pourIndices.map((i) =>
		Math.round(steps[i].pour_amount_ml * ratio),
	);
	const roundedTotal = roundedAmounts.reduce((sum, v) => sum + v, 0);
	const diff = idealScaledTotal - roundedTotal;

	const lastPourPos = roundedAmounts.length - 1;
	roundedAmounts[lastPourPos] += diff;

	if (roundedAmounts[lastPourPos] < 0) {
		return {
			ok: false,
			message: '豆量が小さすぎて最後の注湯量がマイナスになります。',
		};
	}

	const scaledSteps = steps.map((step) => ({ ...step }));
	pourIndices.forEach((stepIndex, pourPos) => {
		scaledSteps[stepIndex].pour_amount_ml = roundedAmounts[pourPos];
	});

	return { ok: true, steps: scaledSteps };
}

// --- 計算 -------------------------------------------------

/** レシオ（抽出量 / 豆量）。doseGが0以下の場合はundefined。 */
export function calcBrewRatio(
	doseG: number,
	yieldG: number,
): number | undefined {
	if (doseG <= 0) return undefined;
	return yieldG / doseG;
}

/** 抽出収率（EY） = 抽出量 * TDS / 豆量（%）。tds未指定・doseG<=0ならundefined。 */
export function calcEy(
	doseG: number,
	yieldG: number,
	tds: number | undefined,
): number | undefined {
	if (tds === undefined || doseG <= 0) return undefined;
	return (yieldG * tds) / doseG;
}

// --- 検証 -------------------------------------------------

export const BREW_FIELD_RANGES = {
	dose_g: [0.1, 100],
	yield_g: [0.1, 1000],
	water_temp_c: [50, 100],
	brew_time_sec: [1, 3600],
	bloom_time_sec: [1, 3600],
	overall_score: [1, 10],
	tds: [0.5, 3.0],
} as const satisfies Record<string, readonly [number, number]>;

export type BrewRangeField = keyof typeof BREW_FIELD_RANGES;

export function isInRange(value: number, field: BrewRangeField): boolean {
	const [min, max] = BREW_FIELD_RANGES[field];
	return Number.isFinite(value) && value >= min && value <= max;
}

export type BrewInput = Pick<
	Brew,
	'bean_name' | 'method' | 'dose_g' | 'yield_g' | 'brew_time_sec'
> &
	Partial<
		Omit<
			Brew,
			| 'bean_name'
			| 'method'
			| 'dose_g'
			| 'yield_g'
			| 'brew_time_sec'
			| 'id'
			| 'updated_at'
		>
	>;

export type BrewValidation = { ok: true } | { ok: false; errors: string[] };

/** 必須項目の欠落・数値範囲外を検証する（保存前のガード）。 */
export function validateBrewInput(input: BrewInput): BrewValidation {
	const errors: string[] = [];

	if (!input.bean_name || input.bean_name.trim().length === 0) {
		errors.push('豆名を入力してください。');
	}
	if (!isInRange(input.dose_g, 'dose_g')) {
		errors.push('豆量が有効な範囲外です。');
	}
	if (!isInRange(input.yield_g, 'yield_g')) {
		errors.push('抽出量が有効な範囲外です。');
	}
	if (!isInRange(input.brew_time_sec, 'brew_time_sec')) {
		errors.push('抽出時間が有効な範囲外です。');
	}
	if (
		input.water_temp_c !== undefined &&
		!isInRange(input.water_temp_c, 'water_temp_c')
	) {
		errors.push('湯温が有効な範囲外です。');
	}
	if (
		input.bloom_time_sec !== undefined &&
		!isInRange(input.bloom_time_sec, 'bloom_time_sec')
	) {
		errors.push('蒸らし時間が有効な範囲外です。');
	}
	if (
		input.overall_score !== undefined &&
		!isInRange(input.overall_score, 'overall_score')
	) {
		errors.push('点数が有効な範囲外です。');
	}
	if (input.tds !== undefined && !isInRange(input.tds, 'tds')) {
		errors.push('TDSが有効な範囲外です。');
	}

	return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

// --- JSONインポート検証 -------------------------------------------------

export class InvalidBrewLogStoreError extends Error {}

const METHOD_IDS: readonly MethodId[] = [
	'v60',
	'switch',
	'kalita',
	'pour_other',
];
const ACTION_TYPES: readonly RecipeStepActionType[] = [
	'pour',
	'wait',
	'swirl',
	'finish',
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidRecipeStep(value: unknown): value is RecipeStep {
	if (!isRecord(value)) return false;
	return (
		typeof value.step_order === 'number' &&
		typeof value.time_sec === 'number' &&
		typeof value.pour_amount_ml === 'number' &&
		typeof value.label === 'string' &&
		typeof value.action_type === 'string' &&
		(ACTION_TYPES as readonly string[]).includes(value.action_type)
	);
}

function isValidRecipe(value: unknown): value is Recipe {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === 'string' &&
		typeof value.name === 'string' &&
		typeof value.method === 'string' &&
		(METHOD_IDS as readonly string[]).includes(value.method) &&
		typeof value.dose_g === 'number' &&
		typeof value.total_water_ml === 'number' &&
		typeof value.is_preset === 'boolean' &&
		typeof value.updated_at === 'string' &&
		Array.isArray(value.steps) &&
		value.steps.every(isValidRecipeStep)
	);
}

function isValidBrew(value: unknown): value is Brew {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === 'string' &&
		typeof value.brewed_at === 'string' &&
		typeof value.updated_at === 'string' &&
		typeof value.bean_name === 'string' &&
		typeof value.method === 'string' &&
		(METHOD_IDS as readonly string[]).includes(value.method) &&
		typeof value.dose_g === 'number' &&
		typeof value.yield_g === 'number' &&
		typeof value.brew_time_sec === 'number'
	);
}

/**
 * インポートJSONの形状を検証する。version不一致・不明な形式は
 * InvalidBrewLogStoreError を投げる（呼び出し元は既存データを変更せずエラー表示する）。
 */
export function validateBrewLogStore(json: unknown): BrewLogStore {
	if (!isRecord(json)) {
		throw new InvalidBrewLogStoreError('JSONの形式が不正です。');
	}
	if (json.version !== STORE_VERSION) {
		throw new InvalidBrewLogStoreError(
			`未対応のバージョンです（version: ${String(json.version)}）。`,
		);
	}
	if (!Array.isArray(json.recipes) || !json.recipes.every(isValidRecipe)) {
		throw new InvalidBrewLogStoreError('recipesの形式が不正です。');
	}
	if (!Array.isArray(json.brews) || !json.brews.every(isValidBrew)) {
		throw new InvalidBrewLogStoreError('brewsの形式が不正です。');
	}
	return { version: STORE_VERSION, recipes: json.recipes, brews: json.brews };
}

// --- マージ -------------------------------------------------

function getComparableTimestamp<
	T extends { updated_at?: string; brewed_at?: string },
>(item: T): string {
	return item.updated_at ?? item.brewed_at ?? '';
}

function mergeById<
	T extends { id: string; updated_at?: string; brewed_at?: string },
>(existing: readonly T[], incoming: readonly T[]): T[] {
	const byId = new Map<string, T>();
	for (const item of existing) byId.set(item.id, item);
	for (const item of incoming) {
		const current = byId.get(item.id);
		if (
			!current ||
			getComparableTimestamp(item) >= getComparableTimestamp(current)
		) {
			byId.set(item.id, item);
		}
	}
	return Array.from(byId.values());
}

export interface ImportPreview {
	resultRecipeCount: number;
	resultBrewCount: number;
}

/** 実行前に結果件数だけを算出する（置換・併合どちらも実行前に件数を提示するため）。 */
export function previewImport(
	existing: BrewLogStore,
	incoming: BrewLogStore,
	mode: 'replace' | 'merge',
): ImportPreview {
	if (mode === 'replace') {
		return {
			resultRecipeCount: incoming.recipes.length,
			resultBrewCount: incoming.brews.length,
		};
	}
	const merged = mergeStores(existing, incoming);
	return {
		resultRecipeCount: merged.recipes.length,
		resultBrewCount: merged.brews.length,
	};
}

/** ID一致は新しいupdated_at（Brewはupdated_at優先、無ければbrewed_at）を採用して併合する。 */
export function mergeStores(
	existing: BrewLogStore,
	incoming: BrewLogStore,
): BrewLogStore {
	return {
		version: STORE_VERSION,
		recipes: mergeById(existing.recipes, incoming.recipes),
		brews: mergeById(existing.brews, incoming.brews),
	};
}

export function applyImport(
	existing: BrewLogStore,
	incoming: BrewLogStore,
	mode: 'replace' | 'merge',
): BrewLogStore {
	if (mode === 'replace') {
		return {
			version: STORE_VERSION,
			recipes: [...incoming.recipes],
			brews: [...incoming.brews],
		};
	}
	return mergeStores(existing, incoming);
}
