// MaskToolbar — モード切替・強度スライダー・undo/redo/リセット

import { Redo2, RotateCcw, Undo2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
	BLUR_RADIUS,
	DEFAULT_EMOJI_STAMP,
	type MaskMode,
	type MaskShape,
	MOSAIC_BLOCK,
} from '@/lib/tools/image-mosaic';

type MaskToolbarProps = {
	mode: MaskMode;
	strength: number;
	shape: MaskShape;
	emoji: string;
	stampImageName: string | null;
	onModeChange: (mode: MaskMode) => void;
	onShapeChange: (shape: MaskShape) => void;
	onEmojiChange: (emoji: string) => void;
	onStampImageChange: (file: File) => void;
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
	shape,
	emoji,
	stampImageName,
	onModeChange,
	onShapeChange,
	onEmojiChange,
	onStampImageChange,
	onStrengthChange,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	onReset,
	editingRegion,
}: MaskToolbarProps) {
	const isMaskMode = mode === 'mosaic' || mode === 'blur';
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
					<TabsTrigger value="emoji">絵文字</TabsTrigger>
					<TabsTrigger value="image">画像スタンプ</TabsTrigger>
				</TabsList>
			</Tabs>
			{isMaskMode && (
				<Tabs
					value={shape}
					onValueChange={(value) => onShapeChange(value as MaskShape)}
				>
					<TabsList>
						<TabsTrigger value="rect">四角形</TabsTrigger>
						<TabsTrigger value="ellipse">円形</TabsTrigger>
					</TabsList>
				</Tabs>
			)}
			{isMaskMode && (
				<div className="flex min-w-44 flex-1 items-center gap-3">
					<Label
						id="mask-strength-label"
						className="shrink-0 text-xs text-muted-foreground"
					>
						{strengthLabel}: {strength}
						{editingRegion && '（選択領域）'}
					</Label>
					<Slider
						id="mask-strength"
						aria-labelledby="mask-strength-label"
						min={range.min}
						max={range.max}
						step={1}
						value={[strength]}
						onValueChange={([value]) => onStrengthChange(value, false)}
						onValueCommit={([value]) => onStrengthChange(value, true)}
					/>
				</div>
			)}
			{mode === 'emoji' && (
				<div className="flex min-w-44 flex-1 items-center gap-3">
					<Label
						htmlFor="emoji-stamp"
						className="shrink-0 text-xs text-muted-foreground"
					>
						絵文字
						{editingRegion && '（選択領域）'}
					</Label>
					<Input
						id="emoji-stamp"
						className="max-w-28 text-center text-lg"
						value={emoji}
						onChange={(e) =>
							onEmojiChange(e.target.value || DEFAULT_EMOJI_STAMP)
						}
						aria-label="絵文字スタンプ"
					/>
				</div>
			)}
			{mode === 'image' && (
				<div className="flex min-w-56 flex-1 items-center gap-3">
					<Label
						htmlFor="stamp-image"
						className="shrink-0 text-xs text-muted-foreground"
					>
						任意画像
					</Label>
					<Input
						id="stamp-image"
						type="file"
						accept="image/png,image/jpeg,image/webp"
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) onStampImageChange(file);
							e.currentTarget.value = '';
						}}
						aria-label="画像スタンプファイル"
					/>
					{stampImageName ? (
						<span className="max-w-36 truncate text-xs text-muted-foreground">
							{stampImageName}
						</span>
					) : (
						<span className="flex items-center gap-1 text-xs text-muted-foreground">
							<Upload className="h-3 w-3" />
							画像を選択
						</span>
					)}
				</div>
			)}
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
