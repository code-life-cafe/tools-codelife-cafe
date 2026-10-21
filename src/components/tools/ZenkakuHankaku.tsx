import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	type ConversionOptions,
	convert,
	type Direction,
} from '@/lib/tools/zenkaku-hankaku';
import { provideToolsFromFactory } from '@/lib/webmcp';
import { zenkakuHankakuTool } from '@/lib/webmcp/tools/zenkaku-hankaku.webmcp';

const PURPOSE_PRESETS: {
	label: string;
	direction: Direction;
	options: ConversionOptions;
}[] = [
	{
		label: '英数字を半角に',
		direction: 'toHankaku',
		options: { katakana: false, alpha: true, numbers: true, symbols: false },
	},
	{
		label: 'カナを全角に',
		direction: 'toZenkaku',
		options: { katakana: true, alpha: false, numbers: false, symbols: false },
	},
	{
		label: '4項目を半角に',
		direction: 'toHankaku',
		options: { katakana: true, alpha: true, numbers: true, symbols: true },
	},
];

export default function ZenkakuHankaku() {
	const { trackRunDebounced } = useToolAnalytics('zenkaku-hankaku');
	const [input, setInput] = useState('');
	const [direction, setDirection] = useState<Direction>('toHankaku');
	const [options, setOptions] = useState<ConversionOptions>({
		katakana: true,
		alpha: true,
		numbers: true,
		symbols: true,
	});

	// --- WebMCP Tool Registration ---
	useEffect(() => {
		return provideToolsFromFactory([zenkakuHankakuTool]);
	}, []);

	const output = input ? convert(input, direction, options) : '';

	// 非空の入力から変換結果が生成された時点で実行を計測（空入力・マウント時は発火しない）
	useEffect(() => {
		if (input) {
			trackRunDebounced();
		}
	}, [input, direction, options, trackRunDebounced]);

	const toggleOption = useCallback((key: keyof ConversionOptions) => {
		setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
	}, []);

	return (
		<div className="space-y-6">
			<fieldset className="min-w-0 rounded-xl border border-border p-4">
				<legend className="px-1 text-sm font-medium">用途から設定</legend>
				<p className="mb-3 text-sm text-muted-foreground">
					変換方向と対象項目をまとめて選べます。
				</p>
				<div className="flex flex-wrap gap-2">
					{PURPOSE_PRESETS.map((preset) => (
						<Button
							key={preset.label}
							type="button"
							variant="outline"
							size="sm"
							onClick={() => {
								setDirection(preset.direction);
								setOptions({ ...preset.options });
							}}
						>
							{preset.label}
						</Button>
					))}
				</div>
			</fieldset>
			{/* Controls */}
			<div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
				{/* Direction toggle */}
				<div className="flex items-center gap-3">
					<Label
						className={`text-sm font-medium whitespace-nowrap transition-colors ${direction === 'toHankaku' ? 'text-primary' : 'text-muted-foreground'}`}
					>
						全角 → 半角
					</Label>
					<Switch
						aria-label="半角から全角へ変換"
						checked={direction === 'toZenkaku'}
						onCheckedChange={(checked) =>
							setDirection(checked ? 'toZenkaku' : 'toHankaku')
						}
					/>
					<Label
						className={`text-sm font-medium whitespace-nowrap transition-colors ${direction === 'toZenkaku' ? 'text-primary' : 'text-muted-foreground'}`}
					>
						半角 → 全角
					</Label>
				</div>

				{/* Category checkboxes */}
				<div className="flex flex-wrap gap-4">
					{(
						[
							['katakana', 'カナ'],
							['alpha', '英字'],
							['numbers', '数字'],
							['symbols', '記号・スペース'],
						] as [keyof ConversionOptions, string][]
					).map(([key, label]) => (
						<div key={key} className="flex items-center gap-1.5">
							<Checkbox
								id={`opt-${key}`}
								checked={options[key]}
								aria-describedby={
									key === 'symbols' ? 'space-option-help' : undefined
								}
								onCheckedChange={() => toggleOption(key)}
							/>
							<Label htmlFor={`opt-${key}`} className="text-sm cursor-pointer">
								{label}
							</Label>
						</div>
					))}
				</div>
			</div>
			<p id="space-option-help" className="text-sm text-muted-foreground">
				全角・半角スペースは「記号・スペース」と一緒に変換します。タブ・改行はそのままです。
			</p>

			{/* Input Textarea */}
			<div>
				<Label
					htmlFor="zenkaku-input"
					className="text-sm font-medium mb-2 block"
				>
					入力テキスト
				</Label>
				<Textarea
					id="zenkaku-input"
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder="ＡＢＣ１２３カタカナ（全角）→ ABC123ｶﾀｶﾅ（半角）"
					className="min-h-[160px] font-mono-tool rounded-xl focus:ring-2 focus:ring-primary"
				/>
			</div>

			{/* Output Textarea */}
			<div>
				<div className="flex items-center justify-between mb-2">
					<Label htmlFor="zenkaku-output" className="text-sm font-medium">
						変換結果
					</Label>
					<div className="flex gap-2">
						<CopyButton text={output} />
						<Button
							variant="outline"
							size="sm"
							onClick={() => setInput('')}
							disabled={!input}
						>
							<Trash2 className="h-4 w-4 mr-1" />
							クリア
						</Button>
					</div>
				</div>
				<Textarea
					id="zenkaku-output"
					value={output}
					readOnly
					placeholder="変換結果がここに表示されます..."
					className={`min-h-[160px] font-mono-tool rounded-xl bg-muted/50 ${output ? 'shimmer' : ''}`}
				/>
			</div>
		</div>
	);
}
