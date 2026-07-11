import { ArrowLeftRight, ArrowUpDown, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	decodeUrl,
	encodeUrl,
	type UrlEncodeMode,
} from '@/lib/tools/url-encoder';

export default function UrlEncoder() {
	const { trackRun } = useToolAnalytics('url-encoder');
	const [mode, setMode] = useState<UrlEncodeMode>('component');
	const [direction, setDirection] = useState<'encode' | 'decode'>('decode');
	const [textInput, setTextInput] = useState('');

	// Computed Text Result
	const textResult = useMemo(() => {
		if (!textInput) return { output: '', error: null };
		try {
			if (direction === 'encode') {
				const out = encodeUrl(textInput, { mode });
				return { output: out, error: null };
			}
			const out = decodeUrl(textInput, { mode });
			return { output: out, error: null };
		} catch (err: unknown) {
			return {
				output: '',
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}, [textInput, direction, mode]);

	useEffect(() => {
		if (textInput.trim() && textResult.output && !textResult.error) {
			trackRun();
		}
	}, [textInput, textResult, trackRun]);

	// Swap input and output
	const handleSwap = () => {
		if (!textResult.output && !textInput) return;
		setTextInput(textResult.output || textInput);
		setDirection(direction === 'encode' ? 'decode' : 'encode');
	};

	return (
		<div className="space-y-6">
			{/* Mode Selection */}
			<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
				<Tabs
					value={mode}
					onValueChange={(val) => setMode(val as UrlEncodeMode)}
				>
					<div className="flex justify-center sm:justify-start">
						<TabsList className="bg-muted/50 p-1 rounded-xl">
							<TabsTrigger
								value="component"
								className="rounded-lg px-4 sm:px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all font-medium whitespace-nowrap"
							>
								コンポーネント (encodeURIComponent)
							</TabsTrigger>
							<TabsTrigger
								value="full"
								className="rounded-lg px-4 sm:px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all font-medium whitespace-nowrap"
							>
								フルURL (encodeURI)
							</TabsTrigger>
						</TabsList>
					</div>
				</Tabs>

				<div className="flex items-center gap-3 bg-muted/30 p-2 rounded-xl border border-border/50">
					<Label className="text-sm font-medium whitespace-nowrap min-w-[3rem] text-right">
						ENCODE
					</Label>
					<Switch
						checked={direction === 'decode'}
						onCheckedChange={(checked) =>
							setDirection(checked ? 'decode' : 'encode')
						}
						// わかりやすく緑と青を反転させるなどの見た目より、標準機能でOK
					/>
					<Label className="text-sm font-medium whitespace-nowrap min-w-[3rem]">
						DECODE
					</Label>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch relative">
				{/* Input Pane */}
				<div className="flex flex-col h-full">
					<div className="flex justify-between items-center mb-2 min-h-9">
						<Label className="text-sm font-medium block">
							入力 ({direction === 'encode' ? 'エンコード前' : 'デコード前'})
						</Label>
					</div>
					<Textarea
						value={textInput}
						onChange={(e) => setTextInput(e.target.value)}
						placeholder={
							direction === 'encode'
								? 'https://example.com/検索?q=東京 天気\nまたは\n検索クエリ'
								: 'https://example.com/%E6%A4%9C%E7%B4%A2?q=%E6%9D%B1%E4%BA%AC%20%E5%A4%A9%E6%B0%97'
						}
						resize="vertical"
						className="min-h-[240px] h-full font-mono-tool rounded-xl focus:ring-2 focus:ring-primary/50 text-base"
					/>
				</div>

				{/* Swap Button (Mobile: hidden, Desktop: center absolute) */}
				<div className="hidden md:flex absolute left-1/2 top-[calc(50%+1.125rem)] -translate-x-1/2 -translate-y-1/2 z-10 p-2 bg-background rounded-full">
					<Button
						variant="outline"
						size="icon"
						onClick={handleSwap}
						className="rounded-full shadow-sm hover:shadow-md transition-all bg-card/80 backdrop-blur-sm border-2 border-muted"
						title="入力と出力を入れ替える"
					>
						<ArrowLeftRight className="h-4 w-4 text-primary" />
					</Button>
				</div>

				{/* Swap Button (Mobile: shown between textareas) */}
				<div className="flex md:hidden justify-center my-0 z-10 -my-3">
					<Button
						variant="outline"
						size="sm"
						onClick={handleSwap}
						className="rounded-full shadow-sm bg-card/90 backdrop-blur-sm border-2 border-muted z-10 px-4"
					>
						<ArrowUpDown className="h-4 w-4 mr-2" />
						入れ替え
					</Button>
				</div>

				{/* Output Pane */}
				<div className="flex flex-col h-full">
					<div className="flex items-center justify-between mb-2 min-h-9 pl-0 md:pl-4">
						<Label className="text-sm font-medium">変換結果</Label>
						<div className="flex gap-2">
							<CopyButton
								text={textResult.output}
								disabled={!textResult.output || !!textResult.error}
							/>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setTextInput('')}
								disabled={!textInput}
								className="h-8"
							>
								<Trash2 className="h-4 w-4 mr-1" />
								クリア
							</Button>
						</div>
					</div>
					<Textarea
						value={textResult.error ? textResult.error : textResult.output}
						readOnly
						placeholder="変換結果がここに表示されます..."
						resize="vertical"
						className={`min-h-[240px] h-full font-mono-tool rounded-xl bg-muted/30 text-base ${
							textResult.error
								? 'text-red-500 font-bold border-red-200 bg-red-50 dark:bg-red-950/20'
								: ''
						} ${textResult.output ? 'shimmer border-primary/20' : ''}`}
					/>
				</div>
			</div>
		</div>
	);
}
