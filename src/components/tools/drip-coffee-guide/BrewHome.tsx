import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	calcBrewRatio,
	type MethodId,
	type Recipe,
	scaleSteps,
} from '@/lib/tools/drip-coffee-guide';

const METHOD_LABELS: Record<MethodId, string> = {
	v60: 'V60',
	switch: 'Switch',
	kalita: 'カリタ',
	pour_other: 'その他',
};

function formatDuration(totalSec: number): string {
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${m}分${s > 0 ? `${s}秒` : ''}`;
}

interface BrewHomeProps {
	recipes: readonly Recipe[];
	selectedRecipeId: string | null;
	onSelectRecipe: (id: string) => void;
	onStartGuide: (recipe: Recipe, actualDoseG: number) => void;
	onRecordWithoutGuide: (recipe: Recipe | null) => void;
}

export function BrewHome({
	recipes,
	selectedRecipeId,
	onSelectRecipe,
	onStartGuide,
	onRecordWithoutGuide,
}: BrewHomeProps) {
	const selectedRecipe =
		recipes.find((r) => r.id === selectedRecipeId) ?? recipes[0] ?? null;
	const [doseInput, setDoseInput] = useState(
		selectedRecipe ? String(selectedRecipe.dose_g) : '',
	);
	const lastRecipeIdRef = useRef<string | undefined>(selectedRecipe?.id);

	if (selectedRecipe && selectedRecipe.id !== lastRecipeIdRef.current) {
		lastRecipeIdRef.current = selectedRecipe.id;
		setDoseInput(String(selectedRecipe.dose_g));
	}

	if (recipes.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				レシピがありません。「レシピ」タブから作成してください。
			</p>
		);
	}

	const doseNum = Number(doseInput);
	const doseValid = Number.isFinite(doseNum) && doseNum > 0;
	const scaleResult =
		selectedRecipe && doseValid
			? scaleSteps(selectedRecipe.steps, selectedRecipe.dose_g, doseNum)
			: null;
	const scaledTotalMl = scaleResult?.ok
		? scaleResult.steps
				.filter((s) => s.action_type === 'pour')
				.reduce((sum, s) => sum + s.pour_amount_ml, 0)
		: undefined;
	const ratio =
		selectedRecipe && doseValid && scaledTotalMl !== undefined
			? calcBrewRatio(doseNum, scaledTotalMl)
			: undefined;

	return (
		<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
			<ul
				className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3 auto-rows-min list-none p-0 m-0"
				aria-label="レシピ一覧"
			>
				{recipes.map((recipe) => (
					<li key={recipe.id}>
						<RecipeCard
							recipe={recipe}
							selected={recipe.id === selectedRecipe?.id}
							onSelect={() => onSelectRecipe(recipe.id)}
						/>
					</li>
				))}
			</ul>

			<div className="lg:col-span-1">
				<div className="lg:sticky lg:top-4 space-y-4 rounded-xl border border-border bg-card p-4">
					{selectedRecipe ? (
						<>
							<div>
								<p className="text-xs text-muted-foreground">
									{METHOD_LABELS[selectedRecipe.method]}
								</p>
								<h3 className="text-lg font-semibold">{selectedRecipe.name}</h3>
							</div>

							<div className="space-y-2">
								<Label htmlFor="brew-home-dose">豆量</Label>
								<div className="relative">
									<Input
										id="brew-home-dose"
										type="text"
										inputMode="decimal"
										value={doseInput}
										onChange={(e) => setDoseInput(e.target.value)}
										aria-label="豆量"
										className="pr-10"
									/>
									<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
										g
									</span>
								</div>
							</div>

							<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
								<dt className="text-muted-foreground">総湯量</dt>
								<dd className="text-right tabular-nums">
									{scaledTotalMl !== undefined ? `${scaledTotalMl}ml` : '—'}
								</dd>
								<dt className="text-muted-foreground">湯温</dt>
								<dd className="text-right tabular-nums">
									{selectedRecipe.water_temp_c !== undefined
										? `${selectedRecipe.water_temp_c}℃`
										: '—'}
								</dd>
								<dt className="text-muted-foreground">挽き目</dt>
								<dd className="text-right">
									{selectedRecipe.grind_note ?? '—'}
								</dd>
								<dt className="text-muted-foreground">レシオ</dt>
								<dd className="text-right tabular-nums">
									{ratio !== undefined ? `1 : ${ratio.toFixed(1)}` : '—'}
								</dd>
								<dt className="text-muted-foreground">想定時間</dt>
								<dd className="text-right tabular-nums">
									{formatDuration(
										selectedRecipe.steps[selectedRecipe.steps.length - 1]
											?.time_sec ?? 0,
									)}
								</dd>
							</dl>

							{scaleResult && !scaleResult.ok && (
								<p className="text-sm text-destructive" role="alert">
									{scaleResult.message}
								</p>
							)}

							<Button
								className="w-full"
								size="lg"
								disabled={!scaleResult?.ok}
								onClick={() =>
									scaleResult?.ok && onStartGuide(selectedRecipe, doseNum)
								}
							>
								ガイド開始
							</Button>
							<Button
								className="w-full"
								variant="ghost"
								size="sm"
								onClick={() => onRecordWithoutGuide(selectedRecipe)}
							>
								ガイドなしで記録
							</Button>
						</>
					) : null}
				</div>
			</div>
		</div>
	);
}

function RecipeCard({
	recipe,
	selected,
	onSelect,
}: {
	recipe: Recipe;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			className={`w-full text-left rounded-xl border p-4 transition-colors ${
				selected
					? 'border-primary ring-2 ring-primary/30 bg-primary/5'
					: 'border-border bg-card hover:border-primary/50'
			}`}
		>
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs font-medium text-muted-foreground">
					{METHOD_LABELS[recipe.method]}
				</span>
				<span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
					{recipe.is_preset ? 'プリセット' : 'マイレシピ'}
				</span>
			</div>
			<h4 className="mt-1 font-semibold">{recipe.name}</h4>
			<p className="mt-1 text-sm text-muted-foreground">
				{recipe.dose_g}g → {recipe.total_water_ml}g ・{' '}
				{formatDuration(recipe.steps[recipe.steps.length - 1]?.time_sec ?? 0)}
			</p>
		</button>
	);
}
