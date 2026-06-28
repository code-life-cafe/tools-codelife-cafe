import { Filter, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
	type Column,
	type ColumnType,
	type FilterCondition,
	type FilterGroup,
	type FilterOperator,
	validateFilterCondition,
} from '@/lib/tools/table-query';

interface FilterPanelProps {
	columns: Column[];
	filterGroup: FilterGroup;
	onChangeFilterGroup: (group: FilterGroup) => void;
}

const OPERATORS_BY_TYPE: Record<
	ColumnType,
	{ label: string; value: FilterOperator }[]
> = {
	text: [
		{ label: '含む', value: 'contains' },
		{ label: '含まない', value: 'notContains' },
		{ label: '等しい', value: 'eq' },
		{ label: '等しくない', value: 'neq' },
		{ label: 'で始まる', value: 'startsWith' },
		{ label: 'で終わる', value: 'endsWith' },
		{ label: '空である', value: 'empty' },
		{ label: '空でない', value: 'notEmpty' },
	],
	number: [
		{ label: '=', value: 'eq' },
		{ label: '≠', value: 'neq' },
		{ label: '＞', value: 'gt' },
		{ label: '≧', value: 'gte' },
		{ label: '＜', value: 'lt' },
		{ label: '≦', value: 'lte' },
		{ label: '範囲 (between)', value: 'between' },
		{ label: '空である', value: 'empty' },
		{ label: '空でない', value: 'notEmpty' },
	],
	date: [
		{ label: '以前', value: 'before' },
		{ label: '以後', value: 'after' },
		{ label: '等しい', value: 'eq' },
		{ label: '期間 (dateRange)', value: 'dateRange' },
		{ label: '空である', value: 'empty' },
		{ label: '空でない', value: 'notEmpty' },
	],
	boolean: [
		{ label: '等しい', value: 'eq' },
		{ label: '等しくない', value: 'neq' },
		{ label: '空である', value: 'empty' },
		{ label: '空でない', value: 'notEmpty' },
	],
};

export function FilterPanel({
	columns,
	filterGroup,
	onChangeFilterGroup,
}: FilterPanelProps) {
	const addCondition = () => {
		if (columns.length === 0) return;
		const firstCol = columns[0];
		const defaultOp: FilterOperator =
			firstCol.type === 'number'
				? 'gte'
				: firstCol.type === 'date'
					? 'after'
					: 'contains';
		const newCond: FilterCondition = {
			columnId: firstCol.id,
			operator: defaultOp,
			value: '',
		};
		onChangeFilterGroup({
			...filterGroup,
			conditions: [...filterGroup.conditions, newCond],
		});
	};

	const removeCondition = (idx: number) => {
		const newConds = [...filterGroup.conditions];
		newConds.splice(idx, 1);
		onChangeFilterGroup({
			...filterGroup,
			conditions: newConds,
		});
	};

	const updateCondition = (idx: number, patch: Partial<FilterCondition>) => {
		const newConds = filterGroup.conditions.map((c, i) => {
			if (i !== idx) return c;
			const updated = { ...c, ...patch };
			// 列が変わった場合、型に合ったデフォルト演算子を適用
			if (patch.columnId && patch.columnId !== c.columnId) {
				const col = columns.find((col) => col.id === patch.columnId);
				const colType = col?.type ?? 'text';
				updated.operator = OPERATORS_BY_TYPE[colType][0].value;
				updated.value = '';
				updated.value2 = '';
			}
			return updated;
		});
		onChangeFilterGroup({
			...filterGroup,
			conditions: newConds,
		});
	};

	const clearAll = () => {
		onChangeFilterGroup({
			...filterGroup,
			conditions: [],
		});
	};

	const activeCount = filterGroup.conditions.length;

	return (
		<div className="bg-muted/20 p-4 rounded-xl border space-y-4 mb-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Filter className="h-4 w-4 text-primary" />
					<h3 className="text-sm font-semibold">高度なフィルタ</h3>
					{activeCount > 0 && (
						<span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-medium">
							{activeCount} 条件適用中
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					{activeCount > 0 && (
						<Button
							variant="ghost"
							size="sm"
							onClick={clearAll}
							className="h-7 text-xs text-muted-foreground"
						>
							<X className="h-3 w-3 mr-1" /> 条件をクリア
						</Button>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={addCondition}
						className="h-7 text-xs"
					>
						<Plus className="h-3 w-3 mr-1" /> 条件を追加
					</Button>
				</div>
			</div>

			{activeCount === 0 ? (
				<p className="text-xs text-muted-foreground">
					条件が設定されていません。「条件を追加」ボタンから特定の列の条件を設定できます。
				</p>
			) : (
				<div className="space-y-3">
					<div className="flex items-center gap-2">
						<Label className="text-xs text-muted-foreground">結合条件:</Label>
						<Select
							value={filterGroup.combinator}
							onValueChange={(v: 'and' | 'or') =>
								onChangeFilterGroup({ ...filterGroup, combinator: v })
							}
						>
							<SelectTrigger className="w-[120px] h-7 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="and">すべての条件 (AND)</SelectItem>
								<SelectItem value="or">いずれかの条件 (OR)</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						{filterGroup.conditions.map((cond, idx) => {
							const col = columns.find((c) => c.id === cond.columnId);
							const colType = col?.type ?? 'text';
							const ops = OPERATORS_BY_TYPE[colType];
							const err = validateFilterCondition(cond);

							return (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: filter items mapped by index
									key={`cond-${idx}`}
									className="flex flex-col sm:flex-row items-start sm:items-center gap-2 bg-background p-2 rounded-lg border text-xs"
								>
									{/* 列選択 */}
									<Select
										value={cond.columnId}
										onValueChange={(v) => updateCondition(idx, { columnId: v })}
									>
										<SelectTrigger className="w-[140px] h-8">
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

									{/* 演算子選択 */}
									<Select
										value={cond.operator}
										onValueChange={(v: FilterOperator) =>
											updateCondition(idx, { operator: v })
										}
									>
										<SelectTrigger className="w-[140px] h-8">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{ops.map((op) => (
												<SelectItem key={op.value} value={op.value}>
													{op.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>

									{/* 値入力 */}
									{cond.operator !== 'empty' &&
										cond.operator !== 'notEmpty' && (
											<div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
												<Input
													type={
														colType === 'number'
															? 'number'
															: colType === 'date'
																? 'date'
																: 'text'
													}
													value={cond.value ?? ''}
													onChange={(e) =>
														updateCondition(idx, { value: e.target.value })
													}
													placeholder="値"
													className="h-8 flex-1"
												/>
												{(cond.operator === 'between' ||
													cond.operator === 'dateRange') && (
													<>
														<span>〜</span>
														<Input
															type={
																colType === 'number'
																	? 'number'
																	: colType === 'date'
																		? 'date'
																		: 'text'
															}
															value={cond.value2 ?? ''}
															onChange={(e) =>
																updateCondition(idx, { value2: e.target.value })
															}
															placeholder="終了値"
															className="h-8 flex-1"
														/>
													</>
												)}
											</div>
										)}

									{/* 削除ボタン */}
									<Button
										variant="ghost"
										size="sm"
										onClick={() => removeCondition(idx)}
										className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
									>
										<Trash2 className="h-4 w-4" />
									</Button>

									{err && (
										<span className="text-red-500 text-xs w-full">{err}</span>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
