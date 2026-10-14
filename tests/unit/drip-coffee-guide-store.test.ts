import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
	PRESET_RECIPE_IDS,
	STORE_VERSION,
} from '../../src/lib/tools/drip-coffee-guide.ts';
import {
	CorruptedStoreError,
	clearSession,
	createRecipe,
	deleteBrew,
	deleteRecipe,
	duplicateRecipe,
	exportStoreJson,
	getLastBrew,
	getRecentBeanNames,
	importStore,
	loadSession,
	loadStore,
	parseImportJson,
	previewImport,
	STORAGE_KEY,
	saveBrew,
	saveSession,
	updateBrew,
	updateRecipe,
} from '../../src/lib/tools/drip-coffee-guide-store.ts';

// --- localStorage / sessionStorage / crypto の簡易モック（Node環境） ---
class MemoryStorage {
	private store = new Map<string, string>();
	getItem(key: string) {
		return this.store.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.store.set(key, value);
	}
	removeItem(key: string) {
		this.store.delete(key);
	}
	clear() {
		this.store.clear();
	}
}

// biome-ignore lint/suspicious/noExplicitAny: テスト用グローバルモック
(globalThis as any).localStorage = new MemoryStorage();
// biome-ignore lint/suspicious/noExplicitAny: テスト用グローバルモック
(globalThis as any).sessionStorage = new MemoryStorage();
// biome-ignore lint/suspicious/noExplicitAny: `typeof window === 'undefined'` ガードをNodeでも通過させるため
(globalThis as any).window = globalThis;

beforeEach(() => {
	(globalThis.localStorage as unknown as MemoryStorage).clear();
	(globalThis.sessionStorage as unknown as MemoryStorage).clear();
});

test('loadStore: 未保存時はプリセット5種のみで初期化し永続化する', () => {
	const store = loadStore();
	assert.strictEqual(store.recipes.length, 5);
	assert.strictEqual(store.brews.length, 0);
	assert.ok(localStorage.getItem(STORAGE_KEY));
});

function loadStoreFromLatest() {
	(globalThis.localStorage as unknown as MemoryStorage).clear();
	return loadStore();
}

// 旧データ（V60 NEO・Switch新ハイブリッド追加前）の保存形式を再現する
function seedLegacyStore(
	extra: { recipes?: unknown[]; brews?: unknown[] } = {},
) {
	const full = loadStore();
	const legacyPresets = full.recipes.filter(
		(r) =>
			r.id !== PRESET_RECIPE_IDS.v60Neo &&
			r.id !== PRESET_RECIPE_IDS.switchHybrid,
	);
	const legacy = {
		version: STORE_VERSION,
		recipes: [...legacyPresets, ...(extra.recipes ?? [])],
		brews: extra.brews ?? [],
	};
	localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
	return legacy;
}

test('loadStore: 旧データへV60 NEOとSwitch新ハイブリッドを補完し永続化する', () => {
	seedLegacyStore();
	const store = loadStore();
	const ids = store.recipes.map((r) => r.id);
	assert.ok(ids.includes(PRESET_RECIPE_IDS.v60Neo));
	assert.ok(ids.includes(PRESET_RECIPE_IDS.switchHybrid));
	assert.strictEqual(store.recipes.length, 5);
	const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) as string);
	assert.strictEqual(saved.recipes.length, 5);
});

test('loadStore: 補完は1回だけで、繰り返し読み込んでも重複しない', () => {
	seedLegacyStore();
	loadStore();
	const again = loadStore();
	const third = loadStore();
	assert.strictEqual(again.recipes.length, 5);
	assert.strictEqual(third.recipes.length, 5);
	const ids = third.recipes.map((r) => r.id);
	assert.strictEqual(new Set(ids).size, ids.length);
});

test('loadStore: 補完してもマイレシピと抽出記録は変更も欠落もしない', () => {
	const mine = {
		id: 'my-recipe-1',
		name: 'マイレシピ',
		method: 'v60',
		dose_g: 15,
		total_water_ml: 250,
		is_preset: false,
		steps: [
			{
				step_order: 1,
				time_sec: 0,
				pour_amount_ml: 250,
				label: '注ぐ',
				action_type: 'pour',
			},
			{
				step_order: 2,
				time_sec: 120,
				pour_amount_ml: 0,
				label: '完了',
				action_type: 'finish',
			},
		],
		updated_at: '2026-08-20T00:00:00.000Z',
	};
	const brew = {
		id: 'brew-1',
		brewed_at: '2026-08-21T00:00:00.000Z',
		updated_at: '2026-08-21T00:00:00.000Z',
		bean_name: 'エチオピア',
		method: 'v60',
		dose_g: 15,
		yield_g: 250,
		brew_time_sec: 150,
		notes: '甘い',
	};
	const legacy = seedLegacyStore({ recipes: [mine], brews: [brew] });
	const store = loadStore();
	assert.deepStrictEqual(store.brews, [brew]);
	assert.deepStrictEqual(
		store.recipes.find((r) => r.id === 'my-recipe-1'),
		mine,
	);
	for (const r of legacy.recipes) {
		assert.deepStrictEqual(
			store.recipes.find((x) => x.id === (r as { id: string }).id),
			r,
		);
	}
});

