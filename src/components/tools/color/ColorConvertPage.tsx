import type * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	formatCmyk,
	formatHex,
	formatHsl,
	formatRgb,
	parseColor,
	rgbToCmyk,
	rgbToHsl,
} from '@/lib/tools/color';

// --- 市松模様 CSS（透過カラーのプレビュー背景） ---
const checkerboardStyle: React.CSSProperties = {
	backgroundImage: `
		linear-gradient(45deg, var(--muted) 25%, transparent 25%),
		linear-gradient(-45deg, var(--muted) 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, var(--muted) 75%),
		linear-gradient(-45deg, transparent 75%, var(--muted) 75%)
	`,
	backgroundSize: '20px 20px',
	backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
};

const DEFAULT_INPUT = '#1E90FF';

export function ColorConvertPage() {
	const [input, setInput] = useState(DEFAULT_INPUT);

	const parsed = useMemo(() => parseColor(input), [input]);

	const results = useMemo(() => {
		if (!parsed) return null;
		const { rgb } = parsed;
		return {
			hex: formatHex(rgb),
			rgb: formatRgb(rgb),
			hsl: formatHsl(rgbToHsl(rgb)),
			cmyk: formatCmyk(rgbToCmyk(rgb)),
		};
	}, [parsed]);

	// ピッカーは alpha を扱えないため、6桁HEXのみを反映する
	const pickerValue = parsed ? formatHex(parsed.rgb).slice(0, 7) : '#000000';

	const handlePickerChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			setInput(e.target.value);
		},
		[],
	);

	const previewStyle: React.CSSProperties | undefined = parsed
		? { backgroundColor: formatRgb(parsed.rgb) }
		: undefined;

	return (
		<div className="space-y-6">
			{/* 入力エリア */}
			<div className="space-y-2">
				<Label htmlFor="color-input">カラーコード入力</Label>
				<div className="flex items-center gap-3">
					<Input
						id="color-input"
						type="text"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="#1E90FF, rgb(30, 144, 255), hsl(208, 100%, 56%), cmyk(88%, 44%, 0%, 0%)"
						className="font-mono"
						aria-label="カラーコード入力"
					/>
					<input
						type="color"
						value={pickerValue}
						onChange={handlePickerChange}
						className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
						aria-label="カラーピッカー"
					/>
				</div>
				<p className="text-xs text-muted-foreground">
					対応形式: HEX（#1e90ff / #fff / #fff8）/ rgb() / rgba() / hsl() /
					hsla() / cmyk()
				</p>
			</div>

			{/* プレビュー */}
			<div className="space-y-2">
				<span className="text-sm font-semibold">プレビュー</span>
				<div
					className="h-32 w-full rounded-xl border border-border overflow-hidden"
					style={checkerboardStyle}
					data-testid="color-preview-checkerboard"
				>
					<div
						className="h-full w-full"
						style={previewStyle}
						data-testid="color-preview"
					/>
				</div>
			</div>

			{/* 変換結果 / エラー */}
			{results ? (
				<div className="space-y-2" data-testid="color-results">
					<ResultRow
						label="HEX"
						value={results.hex}
						testId="color-result-hex"
					/>
					<ResultRow
						label="RGB"
						value={results.rgb}
						testId="color-result-rgb"
					/>
					<ResultRow
						label="HSL"
						value={results.hsl}
						testId="color-result-hsl"
					/>
					<ResultRow
						label="CMYK"
						value={results.cmyk}
						testId="color-result-cmyk"
					/>
				</div>
			) : (
				<div
					className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
					role="alert"
					data-testid="color-error"
				>
					<p className="font-medium">カラーコードを認識できません</p>
					<p className="mt-1 text-muted-foreground">
						例: #1E90FF, rgb(30, 144, 255), hsl(208, 100%, 56%), cmyk(88%, 44%,
						0%, 0%)
					</p>
				</div>
			)}
		</div>
	);
}

function ResultRow({
	label,
	value,
	testId,
}: {
	label: string;
	value: string;
	testId: string;
}) {
	return (
		<div
			className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
			data-testid={testId}
		>
			<div className="flex items-center gap-3 min-w-0">
				<span className="w-14 shrink-0 text-sm font-semibold text-muted-foreground">
					{label}
				</span>
				<span className="truncate font-mono text-sm">{value}</span>
			</div>
			<CopyButton text={value} size="sm" />
		</div>
	);
}
