import { Download, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { downloadBlob } from '@/lib/download';
import {
	analyzeLog,
	buildCsv,
	type DiffRow,
	MAX_LINES,
	type TimeFormat,
	TOP_COUNT,
} from '@/lib/tools/log-time-analyzer';

const FORMAT_OPTIONS: { value: TimeFormat; label: string }[] = [
	{ value: 'iso', label: 'ISO 8601（Zまたはオフセット付き）' },
	{ value: 'unix-s', label: 'UNIX秒' },
	{ value: 'unix-ms', label: 'UNIXミリ秒' },
];

const PLACEHOLDERS: Record<TimeFormat, string> = {
	iso: '2026-10-06T09:00:00.000Z リクエスト受信\n[2026-10-06T18:00:01.250+09:00] 次のログ',
	'unix-s': '1790000000.123 開始\n1790000002.456 次のログ',
	'unix-ms': '1790000000123 開始\n[1790000002456] 次のログ',
};

const REVERSED_DISPLAY_LIMIT = 100;
const INVALID_DISPLAY_LIMIT = 100;

function DiffTable({
	rows,
	caption,
	testId,
}: {
	rows: DiffRow[];
	caption: string;
	testId: string;
}) {
	return (
		<div className="overflow-x-auto rounded-lg border border-border/60">
			<Table data-testid={testId}>
				<caption className="sr-only">{caption}</caption>
				<TableHeader>
					<TableRow>
						<TableHead>前の行</TableHead>
						<TableHead>前の時刻</TableHead>
						<TableHead>行</TableHead>
						<TableHead>時刻</TableHead>
						<TableHead className="text-right">差分(ms)</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((d) => (
						<TableRow key={`${d.fromLine}-${d.toLine}`}>
							<TableCell>{d.fromLine}</TableCell>
							<TableCell className="font-mono-tool break-all">
								{d.fromToken}
							</TableCell>
							<TableCell>{d.toLine}</TableCell>
							<TableCell className="font-mono-tool break-all">
								{d.toToken}
							</TableCell>
							<TableCell className="text-right font-mono-tool">
								{d.diffMs}
								{d.skippedBetween && (
									<span className="ml-1 text-xs text-muted-foreground">
										（間に解析できない行あり）
									</span>
								)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

export default function LogTimeAnalyzer() {
	const [input, setInput] = useState('');
	const [format, setFormat] = useState<TimeFormat>('iso');
	const [showAllInvalid, setShowAllInvalid] = useState(false);

	const analysis = useMemo(
		() => (input.trim() === '' ? null : analyzeLog(input, format)),
		[input, format],
	);

	const handleCsv = () => {
		if (!analysis?.ok) return;
		downloadBlob(
			new Blob([buildCsv(analysis.value.diffs)], {
				type: 'text/csv;charset=utf-8',
			}),
			'log-time-diff.csv',
		);
	};

	const value = analysis?.ok ? analysis.value : null;

	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,20rem)_1fr] sm:items-end">
				<div className="space-y-1">
					<Label htmlFor="log-time-format" className="text-sm font-medium">
						時刻の形式
					</Label>
					<select
						id="log-time-format"
						value={format}
						onChange={(e) => {
							setFormat(e.target.value as TimeFormat);
							setShowAllInvalid(false);
						}}
						className="border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
					>
						{FORMAT_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
				</div>
				<p className="text-xs text-muted-foreground">
					各行の先頭（[ ]
					で囲んでもよい）にある時刻を読み取ります。形式は自動判定しないので、ログに合わせて選択してください。
				</p>
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between gap-2">
					<Label htmlFor="log-time-input" className="text-sm font-medium">
						ログ（最大{MAX_LINES.toLocaleString('ja-JP')}行・1MiB）
					</Label>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setInput('')}
						disabled={input === ''}
					>
						<Trash2 className="mr-1 h-4 w-4" />
						クリア
					</Button>
				</div>
				<Textarea
					id="log-time-input"
					value={input}
					onChange={(e) => {
						setInput(e.target.value);
						setShowAllInvalid(false);
					}}
					placeholder={PLACEHOLDERS[format]}
					resize="vertical"
					spellCheck={false}
					wrap="off"
					className="field-sizing-fixed h-[200px] min-h-[200px] max-h-[400px] font-mono-tool text-base"
				/>
				<p className="text-xs text-muted-foreground">
					ログの内容は保存・送信されません。ここに表示される間隔はログの時刻の差であり、処理時間や障害原因を示すものではありません。
				</p>
				<p className="text-xs text-muted-foreground">
					小数はマイクロ秒精度（差分msは小数3桁）で扱い、それより細かい桁は切り捨てます。UNIX形式は0以上の数値が対象です。
				</p>
			</div>

			<div aria-live="polite" className="space-y-4">
				{analysis && !analysis.ok && (
					<Alert variant="destructive">
						<AlertDescription>{analysis.error}</AlertDescription>
					</Alert>
				)}

				{value && (
					<div className="space-y-6" data-testid="log-time-result">
						<p className="text-sm" data-testid="log-time-summary">
							全{value.totalLines}行中、解析できた行 {value.validCount}
							件・解析できない行 {value.invalidLines.length}件・空行{' '}
							{value.blankLines}件
							{value.zeroCount > 0 && `・同時刻の間隔 ${value.zeroCount}件`}
						</p>

						{value.validCount === 0 && (
							<Alert variant="destructive">
								<AlertDescription>
									解析できる行がありません。時刻の形式の選択と各行の先頭を確認してください。
								</AlertDescription>
							</Alert>
						)}
						{value.validCount === 1 && (
							<Alert>
								<AlertDescription>
									解析できた行が1件のため、時間差は計算できません。
								</AlertDescription>
							</Alert>
						)}

						{value.invalidLines.length > 0 && (
							<section aria-label="解析できない行" className="space-y-2">
								<h2 className="text-sm font-semibold">
									解析できない行（{value.invalidLines.length}件）
								</h2>
								<ul
									className="space-y-1 text-sm"
									data-testid="log-time-invalid"
								>
									{value.invalidLines
										.slice(
											0,
											showAllInvalid ? undefined : INVALID_DISPLAY_LIMIT,
										)
										.map((l) => (
											<li key={l.line}>
												{l.line}行目: {l.reason}
											</li>
										))}
								</ul>
								{value.invalidLines.length > INVALID_DISPLAY_LIMIT &&
									!showAllInvalid && (
										<Button
											variant="outline"
											size="sm"
											onClick={() => setShowAllInvalid(true)}
										>
											すべての不正行を表示（{value.invalidLines.length}件）
										</Button>
									)}
							</section>
						)}

						{value.top.length > 0 && (
							<section aria-label="間隔が大きい箇所" className="space-y-2">
								<h2 className="text-sm font-semibold">
									間隔が大きい上位{Math.min(TOP_COUNT, value.top.length)}件
								</h2>
								<p className="text-xs text-muted-foreground">
									解析可能な前の行との時刻の差です。間に解析できない行や空行がある場合は注記します。
								</p>
								<DiffTable
									rows={value.top}
									caption="間隔が大きい上位の一覧"
									testId="log-time-top"
								/>
							</section>
						)}

						{value.reversed.length > 0 && (
							<section aria-label="順序逆転" className="space-y-2">
								<h2 className="text-sm font-semibold">
									時刻が前の行より戻っている箇所（順序逆転{' '}
									{value.reversed.length}
									件）
								</h2>
								<DiffTable
									rows={value.reversed.slice(0, REVERSED_DISPLAY_LIMIT)}
									caption="順序逆転の一覧"
									testId="log-time-reversed"
								/>
								{value.reversed.length > REVERSED_DISPLAY_LIMIT && (
									<p className="text-xs text-muted-foreground">
										ほか{value.reversed.length - REVERSED_DISPLAY_LIMIT}
										件はCSVで確認できます。
									</p>
								)}
							</section>
						)}

						{value.diffs.length > 0 && (
							<Button variant="outline" size="sm" onClick={handleCsv}>
								<Download className="mr-1 h-4 w-4" />
								全間隔をCSV保存
							</Button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
