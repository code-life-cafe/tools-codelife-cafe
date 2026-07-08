import { AlertTriangle, Info, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { countChars, getTwitterProgress } from '@/lib/tools/char-count';

function formatNumber(n: number): string {
	return n.toLocaleString('ja-JP');
}

export default function CharCount() {
	const { trackRun } = useToolAnalytics('char-count');
	const [text, setText] = useState('');

	const result = useMemo(() => countChars(text), [text]);

	// テキストが実際に入力された（非空）時点でカウント実行を計測
	useEffect(() => {
		if (text) {
			trackRun();
		}
	}, [text, trackRun]);
	const twitter = useMemo(
		() => getTwitterProgress(result.charsWithSpaces),
		[result.charsWithSpaces],
	);

	const stats = [
		{
			label: '文字数（空白含む）',
			value: formatNumber(result.charsWithSpaces),
			unit: '文字',
		},
		{
			label: '見た目の文字数 (Grapheme)',
			value: formatNumber(result.graphemes),
			unit: '文字',
		},
		{
			label: '文字数（空白除く）',
			value: formatNumber(result.charsWithoutSpaces),
			unit: '文字',
		},
		{
			label: 'バイト数（UTF-8）',
			value: formatNumber(result.bytesUtf8),
			unit: 'bytes',
		},
		{
			label: 'バイト数（Shift-JIS）',
			value: formatNumber(result.bytesShiftJis),
			unit: 'bytes',
		},
		{ label: '行数', value: formatNumber(result.lines), unit: '行' },
	];

	return (
		<div className="space-y-6">
			{/* Input Textarea */}
			<div>
				<div className="flex items-center justify-between mb-2">
					<Label htmlFor="char-count-input" className="text-sm font-medium">
						入力テキスト
					</Label>
					<div className="flex gap-2">
						<CopyButton text={text} />
						<Button
							variant="outline"
							size="sm"
							onClick={() => setText('')}
							disabled={!text}
						>
							<Trash2 className="h-4 w-4 sm:mr-1" />
							<span className="hidden sm:inline">クリア</span>
						</Button>
					</div>
				</div>
				<Textarea
					id="char-count-input"
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder="ここに文章を入力すると、リアルタイムで文字数がカウントされます。"
					className="min-h-[200px] font-mono-tool rounded-xl focus:ring-2 focus:ring-primary"
				/>
			</div>

			{/* SJIS Warning Alert */}
			{result.hasUnsupportedShiftJis && (
				<div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-600 dark:text-amber-400 flex items-start gap-3">
					<AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-amber-500" />
					<div>
						<p className="font-semibold mb-1">
							Shift-JIS 非対応文字が検出されました (
							{formatNumber(result.unsupportedShiftJisCount)} 文字)
						</p>
						<p className="text-xs opacity-90">
							絵文字や一部のUnicode漢字など、Shift-JIS（Windows-31J）の文字コードに含まれない文字が存在します。従来のシステムやSJIS形式ファイルへのエクスポート時に文字化けする可能性があります。
						</p>
					</div>
				</div>
			)}

			{/* Stats Grid */}
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
				{stats.map((stat) => (
					<Card key={stat.label} className="rounded-xl">
						<CardContent className="p-4 text-center">
							<p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
							<p className="text-2xl font-bold tabular-nums">{stat.value}</p>
							<p className="text-xs text-muted-foreground">{stat.unit}</p>
						</CardContent>
					</Card>
				))}
			</div>

			{/* Twitter Character Limit Bar */}
			<Card className="rounded-xl">
				<CardContent className="p-4">
					<div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
						<div className="flex items-center gap-1.5 text-sm font-medium">
							X（旧Twitter）文字数制限
							<span className="group relative flex items-center justify-center cursor-help">
								<Info className="h-4 w-4 text-muted-foreground" />
								<div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-64 rounded bg-popover text-popover-foreground text-xs p-2 shadow-md group-hover:block z-50">
									※全角・半角区別なく単純に1文字として計算しています。（公式の短縮URL計算等には対応していません）
								</div>
							</span>
						</div>
						<p
							className={`text-sm font-mono tabular-nums whitespace-nowrap ${twitter.isOver ? 'text-destructive font-bold' : 'text-muted-foreground'}`}
						>
							{twitter.remaining >= 0
								? `残り ${formatNumber(twitter.remaining)} 文字`
								: `${formatNumber(Math.abs(twitter.remaining))} 文字オーバー`}
						</p>
					</div>
					<div className="h-2 rounded-full bg-muted overflow-hidden">
						<div
							className={`h-full rounded-full transition-all duration-300 ${
								twitter.isOver
									? 'bg-destructive'
									: twitter.percentage > 80
										? 'bg-yellow-500'
										: 'bg-primary'
							}`}
							style={{ width: `${Math.min(twitter.percentage, 100)}%` }}
						/>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
