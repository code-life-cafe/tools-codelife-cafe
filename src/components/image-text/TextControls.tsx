// TextControls — 選択中レイヤーの編集フォーム
// テキスト・サイズ・フォント・色・縁取り・背景ボックス・不透明度

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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
	FONT_FAMILIES,
	FONT_SIZE,
	type FontFamily,
	OPACITY,
	STROKE_WIDTH,
	type TextLayer,
} from '@/lib/tools/image-text';

type TextControlsProps = {
	layer: TextLayer;
	onChange: (patch: Partial<TextLayer>) => void;
};

export function TextControls({ layer, onChange }: TextControlsProps) {
	return (
		<div className="space-y-4 rounded-xl border border-border p-4">
			<h2 className="text-sm font-semibold">テキスト設定</h2>

			<div className="space-y-1.5">
				<Label htmlFor="layer-text" className="text-xs">
					テキスト（複数行可）
				</Label>
				<Textarea
					id="layer-text"
					value={layer.text}
					rows={2}
					onChange={(e) => onChange({ text: e.target.value })}
				/>
			</div>

			<div className="space-y-1.5">
				<Label htmlFor="layer-font-size" className="text-xs">
					フォントサイズ: {layer.fontSize}px
				</Label>
				<div className="flex items-center gap-3">
					<Slider
						min={FONT_SIZE.min}
						max={FONT_SIZE.max}
						step={1}
						value={[layer.fontSize]}
						onValueChange={([value]) => onChange({ fontSize: value })}
					/>
					<Input
						id="layer-font-size"
						type="number"
						className="w-20"
						min={FONT_SIZE.min}
						max={FONT_SIZE.max}
						value={layer.fontSize}
						onChange={(e) => {
							const value = Number(e.target.value);
							if (Number.isFinite(value)) {
								onChange({
									fontSize: Math.min(
										FONT_SIZE.max,
										Math.max(FONT_SIZE.min, value),
									),
								});
							}
						}}
					/>
				</div>
			</div>

			<div className="flex flex-wrap items-end gap-4">
				<div className="space-y-1.5">
					<Label htmlFor="layer-font-family" className="text-xs">
						フォント
					</Label>
					<Select
						value={layer.fontFamily}
						onValueChange={(value) =>
							onChange({ fontFamily: value as FontFamily })
						}
					>
						<SelectTrigger id="layer-font-family" className="w-32">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{FONT_FAMILIES.map((font) => (
								<SelectItem key={font.value} value={font.value}>
									{font.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="layer-color" className="text-xs">
						文字色
					</Label>
					<input
						id="layer-color"
						type="color"
						value={layer.color}
						className="block h-9 w-14 cursor-pointer rounded-md border border-border bg-transparent p-1"
						onChange={(e) => onChange({ color: e.target.value })}
					/>
				</div>
			</div>

			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<Switch
						id="layer-stroke"
						checked={layer.strokeColor !== undefined}
						onCheckedChange={(checked) =>
							onChange(
								checked
									? { strokeColor: '#ffffff', strokeWidth: 2 }
									: { strokeColor: undefined, strokeWidth: 0 },
							)
						}
					/>
					<Label htmlFor="layer-stroke" className="text-xs">
						縁取り
					</Label>
				</div>
				{layer.strokeColor !== undefined && (
					<div className="flex items-end gap-4 pl-8">
						<div className="space-y-1.5">
							<Label htmlFor="layer-stroke-color" className="text-xs">
								縁取り色
							</Label>
							<input
								id="layer-stroke-color"
								type="color"
								value={layer.strokeColor}
								className="block h-9 w-14 cursor-pointer rounded-md border border-border bg-transparent p-1"
								onChange={(e) => onChange({ strokeColor: e.target.value })}
							/>
						</div>
						<div className="w-36 space-y-1.5">
							<Label className="text-xs">太さ: {layer.strokeWidth}px</Label>
							<Slider
								min={STROKE_WIDTH.min}
								max={STROKE_WIDTH.max}
								step={1}
								value={[layer.strokeWidth]}
								onValueChange={([value]) => onChange({ strokeWidth: value })}
							/>
						</div>
					</div>
				)}
			</div>

			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<Switch
						id="layer-bg"
						checked={layer.backgroundColor !== undefined}
						onCheckedChange={(checked) =>
							onChange({
								backgroundColor: checked ? '#ffffff' : undefined,
							})
						}
					/>
					<Label htmlFor="layer-bg" className="text-xs">
						背景ボックス
					</Label>
				</div>
				{layer.backgroundColor !== undefined && (
					<div className="space-y-1.5 pl-8">
						<Label htmlFor="layer-bg-color" className="text-xs">
							背景色
						</Label>
						<input
							id="layer-bg-color"
							type="color"
							value={layer.backgroundColor}
							className="block h-9 w-14 cursor-pointer rounded-md border border-border bg-transparent p-1"
							onChange={(e) => onChange({ backgroundColor: e.target.value })}
						/>
					</div>
				)}
			</div>

			<div className="space-y-1.5">
				<Label className="text-xs">
					不透明度: {Math.round(layer.opacity * 100)}%
				</Label>
				<Slider
					min={OPACITY.min}
					max={OPACITY.max}
					step={0.05}
					value={[layer.opacity]}
					onValueChange={([value]) => onChange({ opacity: value })}
				/>
			</div>
		</div>
	);
}
