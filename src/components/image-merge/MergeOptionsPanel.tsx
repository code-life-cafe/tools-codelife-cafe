// MergeOptionsPanel — 結合モード / 列数 / 余白 / 背景色 / セルサイズ方針 / 揃え / 出力形式・品質の設定UI

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
import type {
	FitPolicy,
	MergeMode,
	MergeOptions,
	OutputFormat,
} from '@/lib/tools/image-merge';

const MODE_LABELS: Record<MergeMode, string> = {
	vertical: '縦に連結',
	horizontal: '横に連結',
	grid: 'グリッド',
};

const FIT_LABELS: Record<FitPolicy, string> = {
	original: '原寸のまま',
	'fit-width': '幅をそろえる',
	'uniform-cell': '統一セル（はみ出さない）',
};

const ALIGN_LABELS: Record<MergeOptions['align'], string> = {
	start: '先頭ぞろえ',
	center: '中央ぞろえ',
	end: '末尾ぞろえ',
};

const FORMAT_LABELS: Record<OutputFormat, string> = {
	png: 'PNG（透過対応）',
	jpeg: 'JPEG',
	webp: 'WebP',
};

interface MergeOptionsPanelProps {
	options: MergeOptions;
	disabled?: boolean;
	onChange: (options: MergeOptions) => void;
}

