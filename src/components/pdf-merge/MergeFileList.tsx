// MergeFileList — PDF結合の入力ファイル一覧
// 上下移動ボタンとドラッグで並べ替え、行ごとの削除に対応する。
// 暗号化PDF・破損ファイルは行内に日本語エラーを表示し、結合対象から除外される。

import {
	ArrowDown,
	ArrowUp,
	FileText,
	GripVertical,
	Image as ImageIcon,
	Loader2,
	Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export type MergeItem = {
	id: string;
	file: File;
	kind: 'pdf' | 'image';
	mime: 'application/pdf' | 'image/jpeg' | 'image/png';
	status: 'loading' | 'ready' | 'error';
	pageCount?: number; // PDFのみ（読み込み後に表示）
	error?: string;
};

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

type Props = {
	items: MergeItem[];
	disabled: boolean;
	onMove: (id: string, direction: -1 | 1) => void;
	onReorder: (fromIndex: number, toIndex: number) => void;
	onRemove: (id: string) => void;
};

export function MergeFileList({
	items,
	disabled,
	onMove,
	onReorder,
	onRemove,
}: Props) {
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dropIndex, setDropIndex] = useState<number | null>(null);

	return (
		<ul className="space-y-2" data-testid="merge-file-list">
			{items.map((item, index) => (
				<li
					key={item.id}
					draggable={!disabled}
					onDragStart={() => setDragIndex(index)}
					onDragOver={(e) => {
						e.preventDefault();
						if (dragIndex !== null && dragIndex !== index) setDropIndex(index);
					}}
					onDragLeave={() => setDropIndex(null)}
					onDrop={(e) => {
						e.preventDefault();
						if (dragIndex !== null && dragIndex !== index) {
							onReorder(dragIndex, index);
						}
						setDragIndex(null);
						setDropIndex(null);
					}}
					onDragEnd={() => {
						setDragIndex(null);
						setDropIndex(null);
					}}
					className={`flex items-center gap-2 rounded-lg border bg-card p-2 sm:p-3 ${
						dropIndex === index ? 'border-primary' : 'border-border'
					} ${item.status === 'error' ? 'border-destructive/50 bg-destructive/5' : ''}`}
					data-testid="merge-file-row"
				>
					<GripVertical
						className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground"
						aria-hidden="true"
					/>
					{item.kind === 'pdf' ? (
						<FileText
							className="h-5 w-5 shrink-0 text-primary"
							aria-label="PDF"
						/>
					) : (
						<ImageIcon
							className="h-5 w-5 shrink-0 text-accent-foreground"
							aria-label="画像"
						/>
					)}
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-medium" title={item.file.name}>
							{item.file.name}
						</p>
						<p className="text-xs text-muted-foreground">
							{formatBytes(item.file.size)}
							{item.status === 'loading' && (
								<span className="ml-2 inline-flex items-center gap-1">
									<Loader2 className="h-3 w-3 animate-spin" />
									読み込み中…
								</span>
							)}
							{item.status === 'ready' && item.pageCount !== undefined && (
								<span className="ml-2">{item.pageCount}ページ</span>
							)}
						</p>
						{item.status === 'error' && item.error && (
							<p className="mt-1 text-xs text-destructive" role="alert">
								{item.error}
							</p>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<Button
							variant="ghost"
							size="icon"
							onClick={() => onMove(item.id, -1)}
							disabled={disabled || index === 0}
							aria-label={`${item.file.name} を上へ移動`}
						>
							<ArrowUp className="h-4 w-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => onMove(item.id, 1)}
							disabled={disabled || index === items.length - 1}
							aria-label={`${item.file.name} を下へ移動`}
						>
							<ArrowDown className="h-4 w-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => onRemove(item.id)}
							disabled={disabled}
							aria-label={`${item.file.name} を削除`}
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					</div>
				</li>
			))}
		</ul>
	);
}
