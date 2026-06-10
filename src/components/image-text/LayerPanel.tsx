// LayerPanel — テキストレイヤーの一覧と操作（追加・複製・削除・並べ替え）

import { ChevronDown, ChevronUp, Copy, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TextLayer } from '@/lib/tools/image-text';

type LayerPanelProps = {
	layers: TextLayer[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	onAdd: () => void;
	onDuplicate: (id: string) => void;
	onDelete: (id: string) => void;
	onMove: (id: string, direction: 'up' | 'down') => void;
};

export function LayerPanel({
	layers,
	selectedId,
	onSelect,
	onAdd,
	onDuplicate,
	onDelete,
	onMove,
}: LayerPanelProps) {
	return (
		<div className="space-y-2 rounded-xl border border-border p-4">
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold">レイヤー</h2>
				<Button size="sm" onClick={onAdd}>
					<Plus className="h-4 w-4" />
					テキストを追加
				</Button>
			</div>
			{layers.length === 0 ? (
				<p className="py-2 text-xs text-muted-foreground">
					「テキストを追加」を押すと画像中央にテキストが配置されます。
				</p>
			) : (
				<ul className="space-y-1">
					{layers.map((layer, index) => {
						const isSelected = layer.id === selectedId;
						return (
							<li
								key={layer.id}
								className={`flex items-center gap-1 rounded-lg border p-2 ${
									isSelected
										? 'border-primary bg-primary/5'
										: 'border-transparent hover:bg-muted/50'
								}`}
							>
								<button
									type="button"
									className="min-w-0 flex-1 truncate text-left text-sm"
									onClick={() => onSelect(layer.id)}
								>
									{layer.text.split('\n')[0] || '（空のテキスト）'}
								</button>
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7"
									aria-label="上へ移動"
									disabled={index === 0}
									onClick={() => onMove(layer.id, 'up')}
								>
									<ChevronUp className="h-4 w-4" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7"
									aria-label="下へ移動"
									disabled={index === layers.length - 1}
									onClick={() => onMove(layer.id, 'down')}
								>
									<ChevronDown className="h-4 w-4" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7"
									aria-label="レイヤーを複製"
									onClick={() => onDuplicate(layer.id)}
								>
									<Copy className="h-4 w-4" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7 text-destructive"
									aria-label="レイヤーを削除"
									onClick={() => onDelete(layer.id)}
								>
									<Trash2 className="h-4 w-4" />
								</Button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
