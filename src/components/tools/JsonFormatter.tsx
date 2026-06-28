import { AlertCircle, Download, Minimize2, Wand2 } from 'lucide-react';
import { type UIEvent, useCallback, useMemo, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import {
	formatJson,
	type IndentType,
	minifyJson,
} from '@/lib/tools/json-formatter';

function highlightJson(json: string) {
	if (!json) return '';
	const jsonStr = json
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	return jsonStr.replace(
		/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
		(match) => {
			let cls = 'text-green-600 dark:text-green-400'; // number
			if (/^"/.test(match)) {
				if (/:$/.test(match)) {
					cls = 'text-blue-600 dark:text-blue-400'; // key
				} else {
					cls = 'text-orange-600 dark:text-orange-400'; // string
				}
			} else if (/true|false/.test(match)) {
				cls = 'text-purple-600 dark:text-purple-400'; // boolean
			} else if (/null/.test(match)) {
				cls = 'text-gray-500 dark:text-gray-400'; // null
			}
			return `<span class="${cls}">${match}</span>`;
		},
	);
}

export default function JsonFormatter() {
	const [input, setInput] = useState('');
	const [output, setOutput] = useState('');
	const [indent, setIndent] = useState<IndentType>('2');
	const [error, setError] = useState<string | null>(null);
	const [errorPosition, setErrorPosition] = useState<number | null>(null);

	const currentErrorLine =
		errorPosition !== null && input
			? input.substring(0, errorPosition).split('\n').length
			: null;

	// 入力側行番号
	const inputLineCount = useMemo(
		() => (input.match(/\n/g) || []).length + 1,
		[input],
	);
	const inputLines = Array.from(
		{ length: Math.max(inputLineCount, 10) },
		(_, i) => i + 1,
	);

	const handleInputScroll = (e: UIEvent<HTMLTextAreaElement>) => {
		const gutter = document.getElementById('json-input-line-numbers');
		if (gutter) {
			gutter.scrollTop = e.currentTarget.scrollTop;
		}
	};

	// エラー行ハイライト（出力用）
	const outputHighlightLines = useMemo(() => {
		if (currentErrorLine) {
			return new Set([currentErrorLine]);
		}
		return undefined;
	}, [currentErrorLine]);

	const handleFormat = useCallback(() => {
		const result = formatJson(input, indent);
		if (result.success) {
			setOutput(result.output);
			setError(null);
			setErrorPosition(null);
		} else {
			setOutput('');
			setError(result.error ?? 'エラーが発生しました');
			setErrorPosition(result.errorPosition ?? null);
		}
	}, [input, indent]);

	const handleMinify = useCallback(() => {
		const result = minifyJson(input);
		if (result.success) {
			setOutput(result.output);
			setError(null);
			setErrorPosition(null);
		} else {
			setOutput('');
			setError(result.error ?? 'エラーが発生しました');
		}
	}, [input]);

	const handleDownload = useCallback(() => {
		if (!output) return;
		const blob = new Blob([output], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'formatted.json';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}, [output]);

	const handleInputChange = useCallback(
		(value: string) => {
			setInput(value);
			setError(null);
			setErrorPosition(null);
			// Auto-format on input change
			if (value.trim()) {
				const result = formatJson(value, indent);
				if (result.success) {
					setOutput(result.output);
					setError(null);
					setErrorPosition(null);
				} else {
					// Don't clear output immediately if they're just typing,
					// but let's show the error state or position if it fails
					setError(result.error ?? 'エラーが発生しました');
					setErrorPosition(result.errorPosition ?? null);
					setOutput('');
				}
			} else {
				setOutput('');
			}
		},
		[indent],
	);

	return (
		<div className="space-y-6">
			{/* Error Banner */}
			{error && (
				<div className="flex items-start gap-2 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					<AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
					<p>
						{error}{' '}
						{currentErrorLine && (
							<span className="font-bold">（{currentErrorLine}行目付近）</span>
						)}
					</p>
				</div>
			)}

			{/* Controls */}
			<div className="flex flex-wrap items-center gap-3">
				<div className="flex items-center gap-2">
					<Label className="text-sm whitespace-nowrap">インデント:</Label>
					<Select
						value={indent}
						onValueChange={(v) => setIndent(v as IndentType)}
					>
						<SelectTrigger className="w-[140px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="2">2スペース</SelectItem>
							<SelectItem value="4">4スペース</SelectItem>
							<SelectItem value="tab">タブ</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<div className="flex gap-2">
					<Button onClick={handleFormat} size="sm">
						<Wand2 className="h-4 w-4 mr-1" />
						整形
					</Button>
					<Button onClick={handleMinify} variant="outline" size="sm">
						<Minimize2 className="h-4 w-4 mr-1" />
						圧縮
					</Button>
				</div>
			</div>

			{/* Input */}
			<div>
				<Label
					htmlFor="json-input-textarea"
					className="text-sm font-medium mb-2 block"
				>
					入力JSON
				</Label>
				<div className="relative rounded-xl border border-input shadow-sm focus-within:ring-2 focus-within:ring-primary bg-background overflow-hidden flex h-[250px]">
					{/* 行番号ガター */}
					<div
						id="json-input-line-numbers"
						className="w-12 border-r bg-muted/40 text-right pr-2 py-3 overflow-hidden text-xs text-muted-foreground font-mono-tool select-none"
					>
						{inputLines.map((num) => (
							<div
								key={num}
								className={`leading-5 h-5${
									currentErrorLine === num
										? ' bg-destructive/20 text-destructive font-bold rounded-sm px-1'
										: ''
								}`}
							>
								{num}
							</div>
						))}
					</div>
					{/* Textarea */}
					<Textarea
						id="json-input-textarea"
						value={input}
						onChange={(e) => handleInputChange(e.target.value)}
						onScroll={handleInputScroll}
						placeholder={'{"name":"太郎","age":30,"city":"東京"}'}
						className="flex-1 min-h-0 bg-transparent text-foreground font-mono-tool text-sm leading-5 p-3 resize-none border-none ring-0 shadow-none focus-visible:ring-0 rounded-none whitespace-pre"
						spellCheck={false}
					/>
				</div>
			</div>

			{/* Output */}
			<div>
				<div className="flex items-center justify-between mb-2">
					<Label className="text-sm font-medium">出力</Label>
					<div className="flex gap-2">
						<CopyButton text={output} />
						<Button
							variant="outline"
							size="sm"
							onClick={handleDownload}
							disabled={!output}
						>
							<Download className="h-4 w-4 mr-1" />
							.json
						</Button>
					</div>
				</div>
				{output ? (
					<CodeBlock
						content={output}
						htmlContent={highlightJson(output)}
						highlightLines={outputHighlightLines}
						className="shimmer"
						minHeight="200px"
					/>
				) : (
					<Textarea
						value=""
						readOnly
						disabled={!!error}
						placeholder={
							error
								? '入力JSONにエラーがあります'
								: '整形結果がここに表示されます...'
						}
						className={`min-h-[200px] font-mono-tool rounded-xl bg-muted/50`}
						spellCheck={false}
					/>
				)}
			</div>
		</div>
	);
}
