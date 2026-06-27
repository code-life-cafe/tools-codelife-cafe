// EditToolbar — 回転・反転・アスペクト比プリセット・出力設定

import {
	FlipHorizontal2,
	FlipVertical2,
	RotateCcw,
	RotateCw,
} from 'lucide-react';
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
import { Slider } from '@/components/ui/slider';
import { Toggle } from '@/components/ui/toggle';
import type { EditOps, OutputFormat } from '@/lib/tools/image-edit';

export type AspectPreset =
	| 'free'
	| '1:1'
	| '4:3'
	| '16:9'
	| '3:4'
	| '9:16'
	| '3:2'
	| '2:3';

const ASPECT_LABELS: Record<AspectPreset, string> = {
	free: '自由',
	'1:1': '1:1（正方形）',
	'4:3': '4:3（横）',
	'16:9': '16:9（横）',
	'3:4': '3:4（縦）',
	'9:16': '9:16（縦）',
	'3:2': '3:2（横）',
	'2:3': '2:3（縦）',
};

export function aspectPresetToRatio(preset: AspectPreset): number | null {
	switch (preset) {
		case 'free':
			return null;
		case '1:1':
			return 1;
		case '4:3':
			return 4 / 3;
		case '16:9':
			return 16 / 9;
		case '3:4':
			return 3 / 4;
		case '9:16':
			return 9 / 16;
		case '3:2':
			return 3 / 2;
		case '2:3':
			return 2 / 3;
	}
}

const FORMAT_LABELS: Record<OutputFormat, string> = {
	png: 'PNG',
	jpeg: 'JPEG',
	webp: 'WebP',
};

interface EditToolbarProps {
	editOps: EditOps;
	aspectPreset: AspectPreset;
	isBatch: boolean;
	onChange: (ops: EditOps) => void;
	onAspectChange: (preset: AspectPreset) => void;
}

export function EditToolbar({
	editOps,
	aspectPreset,
	isBatch,
	onChange,
	onAspectChange,
}: EditToolbarProps) {
	const showQuality = editOps.output !== 'png';

	return (
		<div className="space-y-4">
			{/* クロップ比率 */}
			<div className="space-y-1.5">
				<Label>アスペクト比</Label>
				<Select
					value={aspectPreset}
					onValueChange={(v) => onAspectChange(v as AspectPreset)}
				>
					<SelectTrigger aria-label="アスペクト比">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{Object.entries(ASPECT_LABELS).map(([key, label]) => (
							<SelectItem key={key} value={key}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{isBatch && aspectPreset !== 'free' && (
					<p className="text-xs text-muted-foreground">
						中央基準で最大切り抜きを適用します
					</p>
				)}
			</div>

			{/* 回転 */}
			<div className="space-y-1.5">
				<Label>回転</Label>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						aria-label="左に90°回転"
						onClick={() =>
							onChange({
								...editOps,
								rotateDeg: (editOps.rotateDeg - 90) % 360,
							})
						}
					>
						<RotateCcw className="size-4" />
					</Button>
					<Button
						variant="outline"
						size="sm"
						aria-label="右に90°回転"
						onClick={() =>
							onChange({
								...editOps,
								rotateDeg: (editOps.rotateDeg + 90) % 360,
							})
						}
					>
						<RotateCw className="size-4" />
					</Button>
					<span className="min-w-12 text-center text-sm tabular-nums">
						{editOps.rotateDeg}°
					</span>
					{editOps.rotateDeg !== 0 && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onChange({ ...editOps, rotateDeg: 0 })}
						>
							リセット
						</Button>
					)}
				</div>
				<Slider
					aria-label="回転角度"
					min={-180}
					max={180}
					step={1}
					value={[editOps.rotateDeg]}
					onValueChange={([v]) => onChange({ ...editOps, rotateDeg: v })}
				/>
			</div>

			{/* 反転 */}
			<div className="space-y-1.5">
				<Label>反転</Label>
				<div className="flex items-center gap-2">
					<Toggle
						variant="outline"
						size="sm"
						aria-label="水平反転"
						pressed={editOps.flip.horizontal}
						onPressedChange={(pressed) =>
							onChange({
								...editOps,
								flip: { ...editOps.flip, horizontal: pressed },
							})
						}
					>
						<FlipHorizontal2 className="size-4" />
						<span className="text-xs">水平</span>
					</Toggle>
					<Toggle
						variant="outline"
						size="sm"
						aria-label="垂直反転"
						pressed={editOps.flip.vertical}
						onPressedChange={(pressed) =>
							onChange({
								...editOps,
								flip: { ...editOps.flip, vertical: pressed },
							})
						}
					>
						<FlipVertical2 className="size-4" />
						<span className="text-xs">垂直</span>
					</Toggle>
				</div>
			</div>

			{/* 出力形式 */}
			<div className="space-y-1.5">
				<Label>出力形式</Label>
				<Select
					value={editOps.output}
					onValueChange={(v) =>
						onChange({ ...editOps, output: v as OutputFormat })
					}
				>
					<SelectTrigger aria-label="出力形式">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{Object.entries(FORMAT_LABELS).map(([key, label]) => (
							<SelectItem key={key} value={key}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* 品質（PNG以外） */}
			{showQuality && (
				<div className="space-y-1.5">
					<Label>品質: {editOps.quality}%</Label>
					<Slider
						aria-label="品質"
						min={1}
						max={100}
						step={1}
						value={[editOps.quality]}
						onValueChange={([v]) => onChange({ ...editOps, quality: v })}
					/>
				</div>
			)}

			{/* 背景色 */}
			{editOps.rotateDeg % 90 !== 0 && (
				<div className="space-y-1.5">
					<Label>背景色（余白）</Label>
					<Input
						type="color"
						value={editOps.background}
						onChange={(e) =>
							onChange({ ...editOps, background: e.target.value })
						}
						className="h-9 w-16 cursor-pointer p-1"
						aria-label="背景色"
					/>
				</div>
			)}
		</div>
	);
}
