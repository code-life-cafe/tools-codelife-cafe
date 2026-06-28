import { Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
	type ConversionOptions,
	convert,
	type Direction,
} from '@/lib/tools/zenkaku-hankaku';

export default function ZenkakuHankaku() {
	const [input, setInput] = useState('');
	const [direction, setDirection] = useState<Direction>('toHankaku');
	const [options, setOptions] = useState<ConversionOptions>({
		katakana: true,
		alpha: true,
		numbers: true,
		symbols: true,
	});

	const output = input ? convert(input, direction, options) : '';

	const toggleOption = useCallback((key: keyof ConversionOptions) => {
		setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
	}, []);

	return (
		<div className="space-y-6">
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
						checked={direction === 'toZenkaku'}
						onCheckedChange={(checked) =>
							setDirection(checked ? 'toZenkaku' : 'toHankaku')
						}
						className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-primary"
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
							['symbols', '記号'],
						] as [keyof ConversionOptions, string][]
					).map(([key, label]) => (
						<div key={key} className="flex items-center gap-1.5">
							<Checkbox
								id={`opt-${key}`}
								checked={options[key]}
								onCheckedChange={() => toggleOption(key)}
							/>
							<Label htmlFor={`opt-${key}`} className="text-sm cursor-pointer">
								{label}
							</Label>
						</div>
					))}
				</div>
			</div>

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
					<Label className="text-sm font-medium">変換結果</Label>
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
					value={output}
					readOnly
					placeholder="変換結果がここに表示されます..."
					className={`min-h-[160px] font-mono-tool rounded-xl bg-muted/50 ${output ? 'shimmer' : ''}`}
				/>
			</div>
		</div>
	);
}
