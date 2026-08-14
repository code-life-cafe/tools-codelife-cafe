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

test('loadStore: 未保存時はプリセット3種のみで初期化し永続化する', () => {
	const store = loadStore();
	assert.strictEqual(store.recipes.length, 3);
	assert.strictEqual(store.brews.length, 0);
	assert.ok(localStorage.getItem(STORAGE_KEY));
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
