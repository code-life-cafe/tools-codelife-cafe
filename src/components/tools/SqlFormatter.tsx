import {
	Code2,
	Columns2,
	Download,
	Maximize2,
	Minimize2,
	Rows2,
	Share2,
	Trash2,
} from 'lucide-react';
import { type UIEvent, useCallback, useEffect, useMemo, useState } from 'react';
import CodeBlock from '@/components/common/CodeBlock';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import {
	formatSql,
	type IndentStyle,
	type SqlDialect,
	type SqlFormatOptions,
} from '@/lib/tools/sql-formatter';
import { cn } from '@/lib/utils';

const SQL_KEYWORDS = [
	'SELECT',
	'FROM',
	'WHERE',
	'AND',
	'OR',
	'JOIN',
	'LEFT',
	'RIGHT',
	'INNER',
	'OUTER',
	'ON',
	'ORDER BY',
	'GROUP BY',
	'HAVING',
	'LIMIT',
	'OFFSET',
	'INSERT',
	'INTO',
	'VALUES',
	'UPDATE',
	'SET',
	'DELETE',
	'CREATE',
	'TABLE',
	'DROP',
	'ALTER',
	'ADD',
	'COLUMN',
	'AS',
	'DISTINCT',
	'COUNT',
	'MAX',
	'MIN',
	'AVG',
	'SUM',
	'IS',
	'NULL',
	'NOT',
	'IN',
	'BETWEEN',
	'LIKE',
];