test('loadStore: v60_neo 修正前に保存された旧V60 NEOプリセットを最新の定義へ更新し、マイレシピは変更しない', () => {
	const mine = {
		id: 'my-recipe-1',
		name: 'マイレシピ',
		method: 'v60',
		dose_g: 15,
		total_water_ml: 250,
		is_preset: false,
		steps: [
			{
				step_order: 1,
				time_sec: 0,
				pour_amount_ml: 250,
				label: '注ぐ',
				action_type: 'pour',
			},
			{
				step_order: 2,
				time_sec: 120,
				pour_amount_ml: 0,
				label: '完了',
				action_type: 'finish',
			},
		],
		updated_at: '2026-08-20T00:00:00.000Z',
	};
	const legacy = seedLegacyStore({ recipes: [mine] });
	// 旧V60 NEO（method が v60 のまま、updated_at が古い）を保存データへ混ぜる
	const latestNeo = loadStoreFromLatest().recipes.find(
		(r) => r.id === PRESET_RECIPE_IDS.v60Neo,
	);
	assert.ok(latestNeo);
	const staleNeo = {
		...latestNeo,
		method: 'v60',
		// #359 時点の実際の旧エントリ: method は v60、updated_at は現行定義と同じ
		updated_at: latestNeo.updated_at,
	};
	assert.strictEqual(staleNeo.updated_at, '2026-08-30T00:00:00.000Z');
	legacy.recipes.push(staleNeo as never);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

	const store = loadStore();
	const neo = store.recipes.filter((r) => r.id === PRESET_RECIPE_IDS.v60Neo);
	assert.strictEqual(neo.length, 1);
	assert.strictEqual(neo[0].method, 'v60_neo');
	assert.deepStrictEqual(
		store.recipes.find((r) => r.id === 'my-recipe-1'),
		mine,
	);
	// 更新後は再読み込みしても変わらない
	assert.deepStrictEqual(loadStore().recipes, store.recipes);
});

test('loadStore: updated_at が新しい保存済みプリセットは、method が違っても上書きしない', () => {
	const latestNeo = loadStoreFromLatest().recipes.find(
		(r) => r.id === PRESET_RECIPE_IDS.v60Neo,
	);
	assert.ok(latestNeo);
	const newer = {
		...latestNeo,
		method: 'pour_other',
		updated_at: '2026-12-01T00:00:00.000Z',
	};
	const legacy = seedLegacyStore();
	legacy.recipes.push(newer as never);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

	const store = loadStore();
	assert.deepStrictEqual(
		store.recipes.find((r) => r.id === PRESET_RECIPE_IDS.v60Neo),
		newer,
	);
});

test('loadStore: 最新のプリセットを持つデータは書き換えない', () => {
	loadStore();
	const before = localStorage.getItem(STORAGE_KEY);
	loadStore();
	assert.strictEqual(localStorage.getItem(STORAGE_KEY), before);
});

test('loadStore: 破損JSONは初期化せず CorruptedStoreError を投げる', () => {
	localStorage.setItem(STORAGE_KEY, '{not valid json');
	assert.throws(() => loadStore(), CorruptedStoreError);
	// 既存データ（破損した生の値）は消えていない
	assert.strictEqual(localStorage.getItem(STORAGE_KEY), '{not valid json');
});

test('saveBrew: 必須項目欠落は拒否され、成功時はstoreとbrewを返す', () => {
	const store = loadStore();
	assert.throws(() =>
		saveBrew(store, {
			bean_name: '',
			method: 'v60',
			dose_g: 20,
			yield_g: 300,
			brew_time_sec: 180,
		}),
	);

	const result = saveBrew(store, {
		bean_name: 'エチオピア',
		method: 'v60',
		dose_g: 20,
		yield_g: 300,
		brew_time_sec: 180,
	});
	assert.strictEqual(result.store.brews.length, 1);
	assert.strictEqual(result.brew.bean_name, 'エチオピア');
	assert.ok(result.brew.id);
	assert.ok(result.brew.updated_at);
});

test('updateBrew / deleteBrew: 記録の更新・削除ができる', () => {
	let store = loadStore();
	const { store: afterSave, brew } = saveBrew(store, {
		bean_name: '豆A',
		method: 'v60',
		dose_g: 20,
		yield_g: 300,
		brew_time_sec: 180,
	});
	store = afterSave;

	const { store: afterUpdate, brew: updated } = updateBrew(store, brew.id, {
		bean_name: '豆B',
		method: 'v60',
		dose_g: 22,
		yield_g: 320,
		brew_time_sec: 190,
	});
	assert.strictEqual(updated.bean_name, '豆B');
	assert.strictEqual(afterUpdate.brews.length, 1);

	const afterDelete = deleteBrew(afterUpdate, brew.id);
	assert.strictEqual(afterDelete.brews.length, 0);
});

