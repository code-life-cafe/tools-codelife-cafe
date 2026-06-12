/** 入力文字数の上限。超過時はレンダリングを行わずエラーメッセージを返す */
export const MAX_INPUT_CHARS = 1_000_000;

export const INPUT_TOO_LARGE_ERROR =
	'入力が大きすぎます。100万文字以内にしてください';

/**
 * marked + GFM オプションでMarkdownをHTMLに変換する（純粋関数）。
 * サニタイズは行わないため、直接DOMに渡してはならない。renderMarkdown 経由で使用すること。
 */
export async function markdownToHtml(src: string): Promise<string> {
	const { Marked } = await import('marked');
	const marked = new Marked({
		gfm: true,
		breaks: false,
	});
	return marked.parse(src, { async: false }) as string;
}

/**
 * Markdownをサニタイズ済みHTMLへ変換する。
 *
 * - marked（GFM有効: テーブル・タスクリスト・打ち消し線・自動リンク、breaksオフ）でHTML化
 * - DOMPurifyでサニタイズ（script・iframe・イベントハンドラ属性・javascript: URLを除去）
 * - リンクには target="_blank" + rel="noopener noreferrer" を付与
 *
 * DOMPurifyはブラウザのwindowを必要とするため、Node環境（unit test）では呼び出せない。
 * Node環境向けのテストは markdownToHtml / buildStandaloneHtml を直接対象にする。
 */
export async function renderMarkdown(src: string): Promise<string> {
	if (src.length > MAX_INPUT_CHARS) {
		throw new Error(INPUT_TOO_LARGE_ERROR);
	}

	const rawHtml = await markdownToHtml(src);

	const DOMPurify = (await import('dompurify')).default;
	const purifier = DOMPurify(window);

	// 外部リンクは新規タブで開き、tabnabbing対策のrelを付与する
	purifier.addHook('afterSanitizeAttributes', (node) => {
		if (node.tagName === 'A' && node.hasAttribute('href')) {
			node.setAttribute('target', '_blank');
			node.setAttribute('rel', 'noopener noreferrer');
		}
	});

	const sanitized = purifier.sanitize(rawHtml, {
		FORBID_TAGS: ['script', 'iframe', 'style', 'object', 'embed', 'form'],
		FORBID_ATTR: ['style'],
		ALLOW_DATA_ATTR: false,
	});

	purifier.removeHook('afterSanitizeAttributes');

	return sanitized;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * ダウンロード用のスタンドアロンHTMLを生成する（純粋関数）。
 * bodyHtml は renderMarkdown によりサニタイズ済みのHTMLであることを前提とする。
 */
export function buildStandaloneHtml(bodyHtml: string, title: string): string {
	const escapedTitle = escapeHtml(title);
	return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapedTitle}</title>
<style>
  body {
    margin: 0 auto;
    max-width: 800px;
    padding: 2rem 1.5rem;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
    line-height: 1.7;
    color: #1c1917;
    background-color: #fafaf9;
    word-wrap: break-word;
  }
  h1, h2, h3, h4, h5, h6 {
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    font-weight: 600;
    line-height: 1.3;
  }
  h1 { font-size: 2em; border-bottom: 1px solid #e7e5e4; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #e7e5e4; padding-bottom: 0.3em; }
  h3 { font-size: 1.25em; }
  p, ul, ol, blockquote, table, pre { margin-top: 0; margin-bottom: 1em; }
  ul, ol { padding-left: 2em; }
  li + li { margin-top: 0.25em; }
  a { color: #1e40af; text-decoration: underline; }
  blockquote {
    margin: 0 0 1em;
    padding: 0 1em;
    color: #78716c;
    border-left: 0.25em solid #e7e5e4;
  }
  code {
    font-family: "JetBrains Mono", "Source Code Pro", monospace;
    font-size: 0.875em;
    background-color: #f5f5f4;
    border-radius: 4px;
    padding: 0.2em 0.4em;
  }
  pre {
    background-color: #f5f5f4;
    border-radius: 8px;
    padding: 1em;
    overflow: auto;
  }
  pre code {
    background-color: transparent;
    padding: 0;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    overflow: auto;
    display: block;
  }
  table th, table td {
    border: 1px solid #e7e5e4;
    padding: 0.5em 0.75em;
  }
  table th {
    background-color: #f5f5f4;
    font-weight: 600;
  }
  img { max-width: 100%; }
  hr {
    border: none;
    border-top: 1px solid #e7e5e4;
    margin: 1.5em 0;
  }
  input[type="checkbox"] {
    margin-right: 0.4em;
  }
  del { color: #78716c; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}
