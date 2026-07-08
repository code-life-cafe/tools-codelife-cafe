import { Copy, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	generateSpreadsheetPrompt,
	type PromptTask,
	type SpreadsheetInputFormat,
} from '@/lib/tools/ai-spreadsheet-prompt';

const SAMPLE_DATA = `商品名\tカテゴリ\t売上\t粗利率\nコーヒー豆A\t食品\t128000\t32%\nマグカップ\t雑貨\t54000\t45%\nギフトセット\t食品\t212000\t38%`;

export function AiSpreadsheetPrompt() {
	const { trackRun } = useToolAnalytics('ai-spreadsheet-prompt');
	const [input, setInput] = useState(SAMPLE_DATA);
	const [format, setFormat] = useState<SpreadsheetInputFormat>('auto');
	const [task, setTask] = useState<PromptTask>('analyze');
	const [customInstruction, setCustomInstruction] = useState(
		'売上が高い順に特徴を整理し、次に取るべき施策を3つ提案してください。',
	);
	const [maxRows, setMaxRows] = useState<number | ''>(30);
	const [copied, setCopied] = useState(false);

	const result = useMemo(() => {
		const finalMaxRows =
			maxRows === '' || Number.isNaN(maxRows) || maxRows <= 0 ? 30 : maxRows;
		return generateSpreadsheetPrompt({
			input,
			format,
			task,
			customInstruction,
			maxRows: finalMaxRows,
		});
	}, [input, format, task, customInstruction, maxRows]);

	useEffect(() => {
		if (input.trim() && result.prompt) {
			trackRun();
		}
	}, [input, result.prompt, trackRun]);

	const copyPrompt = async () => {
		if (!result.prompt) return;
		await navigator.clipboard.writeText(result.prompt);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1600);
	};

	return (
		<div className="space-y-6">
			<div className="rounded-xl border border-border bg-card p-4 shadow-sm">
				<div className="mb-4 flex items-center gap-2">
					<Sparkles className="size-5 text-primary" />
					<h2 className="font-semibold">表データからAI用プロンプトを作成</h2>
				</div>

				<div className="grid gap-4 md:grid-cols-3">
					<div className="space-y-2">
						<Label htmlFor="format">入力形式</Label>
						<Select
							value={format}
							onValueChange={(value) =>
								setFormat(value as SpreadsheetInputFormat)
							}
						>
							<SelectTrigger id="format" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="auto">自動判定</SelectItem>
								<SelectItem value="csv">CSV</SelectItem>
								<SelectItem value="tsv">TSV / Excel貼り付け</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="task">AIに依頼する内容</Label>
						<Select
							value={task}
							onValueChange={(value) => setTask(value as PromptTask)}
						>
							<SelectTrigger id="task" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="analyze">分析してほしい</SelectItem>
								<SelectItem value="summarize">要約してほしい</SelectItem>
								<SelectItem value="clean">データ品質を確認したい</SelectItem>
								<SelectItem value="transform">JSONに変換したい</SelectItem>
								<SelectItem value="custom">自由に指定する</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="maxRows">プロンプトに含める最大行数</Label>
						<input
							id="maxRows"
							type="number"
							min="2"
							max="200"
							value={maxRows}
							onChange={(event) => {
								const val = event.target.value;
								setMaxRows(val === '' ? '' : Number(val));
							}}
							className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
						/>
					</div>
				</div>

				{task === 'custom' && (
					<div className="mt-4 space-y-2">
						<Label htmlFor="customInstruction">自由指示</Label>
						<Textarea
							id="customInstruction"
							value={customInstruction}
							onChange={(event) => setCustomInstruction(event.target.value)}
							placeholder="AIに依頼したい内容を日本語で入力してください。"
							className="min-h-20"
						/>
					</div>
				)}
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="spreadsheetInput">
						CSV / TSV / Excel貼り付けデータ
					</Label>
					<Textarea
						id="spreadsheetInput"
						value={input}
						onChange={(event) => setInput(event.target.value)}
						placeholder="Excelやスプレッドシートからコピーした表、CSV、TSVを貼り付けてください。"
						className="min-h-80 font-mono text-sm"
					/>
				</div>

				<div className="space-y-2">
					<div className="flex items-center justify-between gap-2">
						<Label htmlFor="promptOutput">生成されたプロンプト</Label>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={copyPrompt}
							disabled={!result.prompt}
						>
							<Copy className="size-4" />
							{copied ? 'コピーしました' : 'コピー'}
						</Button>
					</div>
					<Textarea
						id="promptOutput"
						value={result.prompt}
						readOnly
						placeholder="左側に表データを入力すると、AIに貼り付けやすいプロンプトが生成されます。"
						className="min-h-80 font-mono text-sm"
					/>
				</div>
			</div>

			<div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
				<p>
					検出結果: {result.rowCount}行 / {result.columnCount}列 / 区切り文字 「
					{result.detectedDelimiter === '\t' ? 'タブ' : 'カンマ'}」
				</p>
				{result.warnings.length > 0 && (
					<ul className="mt-2 list-disc space-y-1 pl-5">
						{result.warnings.map((warning) => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
