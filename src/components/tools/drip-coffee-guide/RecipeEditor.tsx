import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {
	BREW_FIELD_RANGES,
	isInRange,
	type MethodId,
	type Recipe,
	type RecipeStep,
	type RecipeStepActionType,
} from '@/lib/tools/drip-coffee-guide';

export const METHOD_LABELS: Record<MethodId, string> = {
	v60: 'V60',
	switch: 'Switch',
	kalita: 'カリタ',
	pour_other: 'その他',
};

const ACTION_LABELS: Record<RecipeStepActionType, string> = {
	pour: '注湯',
	wait: '待つ',
	swirl: 'スワール',
	finish: '完了',
};

export type RecipeDraft = Omit<Recipe, 'id' | 'updated_at' | 'is_preset'>;

export function emptyDraft(): RecipeDraft {
	return {
		name: '',
		method: 'v60',
		dose_g: 20,
		total_water_ml: 0,
		water_temp_c: undefined,
		grind_note: '',
		description: '',
		steps: [
			{
				step_order: 1,
				time_sec: 0,
				pour_amount_ml: 0,
				label: '1投目',
				action_type: 'pour',
			},
			{
				step_order: 2,
				time_sec: 0,
				pour_amount_ml: 0,
				label: '抽出終了',
				action_type: 'finish',
			},
		],
	};
}

export function recipeToDraft(recipe: Recipe): RecipeDraft {
	return {
		name: recipe.name,
		method: recipe.method,
		dose_g: recipe.dose_g,
		total_water_ml: recipe.total_water_ml,
		water_temp_c: recipe.water_temp_c,
		grind_note: recipe.grind_note,
		description: recipe.description,
		steps: recipe.steps.map((s) => ({ ...s })),
	};
}

