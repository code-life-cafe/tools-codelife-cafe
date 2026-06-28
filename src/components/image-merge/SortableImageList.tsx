// SortableImageList — 投入画像のサムネイル一覧。ドラッグ並び替え（デスクトップ）と
// 上下移動ボタン（タッチ・キーボード対応）の両方で順序を変更できる。

import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export type MergeImageItem = {
	id: string;
	file: File;
	previewUrl: string;
	width: number;
	height: number;
};

interface SortableImageListProps {
	items: MergeImageItem[];
	disabled?: boolean;
	onReorder: (from: number, to: number) => void;
	onRemove: (id: string) => void;
}

export function SortableImageList({
	items,
	disabled = false,
	onReorder,
	onRemove,
}: SortableImageListProps) {
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [overIndex, setOverIndex] = useState<number | null>(null);

	const handleDrop = (to: number) => {
		if (dragIndex !== null && dragIndex !== to) {
			onReorder(dragIndex, to);
		}
		setDragIndex(null);
		setOverIndex(null);
	};

	return (
		<ol
			className="flex flex-wrap gap-3"
			aria-label="結合する画像の一覧（順序を変更できます）"
			data-testid="merge-image-list"
		>
			{items.map((item, index) => (
				<li
					key={item.id}
					draggable={!disabled}
					onDragStart={() => setDragIndex(index)}
					onDragOver={(e) => {
						e.preventDefault();
						setOverIndex(index);
					}}
					onDrop={() => handleDrop(index)}
					onDragEnd={() => {
						setDragIndex(null);
						setOverIndex(null);
					}}
					className={[
						'relative flex w-28 flex-col rounded-lg border bg-card p-2 transition-colors',
						overIndex === index && dragIndex !== null
							? 'border-primary'
							: 'border-border',
						dragIndex === index ? 'opacity-50' : '',
						disabled ? '' : 'cursor-grab',
					]
						.filter(Boolean)
						.join(' ')}
					data-testid={`merge-image-item-${index}`}
				>
					<div className="flex items-center justify-between gap-1">
						<span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
							<GripVertical className="h-3 w-3" aria-hidden="true" />
							{index + 1}
						</span>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-5 w-5 shrink-0"
							disabled={disabled}
							onClick={() => onRemove(item.id)}
							aria-label={`${index + 1}枚目を削除`}
						>
							<X className="h-3 w-3" />
						</Button>
					</div>

					<img
						src={item.previewUrl}
						alt={`${index + 1}枚目: ${item.file.name}`}
						className="mt-1 h-20 w-full rounded object-contain"
					/>
					<span
						className="mt-1 truncate text-[10px] text-muted-foreground"
						title={item.file.name}
					>
						{item.file.name}
					</span>

					<div className="mt-1 flex justify-center gap-1">
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="h-6 w-6"
							disabled={disabled || index === 0}
							onClick={() => onReorder(index, index - 1)}
							aria-label={`${index + 1}枚目を前へ移動`}
						>
							<ArrowUp className="h-3 w-3" />
						</Button>
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="h-6 w-6"
							disabled={disabled || index === items.length - 1}
							onClick={() => onReorder(index, index + 1)}
							aria-label={`${index + 1}枚目を後ろへ移動`}
						>
							<ArrowDown className="h-3 w-3" />
						</Button>
					</div>
				</li>
			))}
		</ol>
	);
}