export function MergeOptionsPanel({
	options,
	disabled = false,
	onChange,
}: MergeOptionsPanelProps) {
	const update = (patch: Partial<MergeOptions>) =>
		onChange({ ...options, ...patch });

	const isTransparent = options.background === 'transparent';
	const qualityDisabled = disabled || options.output === 'png';
	// PNG / WebP は透過を維持できる。JPEG は透過不可。
	const canBeTransparent = options.output !== 'jpeg';

	return (
		<div className="rounded-lg border border-border p-4 space-y-4">
			<p className="text-sm font-semibold">結合オプション</p>

			<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
				{/* 結合モード */}
				<div className="flex items-center gap-2">
					<Label className="text-sm text-muted-foreground">結合モード</Label>
					<Select
						value={options.mode}
						disabled={disabled}
						onValueChange={(value) => update({ mode: value as MergeMode })}
					>
						<SelectTrigger
							aria-label="結合モード"
							className="w-[140px] h-8 rounded-lg bg-background"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(['vertical', 'horizontal', 'grid'] as MergeMode[]).map((m) => (
								<SelectItem key={m} value={m}>
									{MODE_LABELS[m]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{/* グリッド列数 */}
				{options.mode === 'grid' && (
					<div className="flex items-center gap-2">
						<Label
							htmlFor="grid-columns"
							className="text-sm text-muted-foreground"
						>
							列数
						</Label>
						<Input
							id="grid-columns"
							type="number"
							min={1}
							max={20}
							value={options.columns}
							disabled={disabled}
							onChange={(e) =>
								update({
									columns: Math.max(
										1,
										Math.min(20, Number(e.target.value) || 1),
									),
								})
							}
							aria-label="グリッド列数"
							className="w-20 h-8"
						/>
					</div>
				)}

				{/* セルサイズ方針 */}
				<div className="flex items-center gap-2">
					<Label className="text-sm text-muted-foreground">
						セルサイズ方針
					</Label>
					<Select
						value={options.fit}
						disabled={disabled}
						onValueChange={(value) => update({ fit: value as FitPolicy })}
					>
						<SelectTrigger
							aria-label="セルサイズ方針"
							className="w-[200px] h-8 rounded-lg bg-background"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(['original', 'fit-width', 'uniform-cell'] as FitPolicy[]).map(
								(f) => (
									<SelectItem key={f} value={f}>
										{FIT_LABELS[f]}
									</SelectItem>
								),
							)}
						</SelectContent>
					</Select>
				</div>

				{/* 揃え */}
				<div className="flex items-center gap-2">
					<Label className="text-sm text-muted-foreground">揃え</Label>
					<Select
						value={options.align}
						disabled={disabled}
						onValueChange={(value) =>
							update({ align: value as MergeOptions['align'] })
						}
					>
						<SelectTrigger
							aria-label="揃え"
							className="w-[140px] h-8 rounded-lg bg-background"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(['start', 'center', 'end'] as MergeOptions['align'][]).map(
								(a) => (
									<SelectItem key={a} value={a}>
										{ALIGN_LABELS[a]}
									</SelectItem>
								),
							)}
						</SelectContent>
					</Select>
				</div>
			</div>

			{/* 余白・外周パディング */}
			<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
				<div className="flex items-center gap-2">
					<Label htmlFor="gap-input" className="text-sm text-muted-foreground">
						画像間の余白
					</Label>
					<Input
						id="gap-input"
						type="number"
						min={0}
						max={500}
						value={options.gap}
						disabled={disabled}
						onChange={(e) =>
							update({ gap: Math.max(0, Number(e.target.value) || 0) })
						}
						aria-label="画像間の余白(px)"
						className="w-24 h-8"
					/>
					<span className="text-xs text-muted-foreground">px</span>
				</div>
				<div className="flex items-center gap-2">
					<Label
						htmlFor="padding-input"
						className="text-sm text-muted-foreground"
					>
						外周パディング
					</Label>
					<Input
						id="padding-input"
						type="number"
						min={0}
						max={500}
						value={options.padding}
						disabled={disabled}
						onChange={(e) =>
							update({ padding: Math.max(0, Number(e.target.value) || 0) })
						}
						aria-label="外周パディング(px)"
						className="w-24 h-8"
					/>
					<span className="text-xs text-muted-foreground">px</span>
				</div>
			</div>

			{/* 背景色 */}
			<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
				<div className="flex items-center gap-2">
					<Label htmlFor="bg-color" className="text-sm text-muted-foreground">
						背景・余白の色
					</Label>
					<input
						id="bg-color"
						type="color"
						value={isTransparent ? '#ffffff' : options.background}
						disabled={disabled || isTransparent}
						onChange={(e) => update({ background: e.target.value })}
						aria-label="背景色"
						className="h-8 w-12 rounded border border-border bg-background cursor-pointer disabled:opacity-50"
					/>
				</div>
				{canBeTransparent && (
					<div className="flex items-center gap-2">
						<Switch
							id="use-transparent"
							checked={isTransparent}
							disabled={disabled}
							onCheckedChange={(v) =>
								update({ background: v ? 'transparent' : '#ffffff' })
							}
						/>
						<Label
							htmlFor="use-transparent"
							className="text-sm cursor-pointer text-muted-foreground"
						>
							背景を透過にする
						</Label>
					</div>
				)}
			</div>

			{/* 出力形式・品質 */}
			<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
				<div className="flex items-center gap-2">
					<Label className="text-sm text-muted-foreground">出力形式</Label>
					<Select
						value={options.output}
						disabled={disabled}
						onValueChange={(value) => {
							const output = value as OutputFormat;
							// JPEG は透過不可。切り替え時に透過指定を白背景へ戻す。
							update({
								output,
								background:
									output === 'jpeg' && options.background === 'transparent'
										? '#ffffff'
										: options.background,
							});
						}}
					>
						<SelectTrigger
							aria-label="出力形式"
							className="w-[160px] h-8 rounded-lg bg-background"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(['png', 'jpeg', 'webp'] as OutputFormat[]).map((f) => (
								<SelectItem key={f} value={f}>
									{FORMAT_LABELS[f]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex items-center gap-3">
					<Label
						htmlFor="quality-slider"
						className="shrink-0 text-sm text-muted-foreground w-24"
					>
						品質: {options.quality}%
					</Label>
					<Slider
						id="quality-slider"
						min={10}
						max={100}
						step={5}
						value={[options.quality]}
						disabled={qualityDisabled}
						onValueChange={([value]) => update({ quality: value })}
						className="max-w-[200px]"
					/>
					{options.output === 'png' && (
						<span className="text-xs text-muted-foreground">
							PNG は品質指定なし
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
