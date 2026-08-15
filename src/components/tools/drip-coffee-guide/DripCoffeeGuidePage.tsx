import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	type Brew,
	type BrewInput,
	type BrewLogStore,
	type BrewSession,
	type Recipe,
	type RecipeStep,
	scaleSteps,
} from '@/lib/tools/drip-coffee-guide';
import {
	CorruptedStoreError,
	clearSession,
	createRecipe,
	deleteBrew,
	deleteRecipe,
	duplicateRecipe,
	getLastBrew,
	getRawStoreString,
	getRecentBeanNames,
	importStore,
	loadSession,
	loadStore,
	saveBrew,
	updateBrew,
	updateRecipe,
} from '@/lib/tools/drip-coffee-guide-store';
import {
	BrewForm,
	type BrewFormValues,
	createEmptyBrewFormValues,
} from './BrewForm';
import { BrewGuide } from './BrewGuide';
import { BrewHistory } from './BrewHistory';
import { BrewHome } from './BrewHome';
import { BrewLogSettings } from './BrewLogSettings';
import { RecipeManager } from './RecipeManager';

type RecipeDraft = Omit<Recipe, 'id' | 'updated_at' | 'is_preset'>;

type ActiveGuide = {
	recipe: Recipe;
	steps: RecipeStep[];
	actualDoseG: number;
	initialSession: BrewSession | null;
};

type FormState =
	| { mode: 'new'; values: BrewFormValues }
	| { mode: 'edit'; brewId: string; values: BrewFormValues };

function mapBrewToFormValues(brew: Brew): BrewFormValues {
	return {
		bean_name: brew.bean_name,
		method: brew.method,
		dose_g: String(brew.dose_g),
		yield_g: String(brew.yield_g),
		water_amount_ml:
			brew.water_amount_ml !== undefined ? String(brew.water_amount_ml) : '',
		water_temp_c:
			brew.water_temp_c !== undefined ? String(brew.water_temp_c) : '',
		bloom_time_sec:
			brew.bloom_time_sec !== undefined ? String(brew.bloom_time_sec) : '',
		grind_note: brew.grind_note ?? '',
		brew_time_sec: String(brew.brew_time_sec),
		tds: brew.tds !== undefined ? String(brew.tds) : '',
		overall_score:
			brew.overall_score !== undefined ? String(brew.overall_score) : '',
		notes: brew.notes ?? '',
		recipe_id: brew.recipe_id,
		recipe_name: brew.recipe_name,
	};
}

function loadInitial(): { store: BrewLogStore | null; error: string | null } {
	try {
		return { store: loadStore(), error: null };
	} catch (err) {
		return {
			store: null,
			error:
				err instanceof CorruptedStoreError
					? err.message
					: 'データの読み込みに失敗しました。',
		};
	}
}

