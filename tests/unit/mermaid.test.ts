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

test('画像キーの引用・エスケープ・複数行でも描画前に拒否する', () => {
	for (const code of [
		'flowchart TD\n A@{ "img": "https://example.com/pixel" }',
		"flowchart TD\n A@{ 'img': '//example.com/pixel' }",
		'flowchart TD\n A@{ "\\x69mg": "https://example.com/pixel" }',
		'flowchart TD\n A@{\n img: /pixel\n label: x\n }',
		'flowchart TD\n A@{ label: "}", img: /pixel }',
		'flowchart TD\n A@{ label: "行1\n行2", img: /pixel }',
		'flowchart TD\n A@{ shape: rect }\n B@{ img: /pixel }',
	]) {
		assert.throws(() => assertMermaidNoExternalImages(code), /外部リソース/);
	}
});

test('サンプル図・画像のない拡張ノード・ラベル内のURLを許可する', () => {
	for (const code of [
		...Object.values(SAMPLE_MERMAID_CODES).map((sample) => sample.code),
		'',
		'flowchart TD\n A@{ shape: rect, label: "通常ノード" } --> B',
		'flowchart TD\n A@{ shape: rect, label: "行1\n行2" } --> B',
		'flowchart TD\n A["https://example.com/pixel"] --> B',
		'flowchart TD\n A["記法 @{img: /pixel} の説明"] --> B',
		'flowchart TD\n %% A@{img: /pixel}\n A --> B',
	]) {
		assert.doesNotThrow(() => assertMermaidNoExternalImages(code));
	}
});

test('拡張ノードの不正なYAMLは描画前に日本語エラーにする', () => {
	assert.throws(
		() => assertMermaidNoExternalImages('flowchart TD\n A@{ label: [ }'),
		/拡張ノードの構文/,
	);
});
