// MaskToolbar — モード切替・強度スライダー・undo/redo/リセット

import { Redo2, RotateCcw, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
	BLUR_RADIUS,
	type MaskMode,
	MOSAIC_BLOCK,
} from '@/lib/tools/image-mosaic';

type MaskToolbarProps = {
	mode: MaskMode;
	strength: number;
	onModeChange: (mode: MaskMode) => void;
	/** commit=false はドラッグ中（履歴に積まない）、true は確定 */
	onStrengthChange: (value: number, commit: boolean) => void;
	canUndo: boolean;
	canRedo: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onReset: () => void;
	/** 選択中の領域を編集している場合 true（ラベル表示に使用） */
	editingRegion: boolean;
};

export function MaskToolbar({
	mode,
	strength,
	onModeChange,
	onStrengthChange,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	onReset,
	editingRegion,
}: MaskToolbarProps) {
	const range = mode === 'mosaic' ? MOSAIC_BLOCK : BLUR_RADIUS;
	const strengthLabel = mode === 'mosaic' ? '粗さ' : '強さ';

	return (
		<div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border p-4">
			<Tabs
				value={mode}
				onValueChange={(value) => onModeChange(value as MaskMode)}
			>
				<TabsList>
					<TabsTrigger value="mosaic">モザイク</TabsTrigger>
					<TabsTrigger value="blur">ぼかし</TabsTrigger>
				</TabsList>
			</Tabs>
			<div className="flex min-w-44 flex-1 items-center gap-3">
				<Label
					htmlFor="mask-strength"
					className="shrink-0 text-xs text-muted-foreground"
				>
					{strengthLabel}: {strength}
					{editingRegion && '（選択領域）'}
				</Label>
				<Slider
					id="mask-strength"
					min={range.min}
					max={range.max}
					step={1}
					value={[strength]}
					onValueChange={([value]) => onStrengthChange(value, false)}
					onValueCommit={([value]) => onStrengthChange(value, true)}
				/>
			</div>
			<div className="flex items-center gap-1">
				<Button
					variant="outline"
					size="sm"
					onClick={onUndo}
					disabled={!canUndo}
					aria-label="元に戻す"
				>
					<Undo2 className="h-4 w-4" />
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={onRedo}
					disabled={!canRedo}
					aria-label="やり直す"
				>
					<Redo2 className="h-4 w-4" />
				</Button>
				<Button variant="outline" size="sm" onClick={onReset}>
					<RotateCcw className="h-4 w-4" />
					すべてリセット
				</Button>
			</div>
		</div>
	);
}
