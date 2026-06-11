// CompressOptionsPanel — 出力形式 / 品質 / リサイズ / 目標サイズ / 背景色の設定UI

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
import type { CompressFormat } from '@/lib/tools/image-compress';

export type ResizeKind =
	| 'none'
	| 'max-width'
	| 'max-height'
	| 'long-edge'
	| 'percent';

export type CompressUiOptions = {
	format: CompressFormat;
	quality: number; // 0–1
	resizeKind: ResizeKind;
	resizeValue: number; // px（percent のときは %）
	useTargetSize: boolean;
	targetKB: number;
	background: string;
};

export const DEFAULT_UI_OPTIONS: CompressUiOptions = {
	format: 'keep',
	quality: 0.8,
	resizeKind: 'none',
	resizeValue: 1920,
	useTargetSize: false,
	targetKB: 500,
	background: '#ffffff',
};

const FORMAT_LABELS: Record<CompressFormat, string> = {
	keep: '元の形式を維持',
	jpeg: 'JPEG',
	png: 'PNG',
	webp: 'WebP',
};

const RESIZE_LABELS: Record<ResizeKind, string> = {
	none: 'リサイズしない',
	'max-width': '最大幅を指定',
	'max-height': '最大高さを指定',
	'long-edge': '長辺を指定',
	percent: 'パーセント',
};

interface CompressOptionsPanelProps {
	options: CompressUiOptions;
	disabled?: boolean;
	onChange: (options: CompressUiOptions) => void;
}

export function CompressOptionsPanel({
	options,
	disabled = false,
	onChange,
}: CompressOptionsPanelProps) {
	const update = (patch: Partial<CompressUiOptions>) =>
		onChange({ ...options, ...patch });

	const isPng = options.format === 'png';
	// PNG はロスレスのため品質・目標サイズは無効
	const targetEnabled = options.useTargetSize && !isPng;
	const qualityDisabled = disabled || isPng || targetEnabled;
	const showBackground = options.format === 'jpeg';

	return (
		<div className="rounded-lg border border-border p-4 space-y-4">
			<p className="text-sm font-semibold">変換オプション</p>

			<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
				{/* 出力形式 */}
				<div className="flex items-center gap-2">
					<Label className="text-sm text-muted-foreground">出力形式</Label>
					<Select
						value={options.format}
						disabled={disabled}
						onValueChange={(value) => {
							const format = value as CompressFormat;
							// PNG に切り替えたら目標サイズ指定は無効化する
							update({
								format,
								useTargetSize: format === 'png' ? false : options.useTargetSize,
							});
						}}
					>
						<SelectTrigger
							aria-label="出力形式"
							className="w-[150px] h-8 rounded-lg bg-background"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(['keep', 'jpeg', 'png', 'webp'] as CompressFormat[]).map(
								(f) => (
									<SelectItem key={f} value={f}>
										{FORMAT_LABELS[f]}
									</SelectItem>
								),
							)}
						</SelectContent>
					</Select>
				</div>

				{/* リサイズ */}
				<div className="flex items-center gap-2">
					<Label className="text-sm text-muted-foreground">リサイズ</Label>
					<Select
						value={options.resizeKind}
						disabled={disabled}
						onValueChange={(value) =>
							update({ resizeKind: value as ResizeKind })
						}
					>
						<SelectTrigger
							aria-label="リサイズ"
							className="w-[150px] h-8 rounded-lg bg-background"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(
								[
									'none',
									'max-width',
									'max-height',
									'long-edge',
									'percent',
								] as ResizeKind[]
							).map((k) => (
								<SelectItem key={k} value={k}>
									{RESIZE_LABELS[k]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{options.resizeKind !== 'none' && (
						<div className="flex items-center gap-1">
							<Input
								type="number"
								min={1}
								value={options.resizeValue}
								disabled={disabled}
								onChange={(e) =>
									update({
										resizeValue: Math.max(1, Number(e.target.value) || 1),
									})
								}
								aria-label="リサイズ値"
								className="w-24 h-8"
							/>
							<span className="text-xs text-muted-foreground">
								{options.resizeKind === 'percent' ? '%' : 'px'}
							</span>
						</div>
					)}
				</div>
			</div>

			{/* 品質スライダー */}
			<div className="flex items-center gap-3">
				<Label
					htmlFor="quality-slider"
					className="shrink-0 text-sm text-muted-foreground w-28"
				>
					品質: {Math.round(options.quality * 100)}%
				</Label>
				<Slider
					id="quality-slider"
					min={0.1}
					max={1}
					step={0.05}
					value={[options.quality]}
					disabled={qualityDisabled}
					onValueChange={([value]) => update({ quality: value })}
					className="max-w-xs"
				/>
				{isPng && (
					<span className="text-xs text-muted-foreground">
						PNG は品質指定なし
					</span>
				)}
			</div>

			{/* 目標サイズ */}
			<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
				<div className="flex items-center gap-2">
					<Switch
						id="use-target-size"
						checked={targetEnabled}
						disabled={disabled || isPng}
						onCheckedChange={(v) => update({ useTargetSize: v })}
					/>
					<Label htmlFor="use-target-size" className="text-sm cursor-pointer">
						目標ファイルサイズを指定
					</Label>
				</div>
				{targetEnabled && (
					<div className="flex items-center gap-1">
						<Input
							type="number"
							min={1}
							value={options.targetKB}
							disabled={disabled}
							onChange={(e) =>
								update({ targetKB: Math.max(1, Number(e.target.value) || 1) })
							}
							aria-label="目標サイズ(KB)"
							className="w-24 h-8"
						/>
						<span className="text-xs text-muted-foreground">KB 以下</span>
					</div>
				)}
				{isPng && (
					<span className="text-xs text-muted-foreground">
						目標サイズ指定は JPEG / WebP のみ対応
					</span>
				)}
			</div>

			{/* 背景色（JPEG出力時のみ） */}
			{showBackground && (
				<div className="flex items-center gap-2">
					<Label htmlFor="bg-color" className="text-sm text-muted-foreground">
						背景色（透過→JPEG変換時）
					</Label>
					<input
						id="bg-color"
						type="color"
						value={options.background}
						disabled={disabled}
						onChange={(e) => update({ background: e.target.value })}
						aria-label="背景色"
						className="h-8 w-12 rounded border border-border bg-background cursor-pointer disabled:opacity-50"
					/>
				</div>
			)}
		</div>
	);
}