test('createRecipe / updateRecipe: プリセットは編集できず、マイレシピは編集できる', () => {
	const store = loadStore();
	const preset = store.recipes.find((r) => r.id === PRESET_RECIPE_IDS.fourSix);
	assert.ok(preset);
	if (!preset) return;
	assert.throws(() =>
		updateRecipe(store, preset.id, { ...preset, name: '改変' }),
	);

	const { store: afterCreate, recipe } = createRecipe(store, {
		name: 'マイレシピ',
		method: 'kalita',
		dose_g: 18,
		total_water_ml: 280,
		steps: [
			{
				step_order: 1,
				time_sec: 0,
				pour_amount_ml: 280,
				label: '注湯',
				action_type: 'pour',
			},
		],
	});
	assert.strictEqual(recipe.is_preset, false);

	const { recipe: updated } = updateRecipe(afterCreate, recipe.id, {
		...recipe,
		name: 'マイレシピ改',
	});
	assert.strictEqual(updated.name, 'マイレシピ改');
});

test('duplicateRecipe: プリセットを複製すると編集可能な独立レシピになる', () => {
	const store = loadStore();
	const { recipe } = duplicateRecipe(store, PRESET_RECIPE_IDS.fourSix);
	assert.strictEqual(recipe.is_preset, false);
	assert.notStrictEqual(recipe.id, PRESET_RECIPE_IDS.fourSix);
	assert.match(recipe.name, /のコピー$/);
});

test('deleteRecipe: プリセットの削除は拒否される', () => {
	const store = loadStore();
	assert.throws(() => deleteRecipe(store, PRESET_RECIPE_IDS.fourSix));
});

test('exportStoreJson / parseImportJson / previewImport / importStore: 一連のJSON入出力が一致する', () => {
	let store = loadStore();
	const { store: afterSave } = saveBrew(store, {
		bean_name: '豆A',
		method: 'v60',
		dose_g: 20,
		yield_g: 300,
		brew_time_sec: 180,
	});
	store = afterSave;

	const json = exportStoreJson(store);
	const parsed = parseImportJson(json);
	assert.strictEqual(parsed.brews.length, store.brews.length);

	const preview = previewImport(store, parsed, 'replace');
	assert.strictEqual(preview.resultBrewCount, store.brews.length);

	const result = importStore(store, parsed, 'replace');
	assert.strictEqual(result.brews.length, store.brews.length);
	assert.strictEqual(result.version, STORE_VERSION);
});

test('parseImportJson: 壊れたJSON文字列は拒否される', () => {
	assert.throws(() => parseImportJson('not json'));
	assert.throws(() => parseImportJson('{"version":1,"recipes":[]}'));
});

test('getRecentBeanNames / getLastBrew: 直近順・重複除去で返す', () => {
	let store = loadStore();
	store = saveBrew(store, {
		bean_name: '豆A',
		method: 'v60',
		dose_g: 20,
		yield_g: 300,
		brew_time_sec: 180,
		brewed_at: '2026-08-01T00:00:00.000Z',
	}).store;
	store = saveBrew(store, {
		bean_name: '豆B',
		method: 'v60',
		dose_g: 20,
		yield_g: 300,
		brew_time_sec: 180,
		brewed_at: '2026-08-03T00:00:00.000Z',
	}).store;
	store = saveBrew(store, {
		bean_name: '豆A',
		method: 'v60',
		dose_g: 20,
		yield_g: 300,
		brew_time_sec: 180,
		brewed_at: '2026-08-02T00:00:00.000Z',
	}).store;

	const names = getRecentBeanNames(store);
	assert.deepStrictEqual(names, ['豆B', '豆A']);

	const last = getLastBrew(store);
	assert.strictEqual(last?.bean_name, '豆B');
});

test('saveSession / loadSession / clearSession: sessionStorageへの保存・復元・破棄ができる', () => {
	assert.strictEqual(loadSession(), null);

	saveSession({
		recipeId: PRESET_RECIPE_IDS.fourSix,
		startedAtUnix: 1000,
		pausedElapsedMs: 0,
		currentStepIndex: 0,
		scaledDoseG: 20,
		status: 'running',
	});
	const restored = loadSession();
	assert.strictEqual(restored?.recipeId, PRESET_RECIPE_IDS.fourSix);
	assert.strictEqual(restored?.status, 'running');

	clearSession();
	assert.strictEqual(loadSession(), null);
});

test('loadSession: 壊れた形式はnullを返す（例外を投げない）', () => {
	(globalThis.sessionStorage as unknown as MemoryStorage).setItem(
		'tools.codelife.cafe:drip-coffee-guide:session:v1',
		'{not valid json',
	);
	assert.strictEqual(loadSession(), null);
});
