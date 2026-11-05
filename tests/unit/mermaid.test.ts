import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	assertMermaidNoExternalImages,
	renderMermaidSvg,
	SAMPLE_MERMAID_CODES,
} from '../../src/lib/tools/mermaid.ts';

for (const source of [
	'https://example.com/pixel?customer=DEMO',
	'//example.com/pixel?customer=DEMO',
	'/pixel?customer=DEMO',
]) {
	test(`renderMermaidSvg: 画像構文をDOM描画前に拒否する (${source})`, async () => {
		await assert.rejects(
			renderMermaidSvg(
				`flowchart TD\n A@{ img: "${source}", label: "x", h: 20 }`,
				'privacy-test',
			),
			/外部リソース/,
		);
	});
}

for (const [name, code] of [
	[
		'行途中の %% の後にある画像',
		'flowchart TD\n A[100%%] --- B@{ img: "https://example.com/p", h: 20 }',
	],
	[
		'前行の閉じていない引用符の後にある画像',
		'flowchart TD\n accTitle: x"\n A@{ img: https://example.com/p }\n B["y"]',
	],
]) {
	test(`F1回帰: ${name}を拒否する`, async () => {
		await assert.rejects(assertMermaidNoExternalImages(code), /外部リソース/);
		// 自動修復を挟まない描画経路でも、MermaidのDOM処理より先に拒否する。
		await assert.rejects(renderMermaidSvg(code, 'f1-test'), /外部リソース/);
	});
}

for (const [name, code] of [
	[
		'単独CRでコメント行の後に現れる画像',
		'flowchart TD\n %% c\r A@{ img: "https://example.com/p" }',
	],
	[
		'タグ属性の引用符変換で現れる画像',
		'flowchart TD\n A@{ label: \'x <a b=", img: /pixel, z: "> \' }',
	],
	[
		'正規化後はラベルに隠れる生コードの画像',
		'flowchart TD\n A@{ label: "x <a b=", img: /pixel, z: "> " }',
	],
]) {
	test(`F6回帰: 事前検査で${name}を拒否する`, async () => {
		await assert.rejects(assertMermaidNoExternalImages(code), /外部リソース/);
	});
	test(`F6回帰: 描画経路で${name}をDOM処理前に拒否する`, async () => {
		await assert.rejects(renderMermaidSvg(code, 'f6-test'), /外部リソース/);
	});
}

test('F6回帰: 画像のない各図種のメタデータとCRLFコメントを許可する', async () => {
	for (const code of [
		"kanban\n todo[未着手]\n  task[作業]@{ ticket: MC-2037, assigned: 'knsv' }",
		'sequenceDiagram\n participant A@{ "type": "boundary" }\n A->>B: 問い合わせ',
		'flowchart TD\n A e1@--> B\n e1@{ animate: true }',
		'flowchart TD\r\n %% A@{ img: /pixel }\r\n A --> B',
		'flowchart TD\n A@{ shape: rect, label: "通常ノード" } --> B',
	]) {
		await assert.doesNotReject(assertMermaidNoExternalImages(code));
	}
});

test('画像キーの引用・エスケープ・複数行でも描画前に拒否する', async () => {
	for (const code of [
		'flowchart TD\n A@{ "img": "https://example.com/pixel" }',
		"flowchart TD\n A@{ 'img': '//example.com/pixel' }",
		'flowchart TD\n A@{ "\\x69mg": "https://example.com/pixel" }',
		'flowchart TD\n A@{ "\\u0069mg": "https://example.com/pixel" }',
		'flowchart TD\n A@{ "\\U00000069mg": "https://example.com/pixel" }',
		'flowchart TD\n A@{\n img: /pixel\n label: x\n }',
		'flowchart TD\n A@{ label: "}", img: /pixel }',
		'flowchart TD\n A@{ label: "行1\n行2", img: /pixel }',
		'flowchart TD\n A@{ shape: rect }\n B@{ img: /pixel }',
	]) {
		await assert.rejects(assertMermaidNoExternalImages(code), /外部リソース/);
	}
});

