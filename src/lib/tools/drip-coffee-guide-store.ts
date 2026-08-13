// ドリップコーヒー抽出ガイドの localStorage 永続化層。
// 純粋関数（drip-coffee-guide.ts）を呼び出し、副作用（読み書き）だけをここに閉じ込める。

import {
	applyImport,
	type Brew,
	type BrewInput,
	type BrewLogStore,
	type BrewSession,
	InvalidBrewLogStoreError,
	PRESET_RECIPES,
	previewImport as previewImportStore,
	type Recipe,
	STORE_VERSION,
	validateBrewInput,
	validateBrewLogStore,
} from './drip-coffee-guide.ts';

export const STORAGE_KEY = 'tools.codelife.cafe:drip-coffee-guide:v1';
export const SESSION_STORAGE_KEY =
	'tools.codelife.cafe:drip-coffee-guide:session:v1';

/** 保存データのJSONが壊れている場合（呼び出し元は既存データを消さずエラー表示する）。 */
export class CorruptedStoreError extends Error {}

/** localStorage への書き込みが失敗した場合（容量不足等）。 */
export class QuotaExceededStoreError extends Error {}

function nowIso(): string {
	return new Date().toISOString();
}

function initialStore(): BrewLogStore {
	return {
		version: STORE_VERSION,
		recipes: PRESET_RECIPES.map((recipe) => ({ ...recipe })),
		brews: [],
	};
}

function persist(store: BrewLogStore): void {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
	} catch {
		throw new QuotaExceededStoreError(
			'保存に失敗しました。ブラウザの保存容量が不足している可能性があります。',
		);
	}
}

/** 破損データの復旧導線用に、加工前の生JSON文字列を返す。 */
export function getRawStoreString(): string | null {
	if (typeof window === 'undefined') return null;
	return localStorage.getItem(STORAGE_KEY);
}

/**
 * ストアを読み込む。未保存なら初期値（プリセット3種のみ）で初期化して永続化する。
 * 破損JSONは初期化せず CorruptedStoreError を投げる。
 */
export function loadStore(): BrewLogStore {
	if (typeof window === 'undefined') return initialStore();

	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) {
		const store = initialStore();
		persist(store);
		return store;
	}

	try {
		const parsed = JSON.parse(raw);
		return validateBrewLogStore(parsed);
	} catch (e) {
		const message =
			e instanceof InvalidBrewLogStoreError
				? e.message
				: '保存データを読み込めませんでした。JSON形式が壊れている可能性があります。';
		throw new CorruptedStoreError(message);
	}
}

export function saveBrew(
	store: BrewLogStore,
	input: BrewInput,
): { store: BrewLogStore; brew: Brew } {
	const validation = validateBrewInput(input);
	if (!validation.ok) {
		throw new Error(validation.errors.join(' '));
	}
	const now = nowIso();
	const brew: Brew = {
		...input,
		id: crypto.randomUUID(),
		brewed_at: input.brewed_at ?? now,
		updated_at: now,
	};
	const nextStore: BrewLogStore = { ...store, brews: [brew, ...store.brews] };
	persist(nextStore);
	return { store: nextStore, brew };
}

export function updateBrew(
	store: BrewLogStore,
	id: string,
	input: BrewInput,
): { store: BrewLogStore; brew: Brew } {
	const validation = validateBrewInput(input);
	if (!validation.ok) {
		throw new Error(validation.errors.join(' '));
	}
	const existing = store.brews.find((b) => b.id === id);
	if (!existing) {
		throw new Error('対象の記録が見つかりません。');
	}
	const brew: Brew = { ...existing, ...input, id, updated_at: nowIso() };
	const nextStore: BrewLogStore = {
		...store,
		brews: store.brews.map((b) => (b.id === id ? brew : b)),
	};
	persist(nextStore);
	return { store: nextStore, brew };
}

export function deleteBrew(store: BrewLogStore, id: string): BrewLogStore {
	const nextStore: BrewLogStore = {
		...store,
		brews: store.brews.filter((b) => b.id !== id),
	};
	persist(nextStore);
	return nextStore;
}

type RecipeDraft = Omit<Recipe, 'id' | 'updated_at' | 'is_preset'>;

export function createRecipe(
	store: BrewLogStore,
	draft: RecipeDraft,
): { store: BrewLogStore; recipe: Recipe } {
	const recipe: Recipe = {
		...draft,
		id: crypto.randomUUID(),
		is_preset: false,
		updated_at: nowIso(),
	};
	const nextStore: BrewLogStore = {
		...store,
		recipes: [...store.recipes, recipe],
	};
	persist(nextStore);
	return { store: nextStore, recipe };
}

