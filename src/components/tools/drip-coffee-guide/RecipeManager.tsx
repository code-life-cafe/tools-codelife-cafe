import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import type { Recipe } from '@/lib/tools/drip-coffee-guide';
import {
	emptyDraft,
	METHOD_LABELS,
	type RecipeDraft,
	RecipeEditor,
	recipeToDraft,
} from './RecipeEditor';

interface RecipeManagerProps {
	recipes: readonly Recipe[];
	onCreate: (draft: RecipeDraft) => void;
	onUpdate: (id: string, draft: RecipeDraft) => void;
	onDuplicate: (id: string) => void;
	onDelete: (id: string) => void;
}

export function RecipeManager({
	recipes,
	onCreate,
	onUpdate,
	onDuplicate,
	onDelete,
}: RecipeManagerProps) {
	const [editorState, setEditorState] = useState<
		null | { mode: 'new' } | { mode: 'edit'; recipe: Recipe }
	>(null);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

	const presets = recipes.filter((r) => r.is_preset);
	const myRecipes = recipes.filter((r) => !r.is_preset);

	return (
		<div className="space-y-8">
			<section>
				<h3 className="mb-3 text-sm font-semibold text-muted-foreground">
					プリセット
				</h3>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					{presets.map((recipe) => (
						<div
							key={recipe.id}
							className="rounded-xl border border-border bg-card p-4"
						>
							<p className="text-xs text-muted-foreground">
								{METHOD_LABELS[recipe.method]}
							</p>
							<h4 className="font-semibold">{recipe.name}</h4>
							<p className="mt-1 text-sm text-muted-foreground">
								{recipe.dose_g}g → {recipe.total_water_ml}g
							</p>
							<Button
								variant="outline"
								size="sm"
								className="mt-3"
								onClick={() => onDuplicate(recipe.id)}
							>
								<Copy className="h-4 w-4" />
								複製
							</Button>
						</div>
					))}
				</div>
			</section>

			<section>
				<div className="mb-3 flex items-center justify-between">
					<h3 className="text-sm font-semibold text-muted-foreground">
						マイレシピ
					</h3>
					<Button size="sm" onClick={() => setEditorState({ mode: 'new' })}>
						<Plus className="h-4 w-4" />
						新しいレシピを作る
					</Button>
				</div>
				{myRecipes.length === 0 ? (
					<div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
						まだマイレシピがありません。
					</div>
				) : (
					<ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
						{myRecipes.map((recipe) => (
							<li
								key={recipe.id}
								className="flex items-center justify-between gap-3 px-4 py-3"
							>
								<div className="min-w-0">
									<p className="truncate font-medium">{recipe.name}</p>
									<p className="text-xs text-muted-foreground">
										{METHOD_LABELS[recipe.method]} ・ {recipe.dose_g}g →{' '}
										{recipe.total_water_ml}g
									</p>
								</div>
								<div className="flex shrink-0 gap-1">
									<Button
										variant="ghost"
										size="icon"
										aria-label="編集"
										onClick={() => setEditorState({ mode: 'edit', recipe })}
									>
										<Pencil className="h-4 w-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label="削除"
										onClick={() => setConfirmDeleteId(recipe.id)}
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
			</section>

			{editorState && (
				<RecipeEditor
					initialDraft={
						editorState.mode === 'edit'
							? recipeToDraft(editorState.recipe)
							: emptyDraft()
					}
					onCancel={() => setEditorState(null)}
					onSave={(draft) => {
						if (editorState.mode === 'edit') {
							onUpdate(editorState.recipe.id, draft);
						} else {
							onCreate(draft);
						}
						setEditorState(null);
					}}
				/>
			)}

			<Dialog
				open={confirmDeleteId !== null}
				onOpenChange={(next) => !next && setConfirmDeleteId(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>このレシピを削除しますか？</DialogTitle>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
							キャンセル
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								if (confirmDeleteId) {
									onDelete(confirmDeleteId);
									setConfirmDeleteId(null);
								}
							}}
						>
							削除する
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
