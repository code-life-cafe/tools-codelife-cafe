// FaviconOptionsPanel — fit / 背景 / アプリ名 / テーマカラー / 背景色 の設定UI
import type * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { FitMode } from '@/lib/tools/favicon';

export type FaviconUiOptions = {
	fit: FitMode;
	/** アイコン背景を透過にする（true のとき background は無視） */
	transparent: boolean;
	/** 透過OFF時のアイコン背景色（CSSカラー） */
	background: string;
	/** site.webmanifest の name */
	appName: string;
	/** PWA theme_color / theme-color メタ */
	themeColor: string;
	/** PWA background_color */
	backgroundColor: string;
};

export const DEFAULT_FAVICON_OPTIONS: FaviconUiOptions = {
	fit: 'contain',
	transparent: true,
	background: '#ffffff',
	appName: 'My App',
	themeColor: '#1e40af',
	backgroundColor: '#ffffff',
};

type Props = {
	options: FaviconUiOptions;
	disabled?: boolean;
	onChange: (next: FaviconUiOptions) => void;
};

export function FaviconOptionsPanel({ options, disabled, onChange }: Props) {
	const update = (patch: Partial<FaviconUiOptions>) =>
		onChange({ ...options, ...patch });

	return (
		<div className="space-y-5 rounded-xl border border-border p-4">
			{/* fit 切替 */}
			<div className="space-y-2">
				<Label>非正方形画像の収め方</Label>
				<Tabs
					value={options.fit}
					onValueChange={(value) => update({ fit: value as FitMode })}
				>
					<TabsList>
						<TabsTrigger value="contain" disabled={disabled}>
							余白をつける
						</TabsTrigger>
						<TabsTrigger value="cover" disabled={disabled}>
							中央をクロップ
						</TabsTrigger>
					</TabsList>
				</Tabs>
				<p className="text-xs text-muted-foreground">
					「余白」はアスペクト比を保ち背景色で余白を埋めます。「クロップ」は中央を正方形に切り抜きます。
				</p>
			</div>

			{/* 背景（透過 or 色） */}
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<Label htmlFor="favicon-transparent">アイコン背景を透過にする</Label>
					<Switch
						id="favicon-transparent"
						checked={options.transparent}
						disabled={disabled}
						onCheckedChange={(checked) => update({ transparent: checked })}
						aria-label="アイコン背景を透過にする"
					/>
				</div>
				{!options.transparent && (
					<ColorField
						label="アイコン背景色"
						value={options.background}
						disabled={disabled}
						onChange={(background) => update({ background })}
					/>
				)}
				<p className="text-xs text-muted-foreground">
					透過PNG/SVGの背景を保持します。JPEGなど透過のない画像や「余白」の余白部分はここで指定した色で塗られます。
				</p>
			</div>

			{/* アプリ名 */}
			<div className="space-y-2">
				<Label htmlFor="favicon-appname">アプリ名（site.webmanifest）</Label>
				<Input
					id="favicon-appname"
					value={options.appName}
					disabled={disabled}
					maxLength={60}
					onChange={(e) => update({ appName: e.target.value })}
					placeholder="My App"
				/>
			</div>

			{/* テーマカラー / 背景色 */}
			<div className="grid gap-4 sm:grid-cols-2">
				<ColorField
					label="テーマカラー（theme_color）"
					value={options.themeColor}
					disabled={disabled}
					onChange={(themeColor) => update({ themeColor })}
				/>
				<ColorField
					label="背景色（background_color）"
					value={options.backgroundColor}
					disabled={disabled}
					onChange={(backgroundColor) => update({ backgroundColor })}
				/>
			</div>
		</div>
	);
}

function ColorField({
	label,
	value,
	disabled,
	onChange,
}: {
	label: string;
	value: string;
	disabled?: boolean;
	onChange: (value: string) => void;
}) {
	const handleText = (e: React.ChangeEvent<HTMLInputElement>) =>
		onChange(e.target.value);
	// ピッカーは6桁HEXのみ扱えるため、不正値のときは黒にフォールバック
	const pickerValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
	return (
		<div className="space-y-2">
			<Label>{label}</Label>
			<div className="flex items-center gap-2">
				<input
					type="color"
					value={pickerValue}
					disabled={disabled}
					onChange={handleText}
					className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
					aria-label={label}
				/>
				<Input
					value={value}
					disabled={disabled}
					onChange={handleText}
					className="font-mono"
					placeholder="#1e40af"
				/>
			</div>
		</div>
	);
}