export default function SqlFormatter() {
	const { trackRun, trackSharedUrlOpen } = useToolAnalytics('sql-formatter');
	const [input, setInput] = useState('');
	const [settings, updateSettings, generateShareUrl] = useToolSettings(
		'sql-formatter',
		{
			autoFormat: true,
			dialect: 'sql' as SqlDialect,
			indent: '2spaces' as IndentStyle,
			uppercase: true,
			compress: false,
			isExpanded: false,
			layout: 'horizontal' as 'horizontal' | 'vertical',
		},
	);
	const { autoFormat, dialect, indent, uppercase, compress, isExpanded } =
		settings;
	// 不正値や旧形式の共有設定を受け取った場合は左右レイアウトへ安全にフォールバックする
	const layout: 'horizontal' | 'vertical' =
		settings.layout === 'vertical' ? 'vertical' : 'horizontal';
	const setLayout = useCallback(
		(value: string) => {
			if (value === 'horizontal' || value === 'vertical') {
				updateSettings({ layout: value });
			}
		},
		[updateSettings],
	);
	const [shareCopied, setShareCopied] = useState(false);

	const [manualOutput, setManualOutput] = useState('');
	const [manualError, setManualError] = useState<string | null>(null);

	const { output, error } = useMemo(() => {
		const opts: SqlFormatOptions = { dialect, indent, uppercase, compress };
		if (autoFormat) return formatSql(input, opts);
		return { output: manualOutput, error: manualError };
	}, [
		input,
		dialect,
		indent,
		uppercase,
		compress,
		autoFormat,
		manualOutput,
		manualError,
	]);

	const handleFormat = useCallback(() => {
		const opts: SqlFormatOptions = { dialect, indent, uppercase, compress };
		const res = formatSql(input, opts);
		setManualOutput(res.output);
		setManualError(res.error || null);
		// 整形が成功した（エラーなく出力が得られた）時点で実行を計測
		if (res.output && !res.error) {
			trackRun();
		}
	}, [input, dialect, indent, uppercase, compress, trackRun]);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.has('settings')) {
			trackSharedUrlOpen();
		}
	}, [trackSharedUrlOpen]);

	// 自動整形（デフォルト有効）は入力のたびにライブ整形されるため、
	// 手動ボタンとは別にこちらでも成功時の実行を計測する
	useEffect(() => {
		if (autoFormat && output && !error) {
			trackRun();
		}
	}, [autoFormat, output, error, trackRun]);

	useEffect(() => {
		if (autoFormat) {
			setManualOutput('');
			setManualError(null);
		}
	}, [autoFormat]);

	const handleShare = useCallback(() => {
		const shareUrl = generateShareUrl();
		navigator.clipboard.writeText(shareUrl);
		setShareCopied(true);
		setTimeout(() => setShareCopied(false), 2000);
	}, [generateShareUrl]);

	const applyLayoutWidth = useCallback((expanded: boolean) => {
		const container = document.getElementById('tool-layout-container');
		if (!container) return;
		if (expanded) {
			container.classList.remove('max-w-[800px]', 'xl:max-w-5xl');
			container.classList.add('max-w-full');
		} else {
			container.classList.remove('max-w-full');
			container.classList.add('max-w-[800px]', 'xl:max-w-5xl');
		}
	}, []);

	const toggleExpand = () => {
		updateSettings({ isExpanded: !isExpanded });
	};

	useEffect(() => {
		applyLayoutWidth(isExpanded);
	}, [isExpanded, applyLayoutWidth]);

	useEffect(() => {
		return () => {
			const container = document.getElementById('tool-layout-container');
			if (container) {
				container.classList.remove('max-w-full');
				container.classList.add('max-w-[800px]', 'xl:max-w-5xl');
			}
		};
	}, []);

	// Basic syntax highlighter
	const highlightedNodes = useMemo(() => {
		if (!output) return null;

		const parts = [];
		let lastIndex = 0;
		const keywordPattern = SQL_KEYWORDS.join('|');
		const regex = new RegExp(
			`('.*?')|\\b(\\d+)\\b|\\b(${keywordPattern})\\b`,
			'ig',
		);

		const matches = Array.from(output.matchAll(regex));

		for (let i = 0; i < matches.length; i++) {
			const m = matches[i];
			const index = m.index;
			if (index !== undefined && index > lastIndex) {
				parts.push(output.slice(lastIndex, index));
			}

			if (m[1]) {
				parts.push(
					<span key={i} className="text-green-600 dark:text-green-400">
						{m[1]}
					</span>,
				);
			} else if (m[2]) {
				parts.push(
					<span key={i} className="text-blue-600 dark:text-blue-400">
						{m[2]}
					</span>,
				);
			} else if (m[3]) {
				parts.push(
					<span
						key={i}
						className="text-purple-600 dark:text-purple-400 font-bold"
					>
						{m[3]}
					</span>,
				);
			}
			lastIndex = index !== undefined ? index + m[0].length : lastIndex;
		}

		if (lastIndex < output.length) {
			parts.push(output.slice(lastIndex));
		}

		return parts;
	}, [output]);

	// Line numbers setup
	const lineCount = useMemo(
		() => (input.match(/\n/g) || []).length + 1,
		[input],
	);
	const lines = Array.from(
		{ length: Math.max(lineCount, 10) },
		(_, i) => i + 1,
	);

	const handleScroll = (e: UIEvent<HTMLTextAreaElement>) => {
		const gutter = document.getElementById('line-numbers');
		if (gutter) {
			gutter.scrollTop = e.currentTarget.scrollTop;
		}
	};

	const handleDownload = () => {
		if (output && !error) {
			const blob = new Blob([output], { type: 'text/sql;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'query.sql';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}
	};

	return (
		<div className="space-y-6">
			{/* Options Toolbar */}
			<div className="flex flex-wrap items-center gap-4 bg-muted/30 p-4 rounded-xl border">
				<div>
					<Label className="text-xs mb-1 block text-muted-foreground">
						SQL方言
					</Label>
					<Select
						value={dialect}
						onValueChange={(v) => updateSettings({ dialect: v as SqlDialect })}
					>
						<SelectTrigger className="w-[140px] h-8 rounded-lg bg-background">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="sql">Standard SQL</SelectItem>
							<SelectItem value="mysql">MySQL</SelectItem>
							<SelectItem value="postgresql">PostgreSQL</SelectItem>
							<SelectItem value="tsql">T-SQL</SelectItem>
							<SelectItem value="plsql">PL/SQL</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{!compress && (
					<div>
						<Label className="text-xs mb-1 block text-muted-foreground">
							インデント
						</Label>
						<Select
							value={indent}
							onValueChange={(v) =>
								updateSettings({ indent: v as IndentStyle })
							}
						>
							<SelectTrigger className="w-[120px] h-8 rounded-lg bg-background">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="2spaces">2 Spaces</SelectItem>
								<SelectItem value="4spaces">4 Spaces</SelectItem>
								<SelectItem value="tabs">Tabs</SelectItem>
							</SelectContent>
						</Select>
					</div>
				)}

				<div className="flex items-center gap-4 ml-auto mt-4 sm:mt-0">
					<div className="flex items-center gap-2">
						<Switch
							id="auto-format"
							checked={autoFormat}
							onCheckedChange={(value) => updateSettings({ autoFormat: value })}
						/>
						<Label
							htmlFor="auto-format"
							className="text-sm cursor-pointer whitespace-nowrap"
						>
							自動整形
						</Label>
					</div>

					<div className="flex items-center gap-2">
						<Switch
							id="opt-uppercase"
							checked={uppercase}
							onCheckedChange={(value) => updateSettings({ uppercase: value })}
						/>
						<Label
							htmlFor="opt-uppercase"
							className="text-sm cursor-pointer whitespace-nowrap"
						>
							大文字化
						</Label>
					</div>

					<div className="flex items-center gap-2">
						<Switch
							id="opt-compress"
							checked={compress}
							onCheckedChange={(value) => updateSettings({ compress: value })}
						/>
						<Label
							htmlFor="opt-compress"
							className="text-sm cursor-pointer whitespace-nowrap"
						>
							圧縮 (1行化)
						</Label>
					</div>

					<div className="w-px h-6 bg-border mx-2 hidden sm:block"></div>

					<ToggleGroup
						type="single"
						value={layout}
						onValueChange={setLayout}
						aria-label="入力・出力のレイアウト"
						variant="outline"
						className="hidden sm:flex"
					>
						<ToggleGroupItem
							value="horizontal"
							aria-label="左右に並べて表示"
							title="左右レイアウト"
						>
							<Columns2 className="h-4 w-4" />
						</ToggleGroupItem>
						<ToggleGroupItem
							value="vertical"
							aria-label="上下に並べて表示"
							title="上下レイアウト"
						>
							<Rows2 className="h-4 w-4" />
						</ToggleGroupItem>
					</ToggleGroup>

					<Button
						variant="outline"
						size="sm"
						onClick={handleShare}
						className="hidden sm:flex"
					>
						<Share2 className="h-4 w-4 mr-2" />
						{shareCopied ? 'コピー完了！' : '設定を共有'}
					</Button>

					<Button
						variant="outline"
						size="sm"
						onClick={toggleExpand}
						className="hidden sm:flex"
						title={isExpanded ? '標準サイズに戻す' : '画面幅を広げる'}
					>
						{isExpanded ? (
							<Minimize2 className="h-4 w-4 mr-2" />
						) : (
							<Maximize2 className="h-4 w-4 mr-2" />
						)}
						{isExpanded ? '標準幅' : 'フルサイズ'}
					</Button>
				</div>
			</div>

			{/* スマホレイアウト用フルサイズボタン (小さい画面では非表示でもよいが、一応用意しておきたい場合は配置。現状は sm:hidden で出さない or ここで出す) */}
			<div className="sm:hidden flex justify-end">
				<Button
					variant="outline"
					size="sm"
					onClick={handleShare}
					className="w-full"
				>
					<Share2 className="h-4 w-4 mr-2" />
					{shareCopied ? 'コピー完了！' : '設定を共有'}
				</Button>
			</div>

			<div className="sm:hidden flex justify-end">
				<Button
					variant="outline"
					size="sm"
					onClick={toggleExpand}
					className="w-full"
				>
					{isExpanded ? (
						<Minimize2 className="h-4 w-4 mr-2" />
					) : (
						<Maximize2 className="h-4 w-4 mr-2" />
					)}
					{isExpanded ? '標準サイズに戻す' : '画面幅を広げる (フルサイズ)'}
				</Button>
			</div>

			<div
				id="sql-formatter-panels"
				className={cn(
					'grid grid-cols-1 gap-6 items-start',
					layout === 'horizontal' && 'lg:grid-cols-2',
				)}
			>
				{/* Input */}
				<div>
					<div className="flex items-center justify-between mb-2">
						<Label className="text-sm font-medium">整形前SQL</Label>
						<div className="flex gap-2">
							{!autoFormat && (
								<Button size="sm" onClick={handleFormat} className="h-8">
									<Code2 className="h-4 w-4 mr-1" />
									整形を実行
								</Button>
							)}
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setInput('')}
								disabled={!input}
								className="h-8 text-muted-foreground hover:text-foreground"
							>
								<Trash2 className="h-4 w-4 mr-1" />
								クリア
							</Button>
						</div>
					</div>
					<div className="relative rounded-xl border border-input shadow-sm focus-within:ring-2 focus-within:ring-primary bg-background overflow-hidden flex">
						{/* Gutter */}
						<div
							id="line-numbers"
							className="w-12 border-r bg-muted/40 text-right pr-2 py-3 overflow-hidden text-xs text-muted-foreground font-mono-tool select-none"
						>
							{lines.map((num) => (
								<div key={num} className="leading-5 h-5">
									{num}
								</div>
							))}
						</div>
						{/* Textarea */}
						<Textarea
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onScroll={handleScroll}
							placeholder="SELECT * FROM users WHERE active = 1"
							spellCheck={false}
							resize="vertical"
							className="flex-1 h-[400px] min-h-[240px] max-h-[80dvh] bg-transparent text-foreground font-mono-tool text-sm leading-5 p-3 border-none ring-0 shadow-none focus-visible:ring-0 rounded-none whitespace-pre"
						/>
					</div>
				</div>

				{/* Output */}
				<div>
					<div className="flex items-center justify-between mb-2">
						<Label className="text-sm font-medium">
							{error ? (
								<span className="text-red-500">エラー</span>
							) : (
								'整形後SQL'
							)}
						</Label>
						<div className="flex items-center gap-2">
							{output && !error && (
								<Button
									variant="outline"
									size="sm"
									onClick={handleDownload}
									className="h-8"
								>
									<Download className="h-4 w-4 mr-1" />
									.sql保存
								</Button>
							)}
							<CopyButton text={output} />
						</div>
					</div>
					{error ? (
						<div className="rounded-xl border-2 border-red-500 shadow-sm h-[400px] min-h-[240px] max-h-[80dvh] resize-none md:resize-y overflow-auto bg-card">
							<div className="p-4 text-red-500 font-medium font-mono-tool text-sm whitespace-pre-wrap flex items-start gap-2 max-w-full">
								<Code2 className="h-5 w-5 mt-0.5 flex-shrink-0" />
								<div className="break-all">{error}</div>
							</div>
						</div>
					) : output && (autoFormat || manualOutput) ? (
						<CodeBlock
							content={output}
							className="h-[400px] shimmer"
							minHeight="240px"
							maxHeight="80dvh"
							resize="vertical"
						>
							{highlightedNodes}
						</CodeBlock>
					) : (
						<div className="rounded-xl border shadow-sm h-[400px] min-h-[240px] max-h-[80dvh] resize-none md:resize-y overflow-auto bg-card flex items-center justify-center text-muted-foreground p-6 text-center">
							<div>
								<Code2 className="h-10 w-10 mx-auto mb-3 opacity-20" />
								<p className="text-sm">
									左側（または上）にSQLを入力すると
									<br />
									整形されたコードが表示されます
								</p>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
