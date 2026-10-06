import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
	addRow,
	buildUrl,
	MAX_PARAMS,
	type ParamRow,
	parseUrl,
	removeRow,
	updateRow,
} from '@/lib/tools/url-parser';

function Field({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border border-border/60 bg-muted/20 p-3">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="mt-1 break-all font-mono-tool text-sm">
				{value === '' ? '（なし）' : value}
			</dd>
		</div>
	);
}

export default function UrlParser() {
	const [input, setInput] = useState('');
	const [rows, setRows] = useState<ParamRow[]>([]);

	const parsed = useMemo(() => parseUrl(input), [input]);

	const handleInput = (text: string) => {
		setInput(text);
		const result = parseUrl(text);
		setRows(result.ok ? result.value.params : []);
	};

	const built = useMemo(
		() => (parsed.ok ? buildUrl(parsed.value.baseUrl, rows) : null),
		[parsed, rows],
	);

	const handleClear = () => {
		setInput('');
		setRows([]);
	};

	const hasInput = input.trim() !== '';

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<div className="flex items-center justify-between gap-2">
					<Label htmlFor="url-parser-input" className="text-sm font-medium">
						URL
					</Label>
					<Button
						variant="ghost"
						size="sm"
						onClick={handleClear}
						disabled={input === ''}
					>
						<Trash2 className="mr-1 h-4 w-4" />
						クリア
					</Button>
				</div>
				<Textarea
					id="url-parser-input"
					value={input}
					onChange={(e) => handleInput(e.target.value)}
					placeholder="https://example.com/search?q=東京+天気&page=2#result"
					resize="vertical"
					spellCheck={false}
					className="min-h-[96px] font-mono-tool text-base"
					aria-invalid={hasInput && !parsed.ok}
					aria-describedby="url-parser-status"
				/>
				<p className="text-xs text-muted-foreground">
					入力したURLへアクセス・遷移は行いません。解析はこのブラウザ内だけで完結します。
				</p>
			</div>

			<div id="url-parser-status" aria-live="polite">
				{hasInput && !parsed.ok && (
					<Alert variant="destructive">
						<AlertDescription>{parsed.error}</AlertDescription>
					</Alert>
				)}
				{parsed.ok && parsed.value.warnings.length > 0 && (
					<Alert data-testid="url-parser-warnings">
						<AlertDescription>
							<ul className="list-disc space-y-1 pl-5">
								{[...new Set(parsed.value.warnings)].map((w) => (
									<li key={w}>{w}</li>
								))}
							</ul>
						</AlertDescription>
					</Alert>
				)}
			</div>

			{parsed.ok && (
				<>
					<section aria-label="URLの構成" className="space-y-2">
						<h2 className="text-sm font-semibold">URLの構成</h2>
						<dl
							className="grid grid-cols-1 gap-3 sm:grid-cols-2"
							data-testid="url-parser-parts"
						>
							<Field label="プロトコル" value={parsed.value.protocol} />
							<Field label="ホスト" value={parsed.value.host} />
							<Field label="パス" value={parsed.value.pathname} />
							<Field label="ハッシュ" value={parsed.value.hash} />
						</dl>
					</section>

					<section aria-label="クエリパラメータ" className="space-y-3">
						<div className="flex items-center justify-between gap-2">
							<h2 className="text-sm font-semibold">
								クエリパラメータ（{rows.length}件）
							</h2>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setRows((r) => addRow(r))}
								disabled={rows.length >= MAX_PARAMS}
							>
								<Plus className="mr-1 h-4 w-4" />
								パラメータを追加
							</Button>
						</div>
						{rows.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								クエリパラメータはありません。
							</p>
						) : (
							<ul className="space-y-2" data-testid="url-parser-rows">
								{rows.map((row, i) => (
									// 並び順が行の同一性そのもの（同じキーが重複し得る）ためindexをキーにする
									// biome-ignore lint/suspicious/noArrayIndexKey: 重複キーを許容する編集行のため
									<li key={i} className="flex items-center gap-2">
										<Input
											aria-label={`キー ${i + 1}`}
											value={row.key}
											onChange={(e) =>
												setRows((r) => updateRow(r, i, 'key', e.target.value))
											}
											spellCheck={false}
											className="font-mono-tool"
										/>
										<span aria-hidden="true">=</span>
										<Input
											aria-label={`値 ${i + 1}`}
											value={row.value}
											onChange={(e) =>
												setRows((r) => updateRow(r, i, 'value', e.target.value))
											}
											spellCheck={false}
											className="font-mono-tool"
										/>
										<Button
											variant="ghost"
											size="icon"
											aria-label={`パラメータ ${i + 1} を削除`}
											onClick={() => setRows((r) => removeRow(r, i))}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</li>
								))}
							</ul>
						)}
						<p className="text-xs text-muted-foreground">
							「+」は空白として、「%2B」は「+」として一度だけデコードします。キーも値も空の行は「=」として保持します。値はHTMLとして解釈されず、文字列としてのみ表示されます。
						</p>
					</section>

					<section aria-label="生成されたURL" className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<Label
								htmlFor="url-parser-output"
								className="text-sm font-medium"
							>
								生成されたURL
							</Label>
							<CopyButton
								text={built?.ok ? built.url : ''}
								label="URLをコピー"
								disabled={!built?.ok}
							/>
						</div>
						<Textarea
							id="url-parser-output"
							readOnly
							value={built?.ok ? built.url : ''}
							resize="vertical"
							className="min-h-[72px] font-mono-tool text-base"
						/>
						{built && !built.ok && (
							<Alert variant="destructive">
								<AlertDescription>{built.error}</AlertDescription>
							</Alert>
						)}
						<p className="text-xs text-muted-foreground">
							URL標準に沿って正規化されるため、元の表記と完全に同じ文字列になるとは限りません。
						</p>
					</section>
				</>
			)}
		</div>
	);
}
