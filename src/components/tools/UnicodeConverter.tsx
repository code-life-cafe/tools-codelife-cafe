import { ArrowLeftRight, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { textToUnicode, unicodeToText } from '@/lib/tools/unicode-converter';

export default function UnicodeConverter() {
	const { trackRun } = useToolAnalytics('unicode-converter');
	const [input, setInput] = useState('');
	const [direction, setDirection] = useState<'encode' | 'decode'>('encode');

	const result = useMemo(() => {
		if (!input.trim()) return { output: '', error: null };
		try {
			if (direction === 'encode') {
				return { output: textToUnicode(input), error: null };
			} else {
				return { output: unicodeToText(input), error: null };
			}
		} catch (err: unknown) {
			return {
				output: '',
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}, [input, direction]);

	useEffect(() => {
		if (input.trim() && result.output && !result.error) {
			trackRun();
		}
	}, [input, result, trackRun]);

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3 mb-4">
				<Label className="text-sm font-medium whitespace-nowrap">
					{direction === 'encode'
						? 'テキスト → ユニコード'
						: 'ユニコード → テキスト'}
				</Label>
				<Switch
					checked={direction === 'decode'}
					onCheckedChange={(checked) =>
						setDirection(checked ? 'decode' : 'encode')
					}
				/>
				<ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				{/* 入力エリア */}
				<div>
					<div className="flex justify-between items-center mb-2 min-h-9">
						<Label className="text-sm font-medium block">
							入力 (
							{direction === 'encode'
								? 'プレーンテキスト'
								: 'ユニコード(\\uXXXX)'}
							)
						</Label>
					</div>
					<Textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={
							direction === 'encode'
								? 'こんにちは世界\nHello World'
								: '\\u3053\\u3093\\u306b\\u3061\\u306f\\u4e16\\u754c\n\\u0048\\u0065\\u006c\\u006c\\u006f\\u0020\\u0057\\u006f\\u0072\\u006c\\u0064'
						}
						className="min-h-[300px] font-mono-tool rounded-xl focus:ring-2 focus:ring-primary"
					/>
				</div>

				{/* 出力エリア */}
				<div>
					<div className="flex items-center justify-between mb-2 min-h-9">
						<Label className="text-sm font-medium">変換結果</Label>
						<div className="flex gap-2">
							<CopyButton text={result.output} />
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
						value={result.error ? result.error : result.output}
						readOnly
						placeholder="変換結果がここに表示されます..."
						className={`min-h-[300px] font-mono-tool rounded-xl bg-muted/50 ${
							result.error
								? 'text-red-500 font-bold border-red-200 bg-red-50 dark:bg-red-950/20'
								: ''
						} ${result.output ? 'shimmer' : ''}`}
					/>
				</div>
			</div>
		</div>
	);
}
