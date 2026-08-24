import { AlertTriangle, ChevronDown, Info, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	countChars,
	getServiceCounts,
	type LimitStatus,
	type ServiceCountResult,
} from '@/lib/tools/char-count';
import { provideToolsFromFactory } from '@/lib/webmcp';
import { charCountTool } from '@/lib/webmcp/tools/char-count.webmcp';

function formatNumber(n: number): string {
	return n.toLocaleString('ja-JP');
}

const STATUS_BAR_CLASS: Record<LimitStatus, string> = {
	normal: 'bg-primary',
	warning: 'bg-amber-500',
	over: 'bg-destructive',
};

const STATUS_TEXT_CLASS: Record<LimitStatus, string> = {
	normal: 'text-muted-foreground',
	warning: 'text-amber-600 dark:text-amber-400',
	over: 'text-destructive font-bold',
};

const STATUS_LABEL: Record<LimitStatus, string> = {
	normal: '通常',
	warning: '警告',
	over: '超過',
};

function ServiceProgressCard({ service }: { service: ServiceCountResult }) {
	const valueNow = Math.min(service.count, service.limit);
	const valueText = `${formatNumber(service.count)}文字 / 上限${formatNumber(service.limit)}文字（${service.message}）`;
	const noteId = `char-count-note-${service.id}`;

	return (
		<Card className="rounded-xl">
			<CardContent className="p-4">
				<div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
					<div className="flex items-center gap-1.5 text-sm font-medium">
						{service.label}
						{service.note && (
							<span className="group relative flex items-center justify-center">
								<button
									type="button"
									aria-describedby={noteId}
									aria-label={`${service.label}の補足情報`}
									className="flex items-center justify-center rounded-full cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<Info
										className="h-4 w-4 text-muted-foreground"
										aria-hidden="true"
									/>
								</button>
								<span
									id={noteId}
									role="tooltip"
									className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-56 rounded bg-popover text-popover-foreground text-xs p-2 shadow-md group-hover:block group-focus-within:block z-50"
								>
									{service.note}
								</span>
							</span>
						)}
					</div>
					<p
						className={`text-sm font-mono tabular-nums whitespace-nowrap ${STATUS_TEXT_CLASS[service.status]}`}
					>
						<span className="sr-only">{STATUS_LABEL[service.status]}: </span>
						{service.message}
					</p>
				</div>
				<div
					className="h-2 rounded-full bg-muted overflow-hidden"
					role="progressbar"
					aria-valuemin={0}
					aria-valuemax={service.limit}
					aria-valuenow={valueNow}
					aria-valuetext={valueText}
					aria-label={service.label}
				>
					<div
						className={`h-full rounded-full transition-all duration-300 ${STATUS_BAR_CLASS[service.status]}`}
						style={{ width: `${service.progress}%` }}
					/>
				</div>
				<p className="mt-1 text-xs text-muted-foreground tabular-nums">
					{formatNumber(service.count)} / {formatNumber(service.limit)} 文字
					{service.premiumLimit && (
						<span className="ml-1">
							（有料プランは{formatNumber(service.premiumLimit)}文字まで）
						</span>
					)}
				</p>
			</CardContent>
		</Card>
	);
}

export default function CharCount() {
	const { trackRunDebounced } = useToolAnalytics('char-count');
	const [text, setText] = useState('');
	const [secondarySnsOpen, setSecondarySnsOpen] = useState(false);
	const secondarySnsContentRef = useRef<HTMLDivElement>(null);

	const result = useMemo(() => countChars(text), [text]);
	const services = useMemo(() => getServiceCounts(text), [text]);

	// --- WebMCP Tool Registration ---
	useEffect(() => {
		return provideToolsFromFactory([charCountTool]);
	}, []);

	// テキストが実際に入力された（非空）時点でカウント実行を計測
	useEffect(() => {
		if (text) {
			trackRunDebounced();
		}
	}, [text, trackRunDebounced]);

	// 「その他のSNS」展開時、Instagram/LinkedInカードには操作可能な要素がなく
	// Tab移動がページ内の無関係な要素へ抜けてしまうため、展開領域へ明示的にフォーカスを移す
	useEffect(() => {
		if (secondarySnsOpen) {
			secondarySnsContentRef.current?.focus({ preventScroll: true });
		}
	}, [secondarySnsOpen]);

	const snsPrimary = services.filter(
		(s) => s.category === 'sns' && s.group === 'primary',
	);
	const snsSecondary = services.filter(
		(s) => s.category === 'sns' && s.group === 'secondary',
	);
	const seoServices = services.filter((s) => s.category === 'seo');

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

			{/* SNS / SEO 文字数制限 */}
			<Tabs defaultValue="sns" className="w-full">
				<TabsList>
					<TabsTrigger value="sns">SNS</TabsTrigger>
					<TabsTrigger value="seo">SEO</TabsTrigger>
				</TabsList>
				<TabsContent value="sns" className="space-y-3 mt-3">
					{snsPrimary.map((service) => (
						<ServiceProgressCard key={service.id} service={service} />
					))}
					{snsSecondary.length > 0 && (
						<Collapsible
							open={secondarySnsOpen}
							onOpenChange={setSecondarySnsOpen}
						>
							<CollapsibleTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className="w-full justify-between text-muted-foreground"
								>
									<span>
										その他のSNS（
										{snsSecondary.map((s) => s.label).join('・')}）
									</span>
									<ChevronDown
										className={`h-4 w-4 transition-transform ${secondarySnsOpen ? 'rotate-180' : ''}`}
										aria-hidden="true"
									/>
								</Button>
							</CollapsibleTrigger>
							<CollapsibleContent
								ref={secondarySnsContentRef}
								tabIndex={-1}
								aria-label="その他のSNSの文字数制限"
								className="space-y-3 pt-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							>
								{snsSecondary.map((service) => (
									<ServiceProgressCard key={service.id} service={service} />
								))}
							</CollapsibleContent>
						</Collapsible>
					)}
				</TabsContent>
				<TabsContent value="seo" className="space-y-3 mt-3">
					{seoServices.map((service) => (
						<ServiceProgressCard key={service.id} service={service} />
					))}
				</TabsContent>
			</Tabs>
		</div>
	);
}
