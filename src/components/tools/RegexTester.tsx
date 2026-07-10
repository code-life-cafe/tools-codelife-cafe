import { Share2, Trash2, XCircle } from 'lucide-react';
import { type UIEvent, useCallback, useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
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
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import type { RegexResult } from '@/lib/tools/regex-tester';
import { COMMON_PATTERNS, testRegex } from '@/lib/tools/regex-tester';

export default function RegexTester() {
	const { trackRun, trackSharedUrlOpen } = useToolAnalytics('regex-tester');

	const [settings, updateSettings, generateShareUrl] = useToolSettings(
		'regex-tester',
		{
			pattern: '\\d{3}-\\d{4}',
			flags: 'g',
			showReplace: false,
			replacement: '',
		},
	);

	const { pattern, flags, showReplace, replacement } = settings;
	const [text, setText] = useState('郵便番号: 100-0001 と 530-0001');
	const [shareCopied, setShareCopied] = useState(false);

	// 共有URLからアクセスされた場合の計測
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.has('settings')) {
			trackSharedUrlOpen();
		}
	}, [trackSharedUrlOpen]);

	// Auto-sync flags
	const toggleFlag = (flag: string) => {
		updateSettings((prev) => {
			const nextFlags = prev.flags.includes(flag)
				? prev.flags.replace(flag, '')
				: prev.flags + flag;
			return { ...prev, flags: nextFlags };
		});
	};

	const [result, setResult] = useState<RegexResult>({ matches: [] });

	useEffect(() => {
		let cancelled = false;
		testRegex(pattern, flags, text, showReplace ? replacement : undefined).then(
			(r) => {
				if (!cancelled) {
					setResult(r);
					// テスト実行の分析計測
					trackRun();
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [pattern, flags, text, showReplace, replacement, trackRun]);

	// Handle synchronized scrolling for highlight overlay
	const handleScroll = (e: UIEvent<HTMLTextAreaElement>) => {
		const overlay = document.getElementById('highlight-overlay');
		const gutter = document.getElementById('regex-line-numbers');
		if (overlay) {
			overlay.scrollTop = e.currentTarget.scrollTop;
			overlay.scrollLeft = e.currentTarget.scrollLeft;
		}
		if (gutter) {
			gutter.scrollTop = e.currentTarget.scrollTop;
		}
	};

	// Generate highlight nodes
	const highlightNodes = useMemo(() => {
		if (result.error || result.matches.length === 0 || !pattern) {
			return <span>{text}</span>;
		}

		const nodes = [];
		let lastIndex = 0;

		// Sort matches by index to render sequentially (just in case)
		const sorted = [...result.matches].sort((a, b) => a.index - b.index);

		for (let i = 0; i < sorted.length; i++) {
			const match = sorted[i];
			if (match.index > lastIndex) {
				nodes.push(
					<span key={`t-${i}`}>{text.slice(lastIndex, match.index)}</span>,
				);
			}
			nodes.push(
				<mark
					key={`m-${i}`}
					className="bg-primary/30 dark:bg-primary/50 text-transparent rounded-[2px]"
				>
					{match.value}
				</mark>,
			);
			lastIndex = match.index + match.value.length;
		}

		if (lastIndex < text.length) {
			nodes.push(<span key="end">{text.slice(lastIndex)}</span>);
		}
		return nodes;
	}, [text, result.matches, result.error, pattern]);

	const handleShare = useCallback(() => {
		const shareUrl = generateShareUrl();
		navigator.clipboard.writeText(shareUrl);
		setShareCopied(true);
		setTimeout(() => setShareCopied(false), 2000);
	}, [generateShareUrl]);

	return (
		<div className="space-y-8">
			{/* Pattern Input Area */}
			<div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
				<div className="lg:col-span-3 space-y-4">
					<div>
						<div className="flex flex-wrap items-center justify-between gap-2 mb-2">
							<Label className="text-sm font-medium">正規表現パターン</Label>
							<div className="flex items-center gap-2">
								<Button
									onClick={handleShare}
									variant="outline"
									size="sm"
									className="h-8 text-xs rounded-xl flex items-center gap-1.5"
								>
									<Share2 className="h-3 w-3" />
									<span>{shareCopied ? 'コピー完了！' : '設定を共有'}</span>
								</Button>
								<Select
									onValueChange={(val) => {
										const pat = COMMON_PATTERNS.find((p) => p.label === val);
										if (pat) {
											updateSettings({
												pattern: pat.pattern,
												flags: pat.flags,
											});
										}
									}}
								>
									<SelectTrigger className="w-[180px] h-8 text-xs rounded-xl">
										<SelectValue placeholder="よく使うパターン" />
									</SelectTrigger>
									<SelectContent>
										{COMMON_PATTERNS.map((p) => (
											<SelectItem key={p.label} value={p.label}>
												{p.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<div className="text-xl font-mono text-muted-foreground">/</div>
							<Input
								value={pattern}
								onChange={(e) => updateSettings({ pattern: e.target.value })}
								className={`font-mono-tool text-base rounded-xl focus:ring-2 focus:ring-primary ${
									result.error
										? 'border-red-500 ring-red-500 focus:ring-red-500'
										: ''
								}`}
								placeholder="\d{3}-\d{4}"
							/>
							<div className="text-xl font-mono text-muted-foreground">/</div>
							<Input
								value={flags}
								onChange={(e) => updateSettings({ flags: e.target.value })}
								className="w-24 font-mono-tool text-base rounded-xl focus:ring-2 focus:ring-primary"
								placeholder="gim"
							/>
						</div>
						{result.error && (
							<p className="text-red-500 text-sm mt-2 flex items-center gap-1">
								<XCircle className="h-4 w-4" /> {result.error}
							</p>
						)}
					</div>

					<div className="flex flex-wrap gap-4">
						{Object.entries({
							g: 'Global (全件一致)',
							i: 'Ignore Case (大文字小文字区別なし)',
							m: 'Multiline (複数行)',
							s: 'Dot All (.が改行に一致)',
							u: 'Unicode',
						}).map(([flag, desc]) => (
							<div key={flag} className="flex items-center gap-2">
								<Checkbox
									id={`flag-${flag}`}
									checked={flags.includes(flag)}
									onCheckedChange={() => toggleFlag(flag)}
								/>
								<Label
									htmlFor={`flag-${flag}`}
									className="text-sm cursor-pointer whitespace-nowrap"
								>
									<span className="font-mono bg-muted px-1 py-0.5 rounded mr-1">
										{flag}
									</span>
									{desc}
								</Label>
							</div>
						))}
					</div>
				</div>

				<div className="lg:col-span-1 border rounded-xl p-4 bg-card flex flex-col items-center justify-center">
					<div className="text-sm text-muted-foreground mb-2">マッチ数</div>
					<div
						className={`text-4xl font-bold ${result.matches.length > 0 ? 'text-primary' : 'text-muted-foreground'}`}
					>
						{result.matches.length}
					</div>
				</div>
			</div>

			<hr />

			{/* Test String Area */}
			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<Label className="text-sm font-medium">テスト文字列</Label>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setText('')}
						disabled={!text}
					>
						<Trash2 className="h-4 w-4 mr-1" />
						クリア
					</Button>
				</div>

				{/* Highlight Overlay Container */}
				<div className="relative rounded-xl border border-input shadow-sm focus-within:ring-2 focus-within:ring-primary bg-background overflow-hidden flex">
					{/* 行番号ガター */}
					<div
						id="regex-line-numbers"
						className="shrink-0 w-12 border-r bg-muted/40 text-right pr-2 py-2 overflow-hidden text-xs text-muted-foreground font-mono-tool select-none z-10"
						aria-hidden="true"
					>
						{Array.from(
							{ length: Math.max((text.match(/\n/g) || []).length + 1, 8) },
							(_, i) => i + 1,
						).map((num) => (
							<div key={num} className="leading-5 h-5">
								{num}
							</div>
						))}
					</div>
					{/* コンテンツラッパー */}
					<div className="relative flex-1">
						{/* Highlight Layer */}
						<div
							id="highlight-overlay"
							className="absolute inset-0 pointer-events-none px-3 py-2 text-sm whitespace-pre-wrap break-words font-mono-tool overflow-hidden"
							aria-hidden="true"
						>
							{highlightNodes}
						</div>
						{/* Actual Textarea */}
						<Textarea
							id="regex-test-string-textarea"
							value={text}
							onChange={(e) => setText(e.target.value)}
							onScroll={handleScroll}
							resize="vertical"
							className="w-full h-[240px] min-h-[240px] max-h-[80dvh] bg-transparent text-foreground font-mono-tool border-none ring-0 shadow-none focus-visible:ring-0 rounded-none"
							spellCheck={false}
						/>
					</div>
				</div>
			</div>

			<div className="flex items-center gap-3 mb-2">
				<Switch
					id="replace-mode-switch"
					checked={showReplace}
					onCheckedChange={(val) => updateSettings({ showReplace: val })}
				/>
				<Label
					htmlFor="replace-mode-switch"
					className="text-sm font-medium whitespace-nowrap cursor-pointer"
				>
					置換モードを有効にする
				</Label>
			</div>

			<div className="relative">
				<div
					className={`grid grid-cols-1 md:grid-cols-2 gap-6 items-start transition-all duration-300 ${!showReplace && 'opacity-30 grayscale blur-[1px] select-none pointer-events-none'}`}
				>
					<div>
						<Label className="text-sm font-medium mb-2 block">置換文字列</Label>
						<Input
							value={replacement}
							onChange={(e) => updateSettings({ replacement: e.target.value })}
							placeholder="***-**** または $1 など"
							className="font-mono-tool rounded-xl bg-background"
							disabled={!showReplace}
						/>
						<p className="text-xs text-muted-foreground mt-2">
							キャプチャグループは <code>$1</code>, <code>$2</code>{' '}
							などで参照できます。
						</p>
					</div>
					<div>
						<div className="flex items-center justify-between mb-2">
							<Label className="text-sm font-medium">置換結果</Label>
							<CopyButton text={result.replacedText || ''} />
						</div>
						<Textarea
							id="regex-replace-output-textarea"
							value={result.replacedText}
							readOnly
							resize="vertical"
							className="min-h-[240px] max-h-[80dvh] font-mono-tool rounded-xl bg-muted/50"
						/>
					</div>
				</div>
				{!showReplace && (
					<button
						type="button"
						className="absolute inset-0 z-10 cursor-pointer rounded-xl flex items-center justify-center hover:bg-muted/5 transition-colors group"
						onClick={() => updateSettings({ showReplace: true })}
						title="クリックして置換モードを有効化"
					>
						<div className="opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 px-4 py-2 rounded-lg font-medium shadow-sm border border-border text-sm">
							クリックして有効化
						</div>
					</button>
				)}
			</div>

			{/* Match Results Panel */}
			{result.matches.length > 0 && (
				<Accordion
					type="single"
					collapsible
					className="w-full pt-4 border-t mt-4 border-none"
					defaultValue="matches"
				>
					<AccordionItem value="matches" className="border-none">
						<AccordionTrigger className="hover:no-underline py-2">
							<div className="flex items-center gap-2">
								<span className="text-sm font-medium">マッチ詳細</span>
								<Badge
									variant="secondary"
									className="rounded-full px-2.5 font-mono"
								>
									{result.matches.length}件
								</Badge>
							</div>
						</AccordionTrigger>
						<AccordionContent className="pt-2">
							<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto px-1 pb-2 scrollbar-thin">
								{result.matches.slice(0, 500).map((match, i) => (
									<Card
										key={`match-${match.index}`}
										className="rounded-xl overflow-hidden text-sm"
									>
										<div className="bg-muted px-3 py-1.5 border-b flex justify-between items-center text-xs">
											<span className="font-semibold text-muted-foreground">
												Match #{i + 1}
											</span>
											<span className="text-muted-foreground">
												Index: {match.index}
											</span>
										</div>
										<CardContent className="p-3 bg-card font-mono-tool">
											<div className="break-all font-medium text-foreground">
												{match.value}
											</div>

											{match.groups.length > 0 && (
												<div className="mt-3 space-y-1.5 border-t pt-2 border-border/50">
													{Array.from(match.groups.entries()).map(
														([gi, group]) => (
															<div
																key={`group-${gi}`}
																className="flex gap-2 text-xs items-start"
															>
																<Badge
																	variant="secondary"
																	className="px-1 text-[10px] h-4 leading-4 flex-shrink-0"
																>
																	Group {gi + 1}
																</Badge>
																<span className="break-all opacity-80">
																	{group ?? '(undefined)'}
																</span>
															</div>
														),
													)}
												</div>
											)}
										</CardContent>
									</Card>
								))}
								{result.matches.length > 500 && (
									<div className="col-span-full text-center text-xs text-muted-foreground py-4">
										... 以降の {result.matches.length - 500}{' '}
										件は省略されています（最大500件表示）
									</div>
								)}
							</div>
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			)}
		</div>
	);
}