test('引用ラベル・説明文内でも画像構文を拒否する', async () => {
	for (const code of [
		'flowchart TD\n A["記法 @{img: /pixel} の説明"] --> B',
		'flowchart TD\n accTitle: "@{ \'img\': /pixel }"',
		'flowchart TD\n accDescr { @{ "\\x69mg": /pixel } }',
		'flowchart TD\n %%{init: {"note": "@{img: /pixel}"}}%%',
		'flowchart TD\r\n accTitle: x"\r\n A@{ img: /pixel }\r\n B["y"]',
		'flowchart TD\n A[100%%] --- B@{ "\\u0069mg": /pixel }',
	]) {
		await assert.rejects(assertMermaidNoExternalImages(code), /外部リソース/);
	}
});

test('サンプル図・画像のない拡張ノード・ラベル内のURLを許可する', async () => {
	for (const code of [
		...Object.values(SAMPLE_MERMAID_CODES).map((sample) => sample.code),
		'',
		'flowchart TD\n A@{ shape: rect, label: "通常ノード" } --> B',
		'flowchart TD\n A@{ shape: rect, label: "行1\n行2" } --> B',
		'flowchart TD\n A@{ shape: rect, label: "閉じ括弧 } とURL https://example.com/p" }',
		'flowchart TD\n A@{\n shape: rect\n label: "通常ノード"\n } --> B',
		'flowchart TD\n A@{ label: "img" } --> B@{ shape: circle }',
		'flowchart TD\n A[100%%] --- B@{ shape: rect }',
		'flowchart TD\n A["https://example.com/pixel"] --> B',
		'flowchart TD\n %% A@{img: /pixel}\n A --> B',
		'flowchart TD\r\n\t%% A@{img: /pixel}\r\n A --> B',
		'flowchart TD\n\n  \n \t%% A@{img: /pixel}\n A@{ shape: rect }',
		'flowchart TD\n A --> B\n %% A@{ img: /pixel }',
		'flowchart TD\n %%{init: {"theme": "base"}}%%\n A --> B',
	]) {
		await assert.doesNotReject(assertMermaidNoExternalImages(code));
	}
});

test('拡張ノードの不正なYAML・未閉鎖・入れ子を安全側に拒否する', async () => {
	for (const code of [
		'flowchart TD\n A@{ label: [ }',
		'flowchart TD\n A@{ img: /pixel',
		'flowchart TD\n A@{ label: "未閉鎖 }',
		'flowchart TD\n A@{ label: "@{ img: /pixel }" }',
		'flowchart TD\n A@{ label: "未閉鎖\n B@{ img: /pixel }',
	]) {
		await assert.rejects(
			assertMermaidNoExternalImages(code),
			/拡張ノードの構文/,
		);
	}
});

test('F2回帰: 未閉鎖の拡張ノードを含む100000文字を短時間で拒否する', async (t) => {
	for (const code of ['@{'.repeat(50_000), `@{${'x'.repeat(99_998)}`]) {
		assert.equal(code.length, 100_000);
		const start = performance.now();
		await assert.rejects(
			assertMermaidNoExternalImages(code),
			/拡張ノードの構文/,
		);
		const elapsed = performance.now() - start;
		t.diagnostic(`100000文字の未閉鎖入力: ${elapsed.toFixed(2)}ms`);
		assert.ok(elapsed < 1000, `検査に${elapsed.toFixed(2)}msかかった`);
	}
});

test('コメントのない大量の空行も線形走査で処理する', async (t) => {
	for (const newline of ['\n', '\r', '\u2028', '\u2029']) {
		const code = ` ${newline}`.repeat(50_000);
		const start = performance.now();
		await assert.doesNotReject(assertMermaidNoExternalImages(code));
		const elapsed = performance.now() - start;
		t.diagnostic(`100000文字の空行: ${elapsed.toFixed(2)}ms`);
		assert.ok(elapsed < 1000, `検査に${elapsed.toFixed(2)}msかかった`);
	}
});