export function RecipeEditor({
	initialDraft,
	onCancel,
	onSave,
}: {
	initialDraft: RecipeDraft;
	onCancel: () => void;
	onSave: (draft: RecipeDraft) => void;
}) {
	const [draft, setDraft] = useState(initialDraft);
	const [errors, setErrors] = useState<string[]>([]);

	const updateStep = (index: number, patch: Partial<RecipeStep>) => {
		setDraft((prev) => ({
			...prev,
			steps: prev.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
		}));
	};

	const addStep = () => {
		setDraft((prev) => {
			const steps = [...prev.steps];
			const finishIndex = steps.findIndex((s) => s.action_type === 'finish');
			const insertIndex = finishIndex !== -1 ? finishIndex : steps.length;

			const prevStep = insertIndex > 0 ? steps[insertIndex - 1] : null;
			const nextTimeSec = prevStep ? prevStep.time_sec + 30 : 0;
			const pourCount = steps
				.slice(0, insertIndex)
				.filter((s) => s.action_type === 'pour').length;

			const newStep: RecipeStep = {
				step_order: insertIndex + 1,
				time_sec: nextTimeSec,
				pour_amount_ml: 0,
				label: `${pourCount + 1}投目`,
				action_type: 'pour',
			};

			steps.splice(insertIndex, 0, newStep);

			let lastTime = 0;
			const reordered = steps.map((s, i) => {
				const isFinish = s.action_type === 'finish';
				let t = s.time_sec;
				if (isFinish && t <= lastTime) {
					t = lastTime + 30;
				} else {
					lastTime = t;
				}
				return {
					...s,
					step_order: i + 1,
					time_sec: t,
				};
			});

			return {
				...prev,
				steps: reordered,
			};
		});
	};

	const removeStep = (index: number) => {
		setDraft((prev) => {
			const target = prev.steps[index];
			if (target?.action_type === 'finish') return prev;

			const filtered = prev.steps.filter((_, i) => i !== index);
			return {
				...prev,
				steps: filtered.map((s, i) => ({ ...s, step_order: i + 1 })),
			};
		});
	};

	const handleSave = () => {
		const validationErrors: string[] = [];
		if (draft.name.trim() === '')
			validationErrors.push('レシピ名を入力してください。');
		if (!isInRange(draft.dose_g, 'dose_g')) {
			const [min, max] = BREW_FIELD_RANGES.dose_g;
			validationErrors.push(`豆量は${min}〜${max}gの範囲で入力してください。`);
		}
		const pourSteps = draft.steps.filter((s) => s.action_type === 'pour');
		if (pourSteps.length === 0)
			validationErrors.push('注湯ステップを1つ以上追加してください。');
		if (validationErrors.length > 0) {
			setErrors(validationErrors);
			return;
		}

		// finish ステップが末尾に存在することを確認・正規化
		let normalizedSteps = [...draft.steps];
		const finishIndex = normalizedSteps.findIndex(
			(s) => s.action_type === 'finish',
		);
		let finishStep: RecipeStep;
		if (finishIndex !== -1) {
			[finishStep] = normalizedSteps.splice(finishIndex, 1);
		} else {
			finishStep = {
				step_order: normalizedSteps.length + 1,
				time_sec: 0,
				pour_amount_ml: 0,
				label: '抽出終了',
				action_type: 'finish',
			};
		}

		const maxPrevTimeSec = normalizedSteps.reduce(
			(max, s) => Math.max(max, s.time_sec),
			0,
		);
		finishStep.time_sec = Math.max(finishStep.time_sec, maxPrevTimeSec + 30);
		normalizedSteps.push(finishStep);

		normalizedSteps = normalizedSteps.map((s, i) => ({
			...s,
			step_order: i + 1,
		}));

		const totalWaterMl = pourSteps.reduce(
			(sum, s) => sum + s.pour_amount_ml,
			0,
		);
		onSave({
			...draft,
			steps: normalizedSteps,
			total_water_ml: totalWaterMl,
		});
	};

	return (
		<Dialog open onOpenChange={(next) => !next && onCancel()}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{initialDraft.name ? 'レシピを編集' : '新しいレシピ'}
					</DialogTitle>
				</DialogHeader>

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div className="space-y-2 sm:col-span-2">
						<Label htmlFor="recipe-name">レシピ名</Label>
						<Input
							id="recipe-name"
							value={draft.name}
							onChange={(e) =>
								setDraft((prev) => ({ ...prev, name: e.target.value }))
							}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="recipe-method">抽出器具</Label>
						<Select
							value={draft.method}
							onValueChange={(v) =>
								setDraft((prev) => ({ ...prev, method: v as MethodId }))
							}
						>
							<SelectTrigger id="recipe-method" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{(Object.keys(METHOD_LABELS) as MethodId[]).map((id) => (
									<SelectItem key={id} value={id}>
										{METHOD_LABELS[id]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-2">
						<Label htmlFor="recipe-dose">基準豆量（g）</Label>
						<Input
							id="recipe-dose"
							type="text"
							inputMode="decimal"
							value={String(draft.dose_g)}
							onChange={(e) =>
								setDraft((prev) => ({
									...prev,
									dose_g: Number(e.target.value) || 0,
								}))
							}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="recipe-temp">湯温（℃）</Label>
						<Input
							id="recipe-temp"
							type="text"
							inputMode="decimal"
							value={
								draft.water_temp_c !== undefined
									? String(draft.water_temp_c)
									: ''
							}
							onChange={(e) =>
								setDraft((prev) => ({
									...prev,
									water_temp_c:
										e.target.value === '' ? undefined : Number(e.target.value),
								}))
							}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="recipe-grind">挽き目</Label>
						<Input
							id="recipe-grind"
							value={draft.grind_note ?? ''}
							onChange={(e) =>
								setDraft((prev) => ({ ...prev, grind_note: e.target.value }))
							}
						/>
					</div>
				</div>

				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<Label>ステップ</Label>
						<Button type="button" variant="outline" size="sm" onClick={addStep}>
							<Plus className="h-4 w-4" />
							ステップを追加
						</Button>
					</div>
					<div className="hidden sm:grid grid-cols-[5rem_5rem_1fr_7rem_auto] gap-2 px-2 text-xs text-muted-foreground">
						<span>開始(秒)</span>
						<span>注湯量(ml)</span>
						<span>ラベル</span>
						<span>種別</span>
						<span />
					</div>
					<div className="space-y-2">
						{draft.steps.map((step, index) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: ステップは並び替えを行わず、インデックスが安定したキーになる
								key={index}
								className="grid grid-cols-[5rem_5rem_1fr_7rem_auto] items-center gap-2 rounded-lg border border-border p-2"
							>
								<div className="relative">
									<Input
										type="text"
										inputMode="numeric"
										aria-label="開始(秒)"
										value={String(step.time_sec)}
										onChange={(e) =>
											updateStep(index, {
												time_sec: Number(e.target.value) || 0,
											})
										}
										className="pr-7"
									/>
									<span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
										秒
									</span>
								</div>
								<div className="relative">
									<Input
										type="text"
										inputMode="numeric"
										aria-label="注湯量(ml)"
										value={String(step.pour_amount_ml)}
										onChange={(e) =>
											updateStep(index, {
												pour_amount_ml: Number(e.target.value) || 0,
											})
										}
										className="pr-8"
									/>
									<span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
										ml
									</span>
								</div>
								<Input
									aria-label="ラベル"
									value={step.label}
									onChange={(e) => updateStep(index, { label: e.target.value })}
								/>
								<Select
									value={step.action_type}
									onValueChange={(v) =>
										updateStep(index, {
											action_type: v as RecipeStepActionType,
										})
									}
								>
									<SelectTrigger aria-label="種別">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{(Object.keys(ACTION_LABELS) as RecipeStepActionType[]).map(
											(id) => (
												<SelectItem key={id} value={id}>
													{ACTION_LABELS[id]}
												</SelectItem>
											),
										)}
									</SelectContent>
								</Select>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label="ステップを削除"
									onClick={() => removeStep(index)}
									disabled={draft.steps.length <= 1}
								>
									<Trash2 className="h-4 w-4" />
								</Button>
							</div>
						))}
					</div>
					<p className="text-xs text-muted-foreground">
						種別の意味:
						注湯＝お湯を注ぐ／待つ＝そのまま待機／スワール＝ドリッパーを軽く揺すり粉の層を平らにならす／完了＝抽出終了
					</p>
				</div>

				{errors.length > 0 && (
					<div
						className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
						role="alert"
					>
						<ul className="list-disc pl-5">
							{errors.map((error) => (
								<li key={error}>{error}</li>
							))}
						</ul>
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						キャンセル
					</Button>
					<Button onClick={handleSave}>保存する</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
