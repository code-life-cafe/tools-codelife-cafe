import { ArrowUpDown, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import type { Column, SortKey } from '@/lib/tools/table-query';

interface SortPanelProps {
	columns: Column[];
	sortKeys: SortKey[];
	onChangeSortKeys: (keys: SortKey[]) => void;
}

export function SortPanel({
	columns,
	sortKeys,
	onChangeSortKeys,
}: SortPanelProps) {
	const addSortKey = () => {
		if (columns.length === 0) return;
		// 未使用の列を優先して選択
		const usedIds = new Set(sortKeys.map((k) => k.columnId));
		const unusedCol = columns.find((c) => !usedIds.has(c.id)) ?? columns[0];
		onChangeSortKeys([
			...sortKeys,
			{ columnId: unusedCol.id, direction: 'asc' },
		]);
	};

	const removeSortKey = (idx: number) => {
		const newKeys = [...sortKeys];
		newKeys.splice(idx, 1);
		onChangeSortKeys(newKeys);
	};

	const updateSortKey = (idx: number, patch: Partial<SortKey>) => {
		const newKeys = sortKeys.map((k, i) =>
			i === idx ? { ...k, ...patch } : k,
		);
		onChangeSortKeys(newKeys);
	};

	const clearAll = () => {
		onChangeSortKeys([]);
	};

	return (
		<div className="bg-muted/20 p-4 rounded-xl border space-y-4 mb-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<ArrowUpDown className="h-4 w-4 text-primary" />
					<h3 className="text-sm font-semibold">マルチカラム・型認識ソート</h3>
					{sortKeys.length > 0 && (
						<span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-medium">
							{sortKeys.length} キー設定中
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					{sortKeys.length > 0 && (
						<Button
							variant="ghost"
							size="sm"
							onClick={clearAll}
							className="h-7 text-xs text-muted-foreground"
						>
							<X className="h-3 w-3 mr-1" /> リセット
						</Button>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={addSortKey}
						className="h-7 text-xs"
					>
						<Plus className="h-3 w-3 mr-1" /> キーを追加
					</Button>
				</div>
			</div>

			{sortKeys.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					ソートキーが設定されていません。「キーを追加」または表ヘッダークリックで並べ替えできます。
				</p>
			) : (
				<div className="space-y-2">
					{sortKeys.map((key, idx) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: sort key mapped by index
							key={`sort-${idx}`}
							className="flex items-center gap-2 bg-background p-2 rounded-lg border text-xs"
						>
							<span className="text-muted-foreground w-12 font-semibold">
								第{idx + 1}キー:
							</span>
							<Select
								value={key.columnId}
								onValueChange={(v) => updateSortKey(idx, { columnId: v })}
							>
								<SelectTrigger className="w-[160px] h-8">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{columns.map((c) => (
										<SelectItem key={c.id} value={c.id}>
											{c.name} ({c.type ?? 'text'})
										</SelectItem>
									))}
								</SelectContent>
							</Select>

							<Select
								value={key.direction}
								onValueChange={(v: 'asc' | 'desc') =>
									updateSortKey(idx, { direction: v })
								}
							>
								<SelectTrigger className="w-[120px] h-8">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="asc">昇順 (Asc)</SelectItem>
									<SelectItem value="desc">降順 (Desc)</SelectItem>
								</SelectContent>
							</Select>

							<Button
								variant="ghost"
								size="sm"
								onClick={() => removeSortKey(idx)}
								className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600 ml-auto"
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
