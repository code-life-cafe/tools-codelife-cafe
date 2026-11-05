import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	assertMermaidDiagramNoExternalImages,
	assertMermaidNoExternalImages,
	renderMermaidSvg,
	SAMPLE_MERMAID_CODES,
} from '../../src/lib/tools/mermaid.ts';

const F10_CASES = [
	[
		'単一行ディレクティブ',
		'flowchart TD\n A@%%{wrap}%%{ img: "https://example.com/pixel", label: "x", h: 20 }',
	],
	[
		'複数行ディレクティブ',
		'flowchart TD\n A@%%{wrap:\n true\n}%%{ img: "https://example.com/pixel", label: "x", h: 20 }',
	],
	[
		'画像キーも分割する複数ディレクティブ',
		'flowchart TD\n A@%%{wrap}%%{ i%%{wrap}%%mg: "/pixel" }',
	],
	[
		'単独CRのコメントに続くディレクティブ',
		'flowchart TD\n %% comment\r A@%%{wrap}%%{ img: "/pixel" }',
	],
] as const;

for (const [name, code] of F10_CASES) {
	test(`F10回帰: ${name}を文字列検査で拒否する`, async () => {
		assert.ok(!code.includes('@{'));
		await assert.rejects(assertMermaidNoExternalImages(code), /外部リソース/);
	});
	test(`F10回帰: ${name}をDOM描画前に拒否する`, async () => {
		await assert.rejects(renderMermaidSvg(code, 'f10-test'), /外部リソース/);
	});
}

test('F10回帰: Mermaid本体が解析したimgを文字列検査に依存せず拒否する', async () => {
	const { default: mermaid } = await import('mermaid');
	for (const [, code] of F10_CASES) {
		mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
		await mermaid.parse(code);
		const diagram = await mermaid.mermaidAPI.getDiagramFromText(code);
		assert.equal(diagram.type, 'flowchart-v2');
		assert.ok('getVertices' in diagram.db);
		assert.ok(typeof diagram.db.getVertices === 'function');
		const vertices: unknown = diagram.db.getVertices();
		assert.ok(vertices instanceof Map);
		assert.match(vertices.get('A').img, /pixel/);
		// 安全な文字列を渡しても拒否されることにより、DB自体の検査を確認する。
		await assert.rejects(
			assertMermaidDiagramNoExternalImages('flowchart TD\n A --> B', diagram),
			/外部リソース/,
		);
	}
});

test('描画入口は文字列検査を通った入力も実解析DBで検査し、拒否後に回復する', async (t) => {
	const { default: mermaid } = await import('mermaid');
	const api = mermaid.mermaidAPI;
	t.after(() => {
		mermaid.mermaidAPI = api;
	});
	// Mermaid本体で生成した危険なDBを返し、描画入口とDB検査の接続を確認する。
	mermaid.mermaidAPI = {
		...api,
		getDiagramFromText: () => api.getDiagramFromText(F10_CASES[0][1]),
	};
	const draw = t.mock.method(mermaid, 'render', async () => ({
		svg: '<svg/>',
	}));
	await assert.rejects(
		renderMermaidSvg('flowchart TD\n A --> B', 'parsed-image'),
		/外部リソース/,
	);
	assert.equal(draw.mock.callCount(), 0);
	mermaid.mermaidAPI = api;
	assert.deepEqual(await renderMermaidSvg('flowchart TD\n A --> B', 'safe'), {
		svg: '<svg/>',
	});
	assert.equal(draw.mock.callCount(), 1);
});

test('FlowDBのない図種は文字列検査へ戻し、flowchartの不明なDBは拒否する', async () => {
	for (const diagram of [
		undefined,
		{ type: 'class', db: {} },
		{ type: 'sequence', db: { getActors: () => new Map() } },
	]) {
		await assert.rejects(
			assertMermaidDiagramNoExternalImages(F10_CASES[0][1], diagram),
			/外部リソース/,
		);
		await assert.rejects(
			assertMermaidDiagramNoExternalImages('flowchart TD\n A@{ img:', diagram),
			/拡張ノードの構文/,
		);
		await assert.doesNotReject(
			assertMermaidDiagramNoExternalImages(
				'sequenceDiagram\n participant A@{ "type": "boundary" }',
				diagram,
			),
		);
	}
	for (const db of [
		null,
		{},
		{ getVertices: () => undefined },
		{ getVertices: () => ({ A: { img: '/pixel' } }) },
		{ getVertices: () => new Map([['A', null]]) },
	]) {
		await assert.rejects(
			assertMermaidDiagramNoExternalImages('flowchart TD\n A', {
				type: 'flowchart-v2',
				db,
			}),
			/画像検査に失敗/,
		);
	}
});