export function DripCoffeeGuidePage() {
	const { trackRun } = useToolAnalytics('drip-coffee-guide');

	const [initial] = useState(loadInitial);
	const [store, setStore] = useState<BrewLogStore | null>(initial.store);
	const [loadErrorMessage] = useState<string | null>(initial.error);
	const [rawBackup] = useState<string | null>(() =>
		initial.error ? getRawStoreString() : null,
	);

	const [activeTab, setActiveTab] = useState('brew');
	const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
	const [resumeCandidate, setResumeCandidate] = useState<{
		recipe: Recipe;
		session: BrewSession;
	} | null>(null);
	const [activeGuide, setActiveGuide] = useState<ActiveGuide | null>(null);
	const [formState, setFormState] = useState<FormState | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: initial は useState の初期値スナップショットで不変
	useEffect(() => {
		if (!initial.store) return;
		const last = getLastBrew(initial.store);
		setSelectedRecipeId(
			last?.recipe_id ?? initial.store.recipes[0]?.id ?? null,
		);

		const session = loadSession();
		if (session) {
			const recipe = initial.store.recipes.find(
				(r) => r.id === session.recipeId,
			);
			if (recipe) {
				setResumeCandidate({ recipe, session });
			} else {
				clearSession();
			}
		}
	}, []);

	// ページ離脱時にAudioContextを解放する（作成された場合のみ）
	useEffect(() => {
		return () => {
			audioContext?.close().catch(() => {});
		};
	}, [audioContext]);

	function ensureAudioContext(): AudioContext | null {
		if (typeof window === 'undefined') return null;
		const Ctor =
			window.AudioContext ??
			(window as typeof window & { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext;
		if (!Ctor) return null;
		let ctx = audioContext;
		if (!ctx) {
			ctx = new Ctor();
			setAudioContext(ctx);
		}
		if (ctx.state === 'suspended') {
			ctx.resume().catch(() => {});
		}
		return ctx;
	}

	const handleStartGuide = (recipe: Recipe, actualDoseG: number) => {
		const scaled = scaleSteps(recipe.steps, recipe.dose_g, actualDoseG);
		if (!scaled.ok) return;
		ensureAudioContext();
		setActiveGuide({
			recipe,
			steps: scaled.steps,
			actualDoseG,
			initialSession: null,
		});
	};

	const handleResumeAccept = () => {
		if (!resumeCandidate) return;
		const { recipe, session } = resumeCandidate;
		const scaled = scaleSteps(recipe.steps, recipe.dose_g, session.scaledDoseG);
		ensureAudioContext();
		if (scaled.ok) {
			setActiveGuide({
				recipe,
				steps: scaled.steps,
				actualDoseG: session.scaledDoseG,
				initialSession: session,
			});
		} else {
			clearSession();
		}
		setResumeCandidate(null);
	};

	const handleResumeDiscard = () => {
		clearSession();
		setResumeCandidate(null);
	};

	const handleGuideFinish = (measuredSeconds: number) => {
		const guide = activeGuide;
		setActiveGuide(null);
		if (!guide) return;
		const { recipe, steps, actualDoseG } = guide;
		const totalWaterMl = steps
			.filter((s) => s.action_type === 'pour')
			.reduce((sum, s) => sum + s.pour_amount_ml, 0);
		const last = store ? getLastBrew(store) : undefined;
		const baseline = last
			? mapBrewToFormValues(last)
			: createEmptyBrewFormValues();
		setFormState({
			mode: 'new',
			values: {
				...baseline,
				method: recipe.method,
				dose_g: String(actualDoseG),
				water_amount_ml: String(totalWaterMl),
				water_temp_c:
					recipe.water_temp_c !== undefined
						? String(recipe.water_temp_c)
						: baseline.water_temp_c,
				grind_note: recipe.grind_note ?? baseline.grind_note,
				brew_time_sec: String(measuredSeconds),
				yield_g: '',
				notes: '',
				recipe_id: recipe.id,
				recipe_name: recipe.name,
			},
		});
	};

	const handleRecordWithoutGuide = (recipe: Recipe | null) => {
		const last = store ? getLastBrew(store) : undefined;
		const baseline = last
			? mapBrewToFormValues(last)
			: createEmptyBrewFormValues();
		setFormState({
			mode: 'new',
			values: {
				...baseline,
				method: recipe?.method ?? baseline.method,
				notes: '',
				recipe_id: recipe?.id,
				recipe_name: recipe?.name,
			},
		});
	};

	const handleEditBrew = (brew: Brew) => {
		setFormState({
			mode: 'edit',
			brewId: brew.id,
			values: mapBrewToFormValues(brew),
		});
	};

	const handleFormSubmit = (input: BrewInput) => {
		if (!store || !formState) return;
		if (formState.mode === 'edit') {
			const result = updateBrew(store, formState.brewId, input);
			setStore(result.store);
		} else {
			const result = saveBrew(store, input);
			setStore(result.store);
			trackRun();
		}
		setFormState(null);
	};

	function runAction(fn: (currentStore: BrewLogStore) => BrewLogStore) {
		if (!store) return;
		try {
			setStore(fn(store));
			setActionError(null);
		} catch (err) {
			setActionError(
				err instanceof Error ? err.message : '操作に失敗しました。',
			);
		}
	}

	const recentBeanNames = store ? getRecentBeanNames(store) : [];

	if (loadErrorMessage) {
		return (
			<Alert variant="destructive">
				<AlertTitle>保存データを読み込めませんでした</AlertTitle>
				<AlertDescription>
					<p>{loadErrorMessage}</p>
					<p>
						既存のデータは削除していません。壊れている可能性がある生データは以下から確認できます。
					</p>
					{rawBackup && (
						<pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
							{rawBackup}
						</pre>
					)}
				</AlertDescription>
			</Alert>
		);
	}

	if (!store) {
		return <p className="text-sm text-muted-foreground">読み込み中...</p>;
	}

	return (
		<div className="space-y-4">
			{actionError && (
				<Alert variant="destructive">
					<AlertDescription>{actionError}</AlertDescription>
				</Alert>
			)}

			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList className="w-full grid grid-cols-4">
					<TabsTrigger value="brew">抽出</TabsTrigger>
					<TabsTrigger value="history">履歴</TabsTrigger>
					<TabsTrigger value="recipes">レシピ</TabsTrigger>
					<TabsTrigger value="settings">設定</TabsTrigger>
				</TabsList>
				<TabsContent value="brew" className="mt-4">
					<BrewHome
						recipes={store.recipes}
						selectedRecipeId={selectedRecipeId}
						onSelectRecipe={setSelectedRecipeId}
						onStartGuide={handleStartGuide}
						onRecordWithoutGuide={handleRecordWithoutGuide}
						onUpdateRecipe={(id, draft: RecipeDraft) =>
							runAction((s) => updateRecipe(s, id, draft).store)
						}
					/>
				</TabsContent>
				<TabsContent value="history" className="mt-4">
					<BrewHistory
						brews={store.brews}
						onEdit={handleEditBrew}
						onDelete={(id) => runAction((s) => deleteBrew(s, id))}
					/>
				</TabsContent>
				<TabsContent value="recipes" className="mt-4">
					<RecipeManager
						recipes={store.recipes}
						onCreate={(draft: RecipeDraft) =>
							runAction((s) => createRecipe(s, draft).store)
						}
						onUpdate={(id, draft: RecipeDraft) =>
							runAction((s) => updateRecipe(s, id, draft).store)
						}
						onDuplicate={(id) => runAction((s) => duplicateRecipe(s, id).store)}
						onDelete={(id) => runAction((s) => deleteRecipe(s, id))}
					/>
				</TabsContent>
				<TabsContent value="settings" className="mt-4">
					<BrewLogSettings
						store={store}
						ensureAudioContext={ensureAudioContext}
						onImport={(incoming, mode) =>
							runAction((s) => importStore(s, incoming, mode))
						}
					/>
				</TabsContent>
			</Tabs>

			{activeGuide && (
				<BrewGuide
					recipe={activeGuide.recipe}
					steps={activeGuide.steps}
					actualDoseG={activeGuide.actualDoseG}
					initialSession={activeGuide.initialSession}
					audioContext={audioContext}
					onFinish={handleGuideFinish}
					onDiscard={() => setActiveGuide(null)}
				/>
			)}

			{formState && (
				<BrewForm
					open
					mode={formState.mode}
					initialValues={formState.values}
					recentBeanNames={recentBeanNames}
					onCancel={() => setFormState(null)}
					onSubmit={handleFormSubmit}
				/>
			)}

			<Dialog
				open={resumeCandidate !== null}
				onOpenChange={(next) => !next && handleResumeDiscard()}
			>
				{resumeCandidate && (
					<DialogContent>
						<DialogHeader>
							<DialogTitle>前回中断した抽出があります</DialogTitle>
							<DialogDescription>
								「{resumeCandidate.recipe.name}
								」の抽出ガイドが途中で終了しています。再開しますか？
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="outline" onClick={handleResumeDiscard}>
								破棄する
							</Button>
							<Button onClick={handleResumeAccept}>再開する</Button>
						</DialogFooter>
					</DialogContent>
				)}
			</Dialog>
		</div>
	);
}
