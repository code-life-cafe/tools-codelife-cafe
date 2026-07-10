import { FileText, GitCompareArrows, Trash2 } from 'lucide-react';
import {
	type DragEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	computeDiff,
	type DiffMode,
	readFileAsText,
} from '@/lib/tools/text-diff';

export default function TextDiff() {
	const { trackRun } = useToolAnalytics('text-diff');
	const [textA, setTextA] = useState('');
	const [textB, setTextB] = useState('');
	const [mode, setMode] = useState<DiffMode>('lines');
	const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
	const [dragOverA, setDragOverA] = useState(false);
	const [dragOverB, setDragOverB] = useState(false);

	const result = useMemo(() => {
		if (!textA && !textB) return null;
		return computeDiff(textA, textB, mode);
	}, [textA, textB, mode]);

	useEffect(() => {
		if (result) {
			trackRun();
		}
	}, [result, trackRun]);

	const handleDrop = useCallback(
		async (e: DragEvent<HTMLTextAreaElement>, target: 'A' | 'B') => {
			e.preventDefault();
			setDragOverA(false);
			setDragOverB(false);
			const file = e.dataTransfer.files[0];
			if (file) {
				try {
					const content = await readFileAsText(file);
					if (target === 'A') setTextA(content);
					else setTextB(content);
				} catch {
					// ignore
				}
			}
		},
		[],
	);

	const diffText = useMemo(() => {
		if (!result) return '';
		return result.parts
			.map((p) => {
				const prefix =
					p.type === 'added' ? '+ ' : p.type === 'removed' ? '- ' : '  ';
				const partLines = p.value.split('\n');
				if (p.value.endsWith('\n')) {
					partLines.pop();
				}
				return partLines.map((line) => `${prefix}${line}`).join('\n');
			})
			.join('\n');
	}, [result]);

	// unified ビュー用の行番号付きパート計算
	const unifiedLines = useMemo(() => {
		if (!result) return [];
		const lines: Array<{
			type: 'added' | 'removed' | 'unchanged';
			content: string;
			lineA: number | null;
			lineB: number | null;
		}> = [];
		let lineA = 1;
		let lineB = 1;

		for (const part of result.parts) {
			const partLines = part.value.split('\n');
			if (part.value.endsWith('\n')) {
				partLines.pop();
			}
			for (const line of partLines) {
				if (part.type === 'removed') {
					lines.push({ type: 'removed', content: line, lineA, lineB: null });
					lineA++;
				} else if (part.type === 'added') {
					lines.push({ type: 'added', content: line, lineA: null, lineB });
					lineB++;
				} else {
					lines.push({ type: 'unchanged', content: line, lineA, lineB });
					lineA++;
					lineB++;
				}
			}
		}
		return lines;
	}, [result]);

	// split ビュー用の行番号付きパート計算
	const splitLines = useMemo(() => {
		if (!result) return { left: [], right: [] };
		const left: Array<{
			type: 'removed' | 'unchanged';
			content: string;
			lineNum: number;
		}> = [];
		const right: Array<{
			type: 'added' | 'unchanged';
			content: string;
			lineNum: number;
		}> = [];
		let lineA = 1;
		let lineB = 1;

		for (const part of result.parts) {
			const partLines = part.value.split('\n');
			if (part.value.endsWith('\n')) {
				partLines.pop();
			}
			for (const line of partLines) {
				if (part.type === 'removed') {
					left.push({ type: 'removed', content: line, lineNum: lineA });
					lineA++;
				} else if (part.type === 'added') {
					right.push({ type: 'added', content: line, lineNum: lineB });
					lineB++;
				} else {
					left.push({ type: 'unchanged', content: line, lineNum: lineA });
					right.push({ type: 'unchanged', content: line, lineNum: lineB });
					lineA++;
					lineB++;
				}
			}
		}
		return { left, right };
	}, [result]);

	return (
		<div className="space-y-6">
			{/* Mode Toggle */}
			<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
				<div className="flex items-center gap-2">
					<GitCompareArrows className="h-5 w-5 text-muted-foreground" />
					<span className="text-sm font-medium">比較モード:</span>
				</div>
				<div className="flex items-center gap-4 w-full sm:w-auto overflow-x-auto">
					<Tabs value={mode} onValueChange={(v) => setMode(v as DiffMode)}>
						<TabsList>
							<TabsTrigger value="lines">行単位</TabsTrigger>
							<TabsTrigger value="chars">文字単位</TabsTrigger>
						</TabsList>
					</Tabs>
					<Tabs
						value={viewMode}
						onValueChange={(v) => setViewMode(v as 'unified' | 'split')}
						className="hidden sm:block"
					>
						<TabsList>
							<TabsTrigger value="unified">Unified</TabsTrigger>
							<TabsTrigger value="split">Split</TabsTrigger>
						</TabsList>
					</Tabs>
				</div>
			</div>

			{/* Two-pane input */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
				<div>
					<div className="flex items-center justify-between mb-2">
						<Label className="text-sm font-medium">テキストA（変更前）</Label>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setTextA('')}
							disabled={!textA}
							className="h-6 px-2 text-xs"
						>
							<Trash2 className="h-3 w-3 mr-1" />
							クリア
						</Button>
					</div>
					<Textarea
						id="text-diff-textarea-a"
						value={textA}
						onChange={(e) => setTextA(e.target.value)}
						onDrop={(e) => handleDrop(e, 'A')}
						onDragOver={(e) => {
							e.preventDefault();
							setDragOverA(true);
						}}
						onDragLeave={() => setDragOverA(false)}
						placeholder="変更前のテキストをここに入力..."
						resize="vertical"
						className={`min-h-[240px] max-h-[80dvh] font-mono-tool rounded-xl focus:ring-2 focus:ring-primary ${
							dragOverA ? 'border-primary border-dashed bg-primary/5' : ''
						}`}
					/>
					<p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
						<FileText className="h-3 w-3" />
						.txtファイルのドラッグ&ドロップ対応
					</p>
				</div>
				<div>
					<div className="flex items-center justify-between mb-2">
						<Label className="text-sm font-medium">テキストB（変更後）</Label>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setTextB('')}
							disabled={!textB}
							className="h-6 px-2 text-xs"
						>
							<Trash2 className="h-3 w-3 mr-1" />
							クリア
						</Button>
					</div>
					<Textarea
						id="text-diff-textarea-b"
						value={textB}
						onChange={(e) => setTextB(e.target.value)}
						onDrop={(e) => handleDrop(e, 'B')}
						onDragOver={(e) => {
							e.preventDefault();
							setDragOverB(true);
						}}
						onDragLeave={() => setDragOverB(false)}
						placeholder="変更後のテキストをここに入力..."
						resize="vertical"
						className={`min-h-[240px] max-h-[80dvh] font-mono-tool rounded-xl focus:ring-2 focus:ring-primary ${
							dragOverB ? 'border-primary border-dashed bg-primary/5' : ''
						}`}
					/>
				</div>
			</div>

			{/* Summary Bar */}
			{result && (
				<Card className="rounded-xl">
					<CardContent className="p-4">
						<div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
							<span className="font-medium">差分統計:</span>
							<div className="flex items-center gap-4">
								<span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
									<span className="inline-block h-3 w-3 rounded-sm bg-green-500/20 border border-green-500/50"></span>
									追加: {result.addedLines}行 ({result.addedChars}文字)
								</span>
								<span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
									<span className="inline-block h-3 w-3 rounded-sm bg-red-500/20 border border-red-500/50"></span>
									削除: {result.removedLines}行 ({result.removedChars}文字)
								</span>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Diff Result */}
			{result && (
				<div>
					<div className="flex items-center justify-between mb-2">
						<Label className="text-sm font-medium">差分結果</Label>
						<CopyButton text={diffText} />
					</div>
					{viewMode === 'split' ? (
						<div className="grid grid-cols-2 gap-4">
							<div className="rounded-xl border border-border bg-card overflow-x-auto whitespace-pre font-mono-tool text-sm min-h-[100px]">
								<div className="bg-muted px-4 py-1.5 border-b border-border text-xs font-bold text-muted-foreground sticky top-0">
									テキストA（変更前）
								</div>
								<div className="w-full min-w-max">
									{splitLines.left.map((line) => (
										<div
											key={`l-${line.lineNum}`}
											className={`flex min-w-max ${line.type === 'removed' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : ''}`}
										>
											<span className="inline-block w-10 shrink-0 text-right pr-2 text-xs text-muted-foreground select-none border-r border-border/50 py-0.5 bg-muted/30">
												{line.lineNum}
											</span>
											<span className="px-2 py-0.5">
												{line.type === 'removed' && (
													<span className="select-none opacity-50">- </span>
												)}
												{line.type === 'unchanged' && (
													<span className="select-none opacity-30"> </span>
												)}
												{line.content}
											</span>
										</div>
									))}
								</div>
							</div>
							<div className="rounded-xl border border-border bg-card overflow-x-auto whitespace-pre font-mono-tool text-sm min-h-[100px]">
								<div className="bg-muted px-4 py-1.5 border-b border-border text-xs font-bold text-muted-foreground sticky top-0">
									テキストB（変更後）
								</div>
								<div className="w-full min-w-max">
									{splitLines.right.map((line) => (
										<div
											key={`r-${line.lineNum}`}
											className={`flex min-w-max ${line.type === 'added' ? 'bg-green-500/10 text-green-700 dark:text-green-300' : ''}`}
										>
											<span className="inline-block w-10 shrink-0 text-right pr-2 text-xs text-muted-foreground select-none border-r border-border/50 py-0.5 bg-muted/30">
												{line.lineNum}
											</span>
											<span className="px-2 py-0.5">
												{line.type === 'added' && (
													<span className="select-none opacity-50">+ </span>
												)}
												{line.type === 'unchanged' && (
													<span className="select-none opacity-30"> </span>
												)}
												{line.content}
											</span>
										</div>
									))}
								</div>
							</div>
						</div>
					) : (
						<div className="rounded-xl border border-border bg-card overflow-hidden font-mono-tool text-sm">
							{unifiedLines.map((line) => (
								<div
									key={
										line.lineA !== null ? `a-${line.lineA}` : `b-${line.lineB}`
									}
									className={`flex whitespace-pre-wrap break-all ${
										line.type === 'added'
											? 'bg-green-500/10 text-green-700 dark:text-green-300'
											: line.type === 'removed'
												? 'bg-red-500/10 text-red-700 dark:text-red-300'
												: ''
									}`}
								>
									{/* 行番号A */}
									<span className="inline-block w-10 shrink-0 text-right pr-2 text-xs text-muted-foreground select-none border-r border-border/50 py-0.5 bg-muted/30">
										{line.lineA ?? ''}
									</span>
									{/* 行番号B */}
									<span className="inline-block w-10 shrink-0 text-right pr-2 text-xs text-muted-foreground select-none border-r border-border/50 py-0.5 bg-muted/30">
										{line.lineB ?? ''}
									</span>
									{/* コンテンツ */}
									<span className="px-2 py-0.5 flex-1">
										{line.type === 'added' && (
											<span className="select-none opacity-50">+ </span>
										)}
										{line.type === 'removed' && (
											<span className="select-none opacity-50">- </span>
										)}
										{line.type === 'unchanged' && (
											<span className="select-none opacity-30"> </span>
										)}
										{line.content}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{!result && (
				<div className="text-center py-12 text-muted-foreground">
					<GitCompareArrows className="h-12 w-12 mx-auto mb-4 opacity-30" />
					<p>両方のテキストを入力すると差分が表示されます</p>
				</div>
			)}
		</div>
	);
}
