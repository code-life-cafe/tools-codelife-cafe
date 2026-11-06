// RegionKeyboardPanel — キーボードだけで範囲を追加・選択・削除するための操作パネル（#633）
// canvas のドラッグ操作と同じ onAddRegion / onSelectRegion / onDeleteRegion を使う。
// 座標は元画像 px。入力値は画面内の state だけに保持し、保存・送信しない

import { Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	defaultRegionInput,
	describeRegion,
	type MaskRegion,
	parseRegionInput,
	type Rect,
	type RegionInput,
} from '@/lib/tools/image-mosaic';

type RegionKeyboardPanelProps = {
	imageWidth: number;
	imageHeight: number;
	regions: MaskRegion[];
	selectedId: string | null;
	/** 追加した領域の id。追加できなかった場合は null */
	onAddRegion: (rect: Rect) => string | null;
	onSelectRegion: (id: string | null) => void;
	onDeleteRegion: (id: string) => void;
	onError: (message: string) => void;
};

const FIELDS: { key: keyof RegionInput; label: string }[] = [
	{ key: 'x', label: 'X（左端）' },
	{ key: 'y', label: 'Y（上端）' },
	{ key: 'width', label: '幅' },
	{ key: 'height', label: '高さ' },
];

export function RegionKeyboardPanel({
	imageWidth,
	imageHeight,
	regions,
	selectedId,
	onAddRegion,
	onSelectRegion,
	onDeleteRegion,
	onError,
}: RegionKeyboardPanelProps) {
	const idPrefix = useId();
	const [input, setInput] = useState<RegionInput>(() =>
		defaultRegionInput(imageWidth, imageHeight),
	);
	const [status, setStatus] = useState('');

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const result = parseRegionInput(input, imageWidth, imageHeight);
		if (!result.ok) {
			onError(result.message);
			return;
		}
		const id = onAddRegion(result.rect);
		if (id === null) return;
		onSelectRegion(id);
		setStatus(`範囲${regions.length + 1}を追加して選択しました`);
	};

	return (
		<details className="rounded-xl border border-border p-4">
			<summary className="cursor-pointer text-sm font-medium">
				キーボードで範囲を指定・選択する
			</summary>
			<div className="mt-3 space-y-4">
				<form onSubmit={handleSubmit} className="space-y-3">
					<p className="text-xs text-muted-foreground">
						元画像の左上を原点としたピクセル値（画像サイズ {imageWidth}×
						{imageHeight}
						px）で指定します。画像からはみ出す部分は画像内に収めます。
					</p>
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						{FIELDS.map(({ key, label }) => {
							const fieldId = `${idPrefix}-${key}`;
							return (
								<div key={key} className="space-y-1">
									<Label htmlFor={fieldId} className="text-xs">
										{label}（px）
									</Label>
									<Input
										id={fieldId}
										type="number"
										inputMode="numeric"
										min={0}
										step={1}
										value={input[key]}
										onChange={(e) =>
											setInput((current) => ({
												...current,
												[key]: e.target.value,
											}))
										}
									/>
								</div>
							);
						})}
					</div>
					<Button type="submit" size="sm">
						<Plus className="h-4 w-4" />
						範囲を追加
					</Button>
				</form>

				<div className="space-y-2">
					<p className="text-xs font-medium" id={`${idPrefix}-list`}>
						追加した範囲（ボタンで選択／選択解除）
					</p>
					{regions.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							まだ範囲はありません。
						</p>
					) : (
						<ul className="space-y-1" aria-labelledby={`${idPrefix}-list`}>
							{regions.map((region, index) => {
								const label = describeRegion(region, index);
								const isSelected = region.id === selectedId;
								return (
									<li key={region.id} className="flex items-center gap-2">
										<Button
											type="button"
											variant={isSelected ? 'default' : 'outline'}
											size="sm"
											className="h-auto min-w-0 flex-1 justify-start whitespace-normal py-1.5 text-left"
											aria-pressed={isSelected}
											onClick={() =>
												onSelectRegion(isSelected ? null : region.id)
											}
										>
											{label}
										</Button>
										<Button
											type="button"
											variant="outline"
											size="sm"
											aria-label={`範囲${index + 1}を削除`}
											onClick={() => {
												onDeleteRegion(region.id);
												setStatus(`範囲${index + 1}を削除しました`);
											}}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</li>
								);
							})}
						</ul>
					)}
				</div>
				<p className="sr-only" aria-live="polite">
					{status}
				</p>
			</div>
		</details>
	);
}
