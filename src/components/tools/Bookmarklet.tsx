import { ChevronDown, GripVertical, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
import {
	type Direction,
	decodeBookmarklet,
	detectDirection,
	encodeBookmarklet,
} from '@/lib/tools/bookmarklet';

type DirectionMode = 'auto' | Direction;

interface Sample {
	id: string;
	label: string;
	code: string;
}

const SAMPLES: Sample[] = [
	{
		id: 'dark-mode',
		label: 'ダークモード切替',
		code: "document.documentElement.style.filter='invert(1) hue-rotate(180deg)'",
	},
	{
		id: 'link-list',
		label: 'ページ内リンク一覧',
		code: "Array.from(document.querySelectorAll('a')).map(a=>a.href).join('\\n')",
	},
	{
		id: 'get-selection',
		label: '選択テキスト取得',
		code: 'alert(window.getSelection().toString())',
	},
];

const DIRECTION_LABEL: Record<DirectionMode, string> = {
	auto: 'Auto',
	encode: 'Encode',
	decode: 'Decode',
};

type ConvertResult =
	| { ok: true; output: string }
	| { ok: false; error: string };

const DEBOUNCE_MS = 200;

export default function Bookmarklet() {
	const { trackRunDebounced } = useToolAnalytics('bookmarklet');
	const [directionMode, setDirectionMode] = useState<DirectionMode>('auto');
	const [input, setInput] = useState('');
	const [iife, setIife] = useState(true);
	const [minify, setMinify] = useState(false);
	const [externalScriptUrl, setExternalScriptUrl] = useState('');
	const [result, setResult] = useState<ConvertResult | null>(null);
	const [sampleSelectValue, setSampleSelectValue] = useState('');

	const effectiveDirection: Direction = useMemo(
		() => (directionMode === 'auto' ? detectDirection(input) : directionMode),
		[directionMode, input],
	);

	const convert = useCallback(() => {
		if (!input.trim()) {
			setResult(null);
			return;
		}
		const converted =
			effectiveDirection === 'encode'
				? encodeBookmarklet(input, {
						iife,
						minify,
						externalScriptUrl,
					})
				: decodeBookmarklet(input, { beautify: true });
		setResult(converted);
		if (converted.ok) trackRunDebounced();
	}, [
		input,
		effectiveDirection,
		iife,
		minify,
		externalScriptUrl,
		trackRunDebounced,
	]);

	// 自動変換（200msデバウンス）
	useEffect(() => {
		const timer = setTimeout(convert, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [convert]);

	const handleSample = useCallback((sampleId: string) => {
		const sample = SAMPLES.find((s) => s.id === sampleId);
		if (!sample) return;
		setDirectionMode('auto');
		setInput(sample.code);
		setSampleSelectValue('');
	}, []);

	const handleClear = useCallback(() => {
		setInput('');
		setResult(null);
	}, []);

	const output = result?.ok ? result.output : '';
	const errorMessage = result && !result.ok ? result.error : null;
	const inputLabel =
		effectiveDirection === 'encode' ? 'JavaScript 入力' : 'Bookmarklet 入力';
	const outputLabel =
		effectiveDirection === 'encode' ? 'Bookmarklet 出力' : 'JavaScript 出力';

	return (
		<div className="space-y-4">
			{/* 方向・オプション */}
			<div className="flex flex-wrap items-end gap-4 rounded-lg border border-border p-4">
				<div className="space-y-1.5">
					<Label className="text-xs text-muted-foreground">方向</Label>
					<Select
						value={directionMode}
						onValueChange={(v) => setDirectionMode(v as DirectionMode)}
					>
						<SelectTrigger aria-label="変換方向" className="w-[110px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(['auto', 'encode', 'decode'] as DirectionMode[]).map((d) => (
								<SelectItem key={d} value={d}>
									{DIRECTION_LABEL[d]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="flex items-center gap-2 pb-2">
					<Switch id="opt-iife" checked={iife} onCheckedChange={setIife} />
					<Label htmlFor="opt-iife" className="text-sm cursor-pointer">
						IIFEラップ
					</Label>
				</div>

				<div className="flex items-center gap-2 pb-2">
					<Switch
						id="opt-minify"
						checked={minify}
						onCheckedChange={setMinify}
					/>
					<Label htmlFor="opt-minify" className="text-sm cursor-pointer">
						Minify
					</Label>
				</div>

				{effectiveDirection === 'encode' && (
					<div className="space-y-1.5 flex-1 min-w-[220px]">
						<Label
							htmlFor="external-script-url"
							className="text-xs text-muted-foreground"
						>
							外部スクリプトURL（任意）
						</Label>
						<Input
							id="external-script-url"
							type="url"
							value={externalScriptUrl}
							onChange={(e) => setExternalScriptUrl(e.target.value)}
							placeholder="https://example.com/script.js"
						/>
					</div>
				)}
			</div>

			{/* 入力 / 出力 2ペイン */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div className="space-y-2">
					<div className="flex items-center justify-between min-h-8">
						<span className="text-sm font-semibold">{inputLabel}</span>
					</div>
					<Textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={
							effectiveDirection === 'encode'
								? "JavaScriptコードを入力してください（例: alert('hello')）"
								: 'javascript: から始まるbookmarkletを貼り付けてください'
						}
						className="min-h-64 font-mono text-sm"
						aria-label={inputLabel}
						spellCheck={false}
					/>
				</div>
				<div className="space-y-2">
					<div className="flex items-center justify-between min-h-8 gap-2">
						<span className="text-sm font-semibold">{outputLabel}</span>
						{result?.ok && output && <CopyButton text={output} size="sm" />}
					</div>
					{errorMessage ? (
						<div
							className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive min-h-64"
							role="alert"
							data-testid="bookmarklet-error"
						>
							<p className="font-medium">変換エラー</p>
							<p className="mt-1">{errorMessage}</p>
						</div>
					) : (
						<Textarea
							value={output}
							readOnly
							placeholder={`変換結果（${outputLabel}）がここに表示されます`}
							className="min-h-64 font-mono text-sm bg-muted/30"
							aria-label={outputLabel}
							spellCheck={false}
						/>
					)}
				</div>
			</div>

			{/* サンプル・クリア */}
			<div className="flex flex-wrap items-center gap-2">
				<Select value={sampleSelectValue} onValueChange={handleSample}>
					<SelectTrigger aria-label="サンプルを読み込み" className="w-[220px]">
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

			{/* ドラッグ&ドロップインストール（エンコード成功時のみ） */}
			{effectiveDirection === 'encode' && result?.ok && (
				<div className="rounded-lg border border-dashed border-primary/50 bg-primary/5 p-4">
					<p className="text-sm text-muted-foreground mb-2">
						下のリンクをブラウザのブックマークバーへドラッグ&ドロップすると、ブックマークレットとして登録できます。
					</p>
					{/* biome-ignore lint/security/noScriptUrl: bookmarklet変換ツールの本質的な出力（javascript: URL）であり、ユーザー自身が入力したコードをそのままリンク化している */}
					<a
						href={result.output}
						draggable
						onClick={(e) => e.preventDefault()}
						className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-background px-3 py-2 text-sm font-medium text-primary shadow-xs cursor-grab active:cursor-grabbing select-none"
					>
						<GripVertical className="h-4 w-4" aria-hidden="true" />📎
						ブックマークに追加
					</a>
				</div>
			)}

			{/* 注意事項 */}
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
					<p>
						・エンコード時にJavaScriptの構文チェックは行いません。事前に他のツールやブラウザのコンソールで動作確認してください。
					</p>
					<p>
						・Minifyは安全な範囲（コメント削除・空白圧縮）に留めています。正規表現リテラル中の
						<code className="mx-1">{'//'}</code>
						など、複雑なコードでは意図しない結果になる場合があります。
					</p>
					<p>
						・整形（Beautify）は簡易的なもので、複雑なコードでは不十分な場合があります。
					</p>
					<p>
						・外部スクリプトは非同期に読み込まれます。読み込み完了を待つ必要がある場合は、ユーザーコード側でonloadコールバック等を実装してください。
					</p>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}
