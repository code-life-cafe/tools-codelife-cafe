import { Download, Eye, FileCode, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { downloadBlob } from '@/lib/download';
import { buildStandaloneHtml, renderMarkdown } from '@/lib/tools/markdown';
import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 150;

const SAMPLE_MARKDOWN = `# Markdownプレビュー サンプル

これは **Markdownプレビュー** ツールのサンプルです。GFM（GitHub Flavored Markdown）に対応しています。

## リスト

- 項目A
- 項目B
  - ネストした項目
- 項目C

## タスクリスト

- [x] 設計
- [x] 実装
- [ ] レビュー

## テーブル

| 項目 | 状態 | 担当 |
| --- | --- | --- |
| 設計 | 完了 | 太郎 |
| 実装 | 完了 | 花子 |
| レビュー | 未着手 | 次郎 |

## コードブロック

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

## その他

> 引用文はこのように表示されます。

打ち消し線: ~~古い情報~~ 新しい情報

リンク: [tools.codelife.cafe](https://tools.codelife.cafe)
`;

export function MarkdownPreviewPage() {
	const [input, setInput] = useState('');
	const [html, setHtml] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [mobileTab, setMobileTab] = useState<'editor' | 'preview'>('editor');

	useEffect(() => {
		if (!input) {
			setHtml('');
			setError(null);
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			renderMarkdown(input)
				.then((result) => {
					if (cancelled) return;
					setHtml(result);
					setError(null);
				})
				.catch((err: unknown) => {
					if (cancelled) return;
					setHtml('');
					setError(err instanceof Error ? err.message : String(err));
				});
		}, DEBOUNCE_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [input]);

	const handleClear = useCallback(() => {
		setInput('');
		setHtml('');
		setError(null);
	}, []);

	const handleSample = useCallback(() => {
		setInput(SAMPLE_MARKDOWN);
	}, []);

	const handleDownload = useCallback(() => {
		if (!html) return;
		const standalone = buildStandaloneHtml(html, 'document');
		downloadBlob(
			new Blob([standalone], { type: 'text/html;charset=utf-8' }),
			'document.html',
		);
	}, [html]);

	const hasOutput = html.length > 0;

	return (
		<div className="space-y-4">
			{/* 注意事項 */}
			<div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
				<p>
					入力したテキストはサーバーに送信されません。すべてブラウザ内で処理されます。
				</p>
				<p>
					Mermaid・数式（KaTeX）・シンタックスハイライトには対応していません。外部URLの画像はプライバシー保護のため読み込みません。
				</p>
			</div>

			{/* ツールバー */}
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={handleSample}
					className="gap-1.5"
				>
					<Sparkles className="h-3.5 w-3.5" />
					サンプルMarkdown
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={handleClear}
					disabled={!input}
					className="gap-1.5"
				>
					<Trash2 className="h-3.5 w-3.5" />
					クリア
				</Button>
				{hasOutput && (
					<div className="ml-auto flex items-center gap-2">
						<CopyButton text={html} label="HTMLをコピー" />
						<Button
							variant="outline"
							size="sm"
							onClick={handleDownload}
							className="gap-1.5"
						>
							<Download className="h-3.5 w-3.5" />
							HTMLダウンロード
						</Button>
					</div>
				)}
			</div>

			{/* モバイル: タブで表示切替（エディタ・プレビューのDOMは単一インスタンス） */}
			<Tabs
				value={mobileTab}
				onValueChange={(value) => setMobileTab(value as 'editor' | 'preview')}
				className="md:hidden"
			>
				<TabsList className="w-full grid grid-cols-2">
					<TabsTrigger value="editor" className="gap-1.5">
						<FileCode className="h-3.5 w-3.5" />
						エディタ
					</TabsTrigger>
					<TabsTrigger value="preview" className="gap-1.5">
						<Eye className="h-3.5 w-3.5" />
						プレビュー
					</TabsTrigger>
				</TabsList>
			</Tabs>

			{/* デスクトップは左右分割、モバイルはタブ選択中のペインのみ表示 */}
			<div className="grid gap-4 md:grid-cols-2">
				<div
					className={cn(
						'space-y-2',
						mobileTab !== 'editor' && 'hidden md:block',
					)}
				>
					<span className="hidden md:inline text-sm font-semibold">
						Markdown入力
					</span>
					<MarkdownEditor value={input} onChange={setInput} />
				</div>
				<div
					className={cn(
						'space-y-2',
						mobileTab !== 'preview' && 'hidden md:block',
					)}
				>
					<span className="hidden md:inline text-sm font-semibold">
						プレビュー
					</span>
					<MarkdownPreviewPane html={html} error={error} />
				</div>
			</div>
		</div>
	);
}

function MarkdownEditor({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<Textarea
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder="# 見出し&#10;&#10;Markdownを入力すると右側にプレビューが表示されます。"
			className="min-h-96 font-mono text-sm resize-y"
			aria-label="Markdown入力"
		/>
	);
}

function MarkdownPreviewPane({
	html,
	error,
}: {
	html: string;
	error: string | null;
}) {
	if (error) {
		return (
			<div
				className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive min-h-96"
				role="alert"
				data-testid="markdown-error"
			>
				<p className="font-medium">エラー</p>
				<p className="mt-1">{error}</p>
			</div>
		);
	}

	return (
		<>
			<style>{MARKDOWN_PREVIEW_STYLES}</style>
			<section
				className="markdown-preview min-h-96 rounded-lg border border-border bg-muted/30 p-4 text-sm overflow-auto"
				aria-label="プレビュー"
				data-testid="markdown-preview"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown でDOMPurifyによりサニタイズ済みのHTMLのみを渡す
				dangerouslySetInnerHTML={{ __html: html }}
			/>
		</>
	);
}

// プレビュー用タイポグラフィ（自前CSS）。ダークモードは .dark クラスで切替
const MARKDOWN_PREVIEW_STYLES = `
.markdown-preview h1, .markdown-preview h2, .markdown-preview h3,
.markdown-preview h4, .markdown-preview h5, .markdown-preview h6 {
  margin-top: 1.25em;
  margin-bottom: 0.5em;
  font-weight: 600;
  line-height: 1.3;
}
.markdown-preview h1 { font-size: 1.75em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
.markdown-preview h2 { font-size: 1.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
.markdown-preview h3 { font-size: 1.2em; }
.markdown-preview h1:first-child, .markdown-preview h2:first-child,
.markdown-preview h3:first-child { margin-top: 0; }
.markdown-preview p, .markdown-preview ul, .markdown-preview ol,
.markdown-preview blockquote, .markdown-preview table, .markdown-preview pre {
  margin-top: 0;
  margin-bottom: 1em;
}
.markdown-preview ul, .markdown-preview ol { padding-left: 1.5em; }
.markdown-preview li + li { margin-top: 0.25em; }
.markdown-preview a { color: var(--primary); text-decoration: underline; }
.markdown-preview blockquote {
  margin: 0 0 1em;
  padding: 0 1em;
  color: var(--muted-foreground);
  border-left: 0.25em solid var(--border);
}
.markdown-preview code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background-color: var(--muted);
  border-radius: 4px;
  padding: 0.15em 0.4em;
}
.markdown-preview pre {
  background-color: var(--muted);
  border-radius: 8px;
  padding: 1em;
  overflow: auto;
}
.markdown-preview pre code { background-color: transparent; padding: 0; }
.markdown-preview table { border-collapse: collapse; width: 100%; display: block; overflow: auto; }
.markdown-preview table th, .markdown-preview table td {
  border: 1px solid var(--border);
  padding: 0.4em 0.7em;
}
.markdown-preview table th { background-color: var(--muted); font-weight: 600; }
.markdown-preview img { max-width: 100%; }
.markdown-preview hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
.markdown-preview input[type="checkbox"] { margin-right: 0.4em; }
.markdown-preview del { color: var(--muted-foreground); }
`;
