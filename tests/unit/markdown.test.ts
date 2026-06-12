// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/markdown.test.ts
//
// 注意: DOMPurifyによるサニタイズ（renderMarkdown）はブラウザのwindowを必要とするため
// Node環境では実行できない。サニタイズの検証は tests/e2e/markdown.spec.ts で行う。
// ここでは Node環境で実行可能な markdownToHtml / buildStandaloneHtml / 入力サイズ検証のみを対象とする。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildStandaloneHtml,
	INPUT_TOO_LARGE_ERROR,
	MAX_INPUT_CHARS,
	markdownToHtml,
	renderMarkdown,
} from '../../src/lib/tools/markdown.ts';

// ---------------------------------------------------------------------------
// 入力サイズ検証
// ---------------------------------------------------------------------------

test('renderMarkdown: 100万文字を超える入力は日本語エラーをthrowする', async () => {
	const tooLong = 'a'.repeat(MAX_INPUT_CHARS + 1);
	await assert.rejects(
		() => renderMarkdown(tooLong),
		(err: unknown) => {
			assert.ok(err instanceof Error);
			assert.equal(err.message, INPUT_TOO_LARGE_ERROR);
			return true;
		},
	);
});

test('MAX_INPUT_CHARS は100万文字', () => {
	assert.equal(MAX_INPUT_CHARS, 1_000_000);
});

// ---------------------------------------------------------------------------
// markdownToHtml（marked, GFM）
// ---------------------------------------------------------------------------

test('markdownToHtml: 見出し', async () => {
	const html = await markdownToHtml('# 見出し1\n\n## 見出し2');
	assert.match(html, /<h1>見出し1<\/h1>/);
	assert.match(html, /<h2>見出し2<\/h2>/);
});

test('markdownToHtml: リスト（順序なし・順序あり）', async () => {
	const html = await markdownToHtml('- a\n- b\n\n1. one\n2. two');
	assert.match(html, /<ul>[\s\S]*<li>a<\/li>[\s\S]*<li>b<\/li>[\s\S]*<\/ul>/);
	assert.match(
		html,
		/<ol>[\s\S]*<li>one<\/li>[\s\S]*<li>two<\/li>[\s\S]*<\/ol>/,
	);
});

test('markdownToHtml: テーブル（GFM）', async () => {
	const html = await markdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |');
	assert.match(html, /<table>/);
	assert.match(html, /<th>a<\/th>/);
	assert.match(html, /<td>1<\/td>/);
});

test('markdownToHtml: タスクリスト（GFM）', async () => {
	const html = await markdownToHtml('- [ ] 未完了\n- [x] 完了');
	assert.match(html, /<input[^>]*type="checkbox"[^>]*>\s*未完了/);
	assert.match(html, /<input[^>]*checked[^>]*type="checkbox"[^>]*>\s*完了/);
});

test('markdownToHtml: 打ち消し線（GFM strikethrough）', async () => {
	const html = await markdownToHtml('~~取り消し~~');
	assert.match(html, /<del>取り消し<\/del>/);
});

test('markdownToHtml: コードブロック', async () => {
	const html = await markdownToHtml('```js\nconst a = 1;\n```');
	assert.match(html, /<pre><code/);
	assert.match(html, /const a = 1;/);
});

test('markdownToHtml: 引用', async () => {
	const html = await markdownToHtml('> 引用文');
	assert.match(html, /<blockquote>/);
	assert.match(html, /引用文/);
});

test('markdownToHtml: リンク（自動リンクGFM含む）', async () => {
	const html = await markdownToHtml('[example](https://example.com)');
	assert.match(html, /<a href="https:\/\/example\.com">example<\/a>/);

	const autolink = await markdownToHtml('https://example.com');
	assert.match(
		autolink,
		/<a href="https:\/\/example\.com">https:\/\/example\.com<\/a>/,
	);
});

test('markdownToHtml: breaksオフのため単一改行は改行を生成しない', async () => {
	const html = await markdownToHtml('1行目\n2行目');
	assert.ok(!html.includes('<br>'), 'breaksオフでは<br>を生成しない');
	assert.match(html, /<p>1行目\n2行目<\/p>/);
});

// ---------------------------------------------------------------------------
// buildStandaloneHtml
// ---------------------------------------------------------------------------

test('buildStandaloneHtml: DOCTYPE・lang="ja"・UTF-8・bodyHtmlの埋め込み', () => {
	const html = buildStandaloneHtml('<h1>テスト</h1><p>本文</p>', 'マイ文書');
	assert.match(html, /^<!DOCTYPE html>/);
	assert.match(html, /<html lang="ja">/);
	assert.match(html, /<meta charset="UTF-8">/);
	assert.match(html, /<title>マイ文書<\/title>/);
	assert.match(html, /<h1>テスト<\/h1><p>本文<\/p>/);
});

test('buildStandaloneHtml: タイトルはHTMLエスケープされる', () => {
	const html = buildStandaloneHtml('<p>x</p>', '<script>alert(1)</script>');
	assert.ok(!html.includes('<script>alert(1)</script>'));
	assert.match(
		html,
		/<title>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/title>/,
	);
});

test('buildStandaloneHtml: 最小タイポグラフィCSSを含む', () => {
	const html = buildStandaloneHtml('<p>本文</p>', 'タイトル');
	assert.match(html, /<style>/);
	assert.match(html, /font-family/);
	assert.match(html, /table/);
});
