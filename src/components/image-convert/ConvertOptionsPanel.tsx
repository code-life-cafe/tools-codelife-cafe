// ConvertOptionsPanel — 出力形式 / 品質 / EXIF / 背景色の設定UI

import { AlertTriangle } from 'lucide-react';
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
import {
	type ConvertOptions,
	DEFAULT_BACKGROUND,
	DEFAULT_QUALITY,
	type TargetFormat,
} from '@/lib/tools/image-convert';

// UIオプションはコアの ConvertOptions と同一構造を用いる
export type ConvertUiOptions = ConvertOptions;

export const DEFAULT_UI_OPTIONS: ConvertUiOptions = {
	target: 'jpeg',
	quality: DEFAULT_QUALITY,
	exif: 'strip',
	background: DEFAULT_BACKGROUND,
};

const FORMAT_LABELS: Record<TargetFormat, string> = {
	jpeg: 'JPEG',
	png: 'PNG',
	webp: 'WebP',
	avif: 'AVIF',
};

interface ConvertOptionsPanelProps {
	options: ConvertUiOptions;
	disabled?: boolean;
	onChange: (options: ConvertUiOptions) => void;
}

export function ConvertOptionsPanel({
	options,
	disabled = false,
	onChange,
}: ConvertOptionsPanelProps) {
	const update = (patch: Partial<ConvertUiOptions>) =>
		onChange({ ...options, ...patch });

	const isPng = options.target === 'png';
	const showQuality = !isPng; // PNG はロスレスのため品質指定なし
	const showBackground = options.target === 'jpeg';
	const keepWarning = options.exif === 'keep' && options.target !== 'jpeg';

	return (
		<div className="rounded-lg border border-border p-4 space-y-4">
			<p className="text-sm font-semibold">変換オプション</p>

			<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
				{/* 出力形式 */}
				<div className="flex items-center gap-2">
					<Label className="text-sm text-muted-foreground">出力形式</Label>
					<Select
						value={options.target}
						disabled={disabled}
						onValueChange={(value) => update({ target: value as TargetFormat })}
					>
						<SelectTrigger
							aria-label="出力形式"
							className="w-[150px] h-8 rounded-lg bg-background"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(['jpeg', 'png', 'webp', 'avif'] as TargetFormat[]).map((f) => (
								<SelectItem key={f} value={f}>
									{FORMAT_LABELS[f]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{options.target === 'avif' && (
						<span className="text-xs text-muted-foreground">
							AVIF出力は処理に時間がかかります
						</span>
					)}
				</div>

				{/* EXIF（メタデータ）の保持/削除 */}
				<div className="flex items-center gap-2">
					<Switch
						id="exif-keep"
						checked={options.exif === 'keep'}
						disabled={disabled}
						onCheckedChange={(v) => update({ exif: v ? 'keep' : 'strip' })}
					/>
					<Label htmlFor="exif-keep" className="text-sm cursor-pointer">
						EXIF（撮影日時・位置情報など）を保持
					</Label>
				</div>
			</div>

			{/* 品質スライダー（JPEG / WebP / AVIF） */}
			{showQuality ? (
				<div className="flex items-center gap-3">
					<Label
						htmlFor="quality-slider"
						className="shrink-0 text-sm text-muted-foreground w-28"
					>
						品質: {options.quality}%
					</Label>
					<Slider
						id="quality-slider"
						min={10}
						max={100}
						step={5}
						value={[options.quality]}
						disabled={disabled}
						onValueChange={([value]) => update({ quality: value })}
						className="max-w-xs"
					/>
				</div>
			) : (
				<p className="text-xs text-muted-foreground">
					PNG はロスレス形式のため品質指定はありません。
				</p>
			)}

			{/* 背景色（JPEG出力時のみ・透過の合成色） */}
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

			{/* EXIF保持の注意（非JPEG出力時） */}
			{keepWarning && (
				<p
					className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500"
					role="alert"
				>
					<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
					EXIF保持はJPEG出力でのみ確実です。この形式ではメタデータは削除されます。
				</p>
			)}
		</div>
	);
}