export function updateRecipe(
	store: BrewLogStore,
	id: string,
	draft: RecipeDraft,
): { store: BrewLogStore; recipe: Recipe } {
	const existing = store.recipes.find((r) => r.id === id);
	if (!existing) {
		throw new Error('対象のレシピが見つかりません。');
	}
	if (existing.is_preset) {
		throw new Error(
			'プリセットは編集できません。複製してから編集してください。',
		);
	}
	const recipe: Recipe = {
		...draft,
		id,
		is_preset: false,
		updated_at: nowIso(),
	};
	const nextStore: BrewLogStore = {
		...store,
		recipes: store.recipes.map((r) => (r.id === id ? recipe : r)),
	};
	persist(nextStore);
	return { store: nextStore, recipe };
}

export function duplicateRecipe(
	store: BrewLogStore,
	sourceId: string,
): { store: BrewLogStore; recipe: Recipe } {
	const source = store.recipes.find((r) => r.id === sourceId);
	if (!source) {
		throw new Error('複製元のレシピが見つかりません。');
	}
	const recipe: Recipe = {
		...source,
		id: crypto.randomUUID(),
		name: `${source.name}のコピー`,
		is_preset: false,
		updated_at: nowIso(),
	};
	const nextStore: BrewLogStore = {
		...store,
		recipes: [...store.recipes, recipe],
	};
	persist(nextStore);
	return { store: nextStore, recipe };
}

export function deleteRecipe(store: BrewLogStore, id: string): BrewLogStore {
	const target = store.recipes.find((r) => r.id === id);
	if (target?.is_preset) {
		throw new Error('プリセットは削除できません。');
	}
	const nextStore: BrewLogStore = {
		...store,
		recipes: store.recipes.filter((r) => r.id !== id),
	};
	persist(nextStore);
	return nextStore;
}

export function exportStoreJson(store: BrewLogStore): string {
	return JSON.stringify(store, null, 2);
}

/** 読み込んだJSON文字列を検証する。壊れていれば InvalidBrewLogStoreError を投げる。 */
export function parseImportJson(json: string): BrewLogStore {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new InvalidBrewLogStoreError('JSONとして読み込めませんでした。');
	}
	return validateBrewLogStore(parsed);
}

/** 置換・併合いずれも実行前に結果件数を提示するためのプレビュー。 */
export function previewImport(
	store: BrewLogStore,
	incoming: BrewLogStore,
	mode: 'replace' | 'merge',
) {
	return previewImportStore(store, incoming, mode);
}

export function importStore(
	store: BrewLogStore,
	incoming: BrewLogStore,
	mode: 'replace' | 'merge',
): BrewLogStore {
	const next = applyImport(store, incoming, mode);
	persist(next);
	return next;
}

/** 直近の一意な豆名を最大 limit 件、新しい順で返す（フォームのサジェスト用）。 */
export function getRecentBeanNames(store: BrewLogStore, limit = 8): string[] {
	const seen = new Set<string>();
	const names: string[] = [];
	const sorted = [...store.brews].sort((a, b) =>
		b.brewed_at.localeCompare(a.brewed_at),
	);
	for (const brew of sorted) {
		const name = brew.bean_name.trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		names.push(name);
		if (names.length >= limit) break;
	}
	return names;
}

/** 直近1件のBrew（新規記録フォームのプリフィル用）。 */
export function getLastBrew(store: BrewLogStore): Brew | undefined {
	return [...store.brews].sort((a, b) =>
		b.brewed_at.localeCompare(a.brewed_at),
	)[0];
}

// --- 抽出ガイドの一時セッション（sessionStorage） -------------------------------------------------
// リロード時の「再開／破棄」確認に使う。localStorageの永続データとは別領域。

function isValidSession(value: unknown): value is BrewSession {
	if (value === null || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.recipeId === 'string' &&
		typeof v.startedAtUnix === 'number' &&
		typeof v.pausedElapsedMs === 'number' &&
		typeof v.currentStepIndex === 'number' &&
		typeof v.scaledDoseG === 'number' &&
		(v.status === 'running' || v.status === 'paused')
	);
}

export function saveSession(session: BrewSession): void {
	if (typeof window === 'undefined') return;
	try {
		sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
	} catch {
		// セッション保存の失敗はガイドの進行を止めない
	}
}

export function loadSession(): BrewSession | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return isValidSession(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function clearSession(): void {
	if (typeof window === 'undefined') return;
	sessionStorage.removeItem(SESSION_STORAGE_KEY);
}