test('画像なしの実解析・描画前検査はinit、frontmatter、edge、shape、sequenceを許可する', async (t) => {
	const { default: mermaid } = await import('mermaid');
	const api = mermaid.mermaidAPI;
	t.after(() => {
		mermaid.mermaidAPI = api;
	});
	let checkedType = '';
	let checkedConfig: ReturnType<typeof api.getConfig> | undefined;
	mermaid.mermaidAPI = {
		...api,
		async getDiagramFromText(code) {
			const diagram = await api.getDiagramFromText(code);
			checkedType = diagram.type;
			checkedConfig = api.getConfig();
			return diagram;
		},
	};
	// DOM描画だけを置換する。initialize/parse/getDiagramFromTextはMermaid本体。
	const draw = t.mock.method(
		mermaid,
		'render',
		async (_id: string, code: string) => {
			assert.equal(api.getConfig().securityLevel, 'strict');
			assert.deepEqual(api.getConfig(), checkedConfig);
			assert.ok(code.includes('A'));
			return { svg: '<svg/>' };
		},
	);
	for (const [type, code] of [
		[
			'flowchart',
			'%%{init: {"flowchart":{"defaultRenderer":"dagre-d3"}, "securityLevel":"loose"}}%%\ngraph TD\n A --> B',
		],
		[
			'flowchart',
			'---\nconfig:\n  theme: dark\n  flowchart:\n    defaultRenderer: dagre-d3\n---\ngraph TD\n A --> B',
		],
		['flowchart-v2', 'flowchart TD\n A e1@--> B\n e1@{ animate: true }'],
		[
			'flowchart-v2',
			'flowchart TD\n A@{ shape: rect, label: "通常ノード" } --> B',
		],
		['flowchart-v2', 'flowchart TD\n A@{ icon: "fa:house" }'],
		[
			'sequence',
			'sequenceDiagram\n participant A@{ "type": "boundary" }\n A->>B: 問い合わせ',
		],
	]) {
		await assert.doesNotReject(renderMermaidSvg(code, 'safe-parser'));
		assert.equal(checkedType, type);
	}
	assert.equal(draw.mock.callCount(), 6);
});

test('同時描画でも初期化・解析・DB検査・描画の設定が混ざらない', async (t) => {
	const { default: mermaid } = await import('mermaid');
	const initialize = mermaid.initialize;
	const events: string[] = [];
	t.mock.method(
		mermaid,
		'initialize',
		(config: Parameters<typeof initialize>[0]) => {
			events.push(`initialize:${config.theme}`);
			initialize(config);
		},
	);
	t.mock.method(mermaid, 'render', async () => {
		const theme = mermaid.mermaidAPI.getConfig().theme;
		events.push(`render:${theme}`);
		await Promise.resolve();
		assert.equal(mermaid.mermaidAPI.getConfig().theme, theme);
		events.push(`end:${theme}`);
		return { svg: '<svg/>' };
	});
	await Promise.all([
		renderMermaidSvg('flowchart TD\n A --> B', 'light', 'default'),
		renderMermaidSvg('flowchart TD\n C --> D', 'dark', 'dark'),
	]);
	assert.deepEqual(events, [
		'initialize:default',
		'render:default',
		'end:default',
		'initialize:dark',
		'render:dark',
		'end:dark',
	]);
});

test('imgとiconの外部URLは実解析DBと文字列検査の両方で拒否する', async () => {
	const { default: mermaid } = await import('mermaid');
	for (const key of ['img', 'icon']) {
		for (const url of [
			'https://example.com/pixel',
			'//example.com/pixel',
			'/pixel',
			'./pixel',
			'pixel.png',
			'https:pixel',
			'data:image/svg+xml,test',
		]) {
			const code = `flowchart TD\n A@{ ${key}: "${url}" }`;
			await assert.rejects(assertMermaidNoExternalImages(code), /外部リソース/);
			mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
			await mermaid.parse(code);
			const diagram = await mermaid.mermaidAPI.getDiagramFromText(code);
			await assert.rejects(
				assertMermaidDiagramNoExternalImages('flowchart TD\n A', diagram),
				/外部リソース/,
			);
		}
	}
});

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
		await assert.rejects(
			renderMermaidSvg(code, 'quoted-image'),
			/外部リソース/,
		);
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
		await assert.rejects(renderMermaidSvg(code, 'label-image'), /外部リソース/);
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
