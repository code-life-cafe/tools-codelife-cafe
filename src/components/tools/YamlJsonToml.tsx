import { ArrowLeftRight, ChevronDown, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
import {
	type ConvertResult,
	convertFormats,
	FORMAT_LABEL,
	type Format,
	type Indent,
} from '@/lib/tools/yaml-json-toml';

interface Sample {
	id: string;
	label: string;
	from: Format;
	to: Format;
	text: string;
}

const SAMPLES: Sample[] = [
	{
		id: 'k8s',
		label: 'k8s ConfigMap風 YAML → JSON',
		from: 'yaml',
		to: 'json',
		text: [
			'apiVersion: v1',
			'kind: ConfigMap',
			'metadata:',
			'  name: app-config',
			'  namespace: default',
			'data:',
			'  APP_ENV: production',
			'  LOG_LEVEL: info',
			'  MAX_CONNECTIONS: "100"',
			'',
		].join('\n'),
	},
	{
		id: 'api',
		label: 'ネストしたJSON（APIレスポンス風）→ YAML',
		from: 'json',
		to: 'yaml',
		text: JSON.stringify(
			{
				user: { id: 1, name: '山田太郎', roles: ['admin', 'editor'] },
				meta: { requestId: 'abc-123', cached: false },
			},
			null,
			2,
		),
	},
	{
		id: 'cargo',
		label: 'Cargo.toml風 TOML → JSON',
		from: 'toml',
		to: 'json',
		text: [
			'[package]',
			'name = "sample-app"',
			'version = "0.1.0"',
			'edition = "2021"',
			'',
			'[dependencies]',
			'serde = "1.0"',
			'tokio = { version = "1", features = ["full"] }',
			'',
		].join('\n'),
	},
];

const FORMAT_OPTIONS: Format[] = ['yaml', 'json', 'toml'];

function formatErrorLine(result: ConvertResult | null): string | null {
	if (!result || result.ok) return null;
	const location =
		result.row != null
			? result.col != null
				? `L${result.row}:C${result.col}`
				: `L${result.row}`
			: null;
	return location ? `${location} — ${result.error}` : result.error;
}

export default function YamlJsonToml() {
	const { trackRun } = useToolAnalytics('yaml-json-toml');
	const [from, setFrom] = useState<Format>('yaml');
	const [to, setTo] = useState<Format>('json');
	const [input, setInput] = useState('');
	const [indent, setIndent] = useState<Indent>(2);
	const [sortKeys, setSortKeys] = useState(false);
	const [result, setResult] = useState<ConvertResult | null>(null);
	const [sampleSelectValue, setSampleSelectValue] = useState('');

	const convert = useCallback(() => {
		if (!input.trim()) {
			setResult(null);
			return;
		}
		const converted = convertFormats(from, to, input, { indent, sortKeys });
		setResult(converted);
		if (converted.ok) trackRun();
	}, [input, from, to, indent, sortKeys, trackRun]);

	// 自動変換（250msデバウンス）
	useEffect(() => {
		const timer = setTimeout(convert, 250);
		return () => clearTimeout(timer);
	}, [convert]);

	const handleSwap = useCallback(() => {
		setInput((prevInput) => (result?.ok ? result.output : prevInput));
		setFrom(to);
		setTo(from);
		setResult(null);
	}, [from, to, result]);

	const handleSample = useCallback((sampleId: string) => {
		const sample = SAMPLES.find((s) => s.id === sampleId);
		if (!sample) return;
		setFrom(sample.from);
		setTo(sample.to);
		setInput(sample.text);
		setSampleSelectValue('');
	}, []);

	const handleClear = useCallback(() => {
		setInput('');
		setResult(null);
	}, []);

	const output = result?.ok ? result.output : '';
	const errorLine = formatErrorLine(result);
	const fromLabel = FORMAT_LABEL[from];
	const toLabel = FORMAT_LABEL[to];

	return (
		<div className="space-y-4">
			{/* 変換方向・オプション */}
			<div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
				<div className="flex items-end gap-2">
					<div className="space-y-1.5">
						<Label className="text-xs text-muted-foreground">From</Label>
						<Select value={from} onValueChange={(v) => setFrom(v as Format)}>
							<SelectTrigger aria-label="変換元の形式" className="w-[110px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{FORMAT_OPTIONS.map((f) => (
									<SelectItem key={f} value={f}>
										{FORMAT_LABEL[f]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<Button
						variant="outline"
						size="icon"
						onClick={handleSwap}
						aria-label="From/Toと入力/出力を入れ替え"
						className="mb-0.5"
					>
						<ArrowLeftRight className="h-4 w-4" />
					</Button>
					<div className="space-y-1.5">
						<Label className="text-xs text-muted-foreground">To</Label>
						<Select value={to} onValueChange={(v) => setTo(v as Format)}>
							<SelectTrigger aria-label="変換先の形式" className="w-[110px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{FORMAT_OPTIONS.map((f) => (
									<SelectItem key={f} value={f}>
										{FORMAT_LABEL[f]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				<div className="ml-auto flex items-end gap-4">
					<div className="space-y-1.5">
						<Label className="text-xs text-muted-foreground">インデント</Label>
						<Select
							value={String(indent)}
							onValueChange={(v) => setIndent(Number(v) as Indent)}
						>
							<SelectTrigger aria-label="インデント幅" className="w-[110px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="2">2スペース</SelectItem>
								<SelectItem value="4">4スペース</SelectItem>
								<SelectItem value="0">コンパクト</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="flex items-center gap-2 pb-2">
						<Switch
							id="opt-sort-keys"
							checked={sortKeys}
							onCheckedChange={setSortKeys}
						/>
						<Label htmlFor="opt-sort-keys" className="text-sm cursor-pointer">
							キーソート
						</Label>
					</div>
				</div>
			</div>

			{from === to && (
				<p className="text-xs text-muted-foreground">
					From/Toが同じ形式のため、整形（インデント・キーソート適用）のみ行います。
				</p>
			)}

			{/* 入力 / 出力 2ペイン */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div className="space-y-2">
					<div className="flex items-center justify-between min-h-8">
						<span className="text-sm font-semibold">{fromLabel} 入力</span>
					</div>
					<Textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={`${fromLabel}を入力してください`}
						className="min-h-64 font-mono text-sm"
						aria-label={`${fromLabel}入力`}
						spellCheck={false}
					/>
				</div>
				<div className="space-y-2">
					<div className="flex items-center justify-between min-h-8 gap-2">
						<span className="text-sm font-semibold">{toLabel} 出力</span>
						{result?.ok && result.output && (
							<CopyButton text={output} size="sm" />
						)}
					</div>
					{result && !result.ok ? (
						<div
							className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive min-h-64"
							role="alert"
							data-testid="yaml-json-toml-error"
						>
							<p className="font-medium">変換エラー</p>
							<p className="mt-1">{errorLine}</p>
						</div>
					) : (
						<Textarea
							value={output}
							readOnly
							placeholder={`変換結果（${toLabel}）がここに表示されます`}
							className="min-h-64 font-mono text-sm bg-muted/30"
							aria-label={`${toLabel}出力`}
							spellCheck={false}
						/>
					)}
					{result?.ok && result.note && (
						<p className="text-xs text-muted-foreground">{result.note}</p>
					)}
				</div>
			</div>

			{/* サンプル・クリア */}
			<div className="flex flex-wrap items-center gap-2">
				<Select value={sampleSelectValue} onValueChange={handleSample}>
					<SelectTrigger aria-label="サンプルを読み込み" className="w-[260px]">
						<div className="flex items-center gap-1.5">
							<Sparkles className="h-3.5 w-3.5" />
							<SelectValue placeholder="サンプル" />
						</div>
					</SelectTrigger>
					<SelectContent>
						{SAMPLES.map((sample) => (
							<SelectItem key={sample.id} value={sample.id}>
								{sample.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button variant="outline" size="sm" onClick={handleClear}>
					クリア
				</Button>
			</div>

			{/* 変換ポリシーの注意事項 */}
			<Collapsible>
				<CollapsibleTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						className="gap-1 text-muted-foreground"
					>
						<ChevronDown className="h-3.5 w-3.5" />
						変換に関する注意事項
					</Button>
				</CollapsibleTrigger>
				<CollapsibleContent className="mt-2 rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1.5">
					<p>・YAMLのコメントは変換後に失われます。</p>
					<p>
						・YAMLのアンカー（&amp;）・エイリアス（*）は展開され、具体的な値に置き換わります。
					</p>
					<p>
						・TOMLはルート要素に配列を使用できません。JSON/YAMLの配列はTOMLへ変換できません。
					</p>
					<p>
						・TOMLはnull値に対応していません。null値を含むデータはTOMLへ変換できません。
					</p>
					<p>
						・TOMLの日時型はJSON/YAMLへの変換時にISO
						8601形式の文字列になります（往復すると型情報は失われます）。
					</p>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}
