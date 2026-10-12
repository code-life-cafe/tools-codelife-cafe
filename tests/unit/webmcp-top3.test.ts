import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { maskingMcpTool } from '../../src/lib/tools/masking.mcp.ts';
import {
	mermaidMcpTool,
	mermaidRenderMcpTool,
} from '../../src/lib/tools/mermaid.mcp.ts';
import { assertMermaidRenderBudget } from '../../src/lib/tools/mermaid-render-budget.ts';
import { yamlJsonTomlMcpTool } from '../../src/lib/tools/yaml-json-toml.mcp.ts';
import { generateWebMcpDescriptor } from '../../src/lib/webmcp/descriptor-generator.ts';
import { provideToolsFromFactory } from '../../src/lib/webmcp.ts';

const mermaid = generateWebMcpDescriptor(mermaidMcpTool);
const formats = generateWebMcpDescriptor(yamlJsonTomlMcpTool);
const masking = generateWebMcpDescriptor(maskingMcpTool);

test('Mermaid: 100000文字の未完構文7種を5秒以内に修復する（隔離プロセス）', () => {
	const tool = new URL('../../src/lib/tools/mermaid.mcp.ts', import.meta.url)
		.href;
	const generator = new URL(
		'../../src/lib/webmcp/descriptor-generator.ts',
		import.meta.url,
	).href;
	const script = `import { mermaidMcpTool } from ${JSON.stringify(tool)}; import { generateWebMcpDescriptor } from ${JSON.stringify(generator)}; const d=generateWebMcpDescriptor(mermaidMcpTool); for (const text of ['A［'.repeat(50000), 'A（'.repeat(50000), 'A｛'.repeat(50000), '｛'.repeat(100000), 'A'+'　'.repeat(99998)+'B', 'ー'.repeat(100000), String.fromCharCode(92,34).repeat(50000)]) { const r=await d.run({text}); if (!r.ok) process.exit(1); }`;
	execFileSync(process.execPath, ['--input-type=module', '-e', script], {
		timeout: 5000,
	});
});

test('形式変換: ソート時も予約名キーをデータとして保持する', async () => {
	const text =
		'{"__proto__":{"polluted":true},"constructor":2,"prototype":3,"a":{"__proto__":4}}';
	const result = await formats.run({
		text,
		from: 'json',
		to: 'json',
		sortKeys: true,
	});
	assert.ok(result.ok);
	assert.deepEqual(JSON.parse(result.value.output), JSON.parse(text));
	assert.equal(
		Object.hasOwn(JSON.parse(result.value.output), '__proto__'),
		true,
	);
	assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});

test('Mermaid: ラベルの&と比較文字は許可し並列リンクとHTMLは拒否する', () => {
	for (const text of [
		'flowchart TD\nA[研究開発 R&D] --> B[完了]',
		'flowchart TD\nA[x < y] --> B[z]',
		'flowchart TD\nA["R&D"] --> B[完了]',
		'sequenceDiagram\nA->>B:研究開発 R&D',
		'flowchart TD\nA -->|R&D| B',
		'flowchart TD\nA -- R&D --> B',
		'sequenceDiagram\nparticipant A as R&D\nA->>B:x',
		'sequenceDiagram\nalt R&D\nA->>B:x\nend',
		`sequenceDiagram\nalt ${'->'.repeat(51)}\nA->>B:x\nend`,
		`flowchart TD\n%% R&D ${'-->'.repeat(51)}\nA --> B`,
		'flowchart TD\nA --> B %% R&D <img src="x"> @{ ![ `',
		'flowchart TD\nA["%% R&D"] --> B',
		'flowchart TD\nA>研究開発 R&D] --> B',
		'flowchart TD\nA["user@{home} ![literal]"] --> B',
	])
		assert.doesNotThrow(() => assertMermaidRenderBudget(text));
	for (const text of [
		'flowchart TD\nA & B --> C',
		'flowchart TD\nA[<img src="x">]',
		'flowchart TD\nA@{shape: rect}',
	])
		assert.throws(() => assertMermaidRenderBudget(text));
});

test('Mermaid: フェンス除去・全角矢印修復と形状保持', async () => {
	const result = await mermaid.run({
		text: '```mermaid\nflowchart TD\nA((開始)) → B[[処理]]\n```',
	});
	assert.ok(result.ok);
	assert.match(result.value.code, /A\(\(開始\)\) --> B\[\[処理\]\]/);
	assert.equal(result.value.modified, true);
	assert.equal(result.value.svg, '');
	assert.ok(result.value.changes.length > 0);
});
test('Mermaid: 修復のみは構文検証を装わない', async () => {
	const result = await mermaid.run({ text: 'not a diagram' });
	assert.ok(result.ok);
	assert.equal(result.value.code, 'not a diagram');
	assert.equal(result.value.modified, false);
});
test('形式変換: 全6方向で値を維持、既定値とキーソート', async () => {
	const sources = {
		yaml: 'b: 2\na: 日本語',
		json: '{"b":2,"a":"日本語"}',
		toml: 'b = 2\na = "日本語"',
	};
	for (const from of ['yaml', 'json', 'toml'] as const) {
		for (const to of ['yaml', 'json', 'toml'] as const) {
			const result = await formats.run({
				text: sources[from],
				from,
				to,
				sortKeys: true,
			});
			assert.ok(result.ok);
			const back = await formats.run({
				text: result.value.output,
				from: to,
				to: 'json',
				indent: '0',
			});
			assert.ok(back.ok);
			assert.equal(back.value.output, '{"a":"日本語","b":2}');
		}
	}
});
test('形式変換: 構文エラー・TOMLのnullと配列制約', async () => {
	for (const text of ['{', '{"a":null}', '[1,2]']) {
		const result = await formats.run({ text, from: 'json', to: 'toml' });
		assert.equal(result.ok, false);
	}
	const result = await formats.run({
		text: 'a = 1',
		from: 'toml',
		to: 'toml',
		indent: '0',
	});
	assert.ok(result.ok);
	assert.match(result.value.note, /コンパクト/);
});
test('マスキング: 既定は全体伏字、元データを結果に含めない', async () => {
	const result = await masking.run({
		text: 'mail: alice@example.com 電話: 090-1234-5678',
	});
	assert.ok(result.ok);
	assert.doesNotMatch(JSON.stringify(result.value), /alice|example|090-1234/);
	assert.equal(result.value.counts.email, 1);
	assert.equal(result.value.counts.phone, 1);
	assert.match(result.value.warning, /漏れ/);
});
test('マスキング: 対象選択・部分伏字・黒丸', async () => {
	const result = await masking.run({
		text: 'alice@example.com 090-1234-5678',
		email: false,
		strength: 'partial',
		maskChar: '●',
	});
	assert.ok(result.ok);
	assert.equal(result.value.maskedText, 'alice@example.com 090-●●●●-5678');
	assert.equal(result.value.counts.email, 0);
});
test('3件: 必須値・型・列挙値・入力上限を拒否', async () => {
	for (const tool of [mermaid, formats, masking]) {
		assert.equal((await tool.run({})).ok, false);
		assert.equal((await tool.run({ text: 123 })).ok, false);
		assert.equal(
			(await tool.run({ text: 'a'.repeat(100_001), from: 'json', to: 'yaml' }))
				.ok,
			false,
		);
	}
	assert.equal(
		(
			await generateWebMcpDescriptor(mermaidRenderMcpTool).run({
				text: 'x',
				autoRepair: 'yes',
			})
		).ok,
		false,
	);
	assert.equal(
		(await formats.run({ text: '{}', from: 'json', to: 'yaml', indent: '3' }))
			.ok,
		false,
	);
	assert.equal((await masking.run({ text: 'x', strength: 'safe' })).ok, false);
	assert.equal((await masking.run({ text: 'x', email: 'true' })).ok, false);
	assert.equal((await mermaid.run({ text: ' ' })).ok, false);
});

for (const api of ['document', 'navigator'] as const) {
	test(`3件: ${api}登録経路で実行し、解除する`, async () => {
		const keys = ['window', 'document', 'navigator'] as const;
		const descriptors = keys.map((key) =>
			Object.getOwnPropertyDescriptor(globalThis, key),
		);
		const tools: {
			name: string;
			execute: (input: unknown) => Promise<unknown>;
		}[] = [];
		let disposed = false;
		try {
			Object.defineProperty(globalThis, 'window', {
				configurable: true,
				value: {},
			});
			Object.defineProperty(globalThis, 'document', {
				configurable: true,
				value:
					api === 'document'
						? {
								modelContext: {
									registerTool(
										tool: (typeof tools)[number],
										options: { signal: AbortSignal },
									) {
										tools.push(tool);
										options.signal.addEventListener('abort', () => {
											disposed = true;
										});
										return Promise.resolve();
									},
								},
							}
						: {},
			});
			Object.defineProperty(globalThis, 'navigator', {
				configurable: true,
				value:
					api === 'navigator'
						? {
								modelContext: {
									provideContext(context: { tools: typeof tools }) {
										tools.push(...context.tools);
										return {
											dispose() {
												disposed = true;
											},
										};
									},
								},
							}
						: {},
			});
			const cleanup = provideToolsFromFactory([mermaid, formats, masking]);
			assert.equal(tools.length, 3);
			const mask = tools.find(
				(tool) => tool.name === 'mask_personal_information',
			);
			assert.ok(mask);
			const result = (await mask.execute({ text: 'alice@example.com' })) as {
				maskedText: string;
			};
			assert.equal(result.maskedText, '*'.repeat(17));
			const error = (await mask.execute({ text: 1 })) as { isError: boolean };
			assert.equal(error.isError, true);
			cleanup();
			assert.equal(disposed, true);
		} finally {
			for (const [index, key] of keys.entries()) {
				const descriptor = descriptors[index];
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
		}
	});
}

test('3件の公開スキーマ: 100000文字上限と全省略値を明示する', () => {
	for (const [definition, descriptor] of [
		[mermaidMcpTool, mermaid],
		[yamlJsonTomlMcpTool, formats],
		[maskingMcpTool, masking],
	] as const) {
		const properties = descriptor.inputSchema.properties as Record<
			string,
			Record<string, unknown>
		>;
		assert.equal(properties.text.maxLength, 100_000);
		for (const [key, param] of Object.entries(definition.params)) {
			if (param.required === false)
				assert.equal(properties[key].default, param.default);
		}
	}
});

test('3件: astral文字も1文字として100000文字まで受理し超過を拒否', async () => {
	const limit = 100_000;
	const diagramPrefix = 'flowchart TD\nA["';
	const diagramSuffix = '"]';
	const jsonPrefix = '{"text":"';
	const jsonSuffix = '"}';
	const diagram =
		diagramPrefix +
		'😀'.repeat(limit - diagramPrefix.length - diagramSuffix.length) +
		diagramSuffix;
	const json =
		jsonPrefix +
		'😀'.repeat(limit - jsonPrefix.length - jsonSuffix.length) +
		jsonSuffix;
	const repaired = await mermaid.run({ text: diagram });
	assert.ok(repaired.ok);
	assert.equal(repaired.value.code, diagram);
	const converted = await formats.run({
		text: json,
		from: 'json',
		to: 'json',
		indent: '0',
	});
	assert.ok(converted.ok);
	assert.equal(converted.value.output, json);
	const masked = await masking.run({ text: '😀'.repeat(limit) });
	assert.ok(masked.ok);
	assert.equal(masked.value.maskedText, '😀'.repeat(limit));
	for (const tool of [mermaid, formats, masking]) {
		const rejected = await tool.run({
			text: '😀'.repeat(limit + 1),
			from: 'json',
			to: 'json',
		});
		assert.equal(rejected.ok, false);
	}
});

test('形式変換: YAML alias増幅・循環をシリアライズ前に拒否しリテラルは許可', async () => {
	const aliases = 'a: &a [x, x, x]\nb: &b [*a, *a, *a]\nc: [*b, *b, *b]';
	for (const text of [aliases, 'a: &a [*a]']) {
		const result = await formats.run({ text, from: 'yaml', to: 'json' });
		assert.equal(result.ok, false);
	}
	const literal = await formats.run({
		text: 'text: "*a"',
		from: 'yaml',
		to: 'json',
	});
	assert.ok(literal.ok);
	assert.deepEqual(JSON.parse(literal.value.output), { text: '*a' });
});
test('形式変換: ノード数と深さをシリアライズ前に制限する', async () => {
	const result = await formats.run({
		text: JSON.stringify(Array(10_001).fill(0)),
		from: 'json',
		to: 'yaml',
	});
	assert.equal(result.ok, false);
	const deep = `${'{"a":'.repeat(52)}0${'}'.repeat(52)}`;
	assert.equal(
		(await formats.run({ text: deep, from: 'json', to: 'json' })).ok,
		false,
	);
});
test('マスキング: 100000文字の非メール入力を5秒以内に処理する（隔離プロセス）', () => {
	const url = new URL('../../src/lib/tools/masking.mcp.ts', import.meta.url)
		.href;
	const generator = new URL(
		'../../src/lib/webmcp/descriptor-generator.ts',
		import.meta.url,
	).href;
	const script = `import { maskingMcpTool } from ${JSON.stringify(url)}; import { generateWebMcpDescriptor } from ${JSON.stringify(generator)}; const text = 'a'.repeat(100000); const result = await generateWebMcpDescriptor(maskingMcpTool).run({text}); if (!result.ok || result.value.maskedText !== text || result.value.counts.email !== 0) process.exit(1);`;
	execFileSync(process.execPath, ['--input-type=module', '-e', script], {
		timeout: 5000,
	});
});

test('形式変換: 深いYAMLブロック文字列の巨大出力を生成前に拒否', async () => {
	const text = `${'{"a":'.repeat(40)}${JSON.stringify('\n'.repeat(40_000))}${'}'.repeat(40)}`;
	const result = await formats.run({
		text,
		from: 'json',
		to: 'yaml',
		indent: '4',
	});
	assert.equal(result.ok, false);
	if (!result.ok) assert.match(result.error, /出力見積もり/);
	const normal = await formats.run({
		text: JSON.stringify({ text: 'a\nb\nc' }),
		from: 'json',
		to: 'yaml',
	});
	assert.ok(normal.ok);
});

test('Mermaid: 描画は別スキーマで5000文字に限定し大きなsequenceを拒否', async () => {
	const renderer = generateWebMcpDescriptor(mermaidRenderMcpTool);
	const properties = renderer.inputSchema.properties as Record<
		string,
		Record<string, unknown>
	>;
	assert.equal(properties.text.maxLength, 5000);
	const big = `sequenceDiagram\n${'A->>B:x\n'.repeat(6247)}`;
	assert.equal((await renderer.run({ text: big })).ok, false);
	const many = `sequenceDiagram\n${'A->>B:x\n'.repeat(51)}`;
	assert.equal((await renderer.run({ text: many })).ok, false);
	assert.ok((await mermaid.run({ text: big })).ok);
});
test('Mermaid: 50文を超えるインライン図と予算回避の設定・並列記法を拒否', async () => {
	const renderer = generateWebMcpDescriptor(mermaidRenderMcpTool);
	for (const text of [
		`graph TD;${'A-->B;'.repeat(51)}`,
		'%%{init: {"maxEdges":99999}}%%\ngraph TD\nA-->B',
		'graph TD\nA & B --> C & D',
		'graph TD\nA[<img src="x">]',
	]) {
		assert.equal((await renderer.run({ text })).ok, false);
	}
});

test('Mermaid: 1文内のエッジ過多も描画器に入る前に拒否', async () => {
	assert.throws(
		() =>
			assertMermaidRenderBudget(
				`flowchart TD\n${Array.from({ length: 52 }, (_, i) => `A${i}[x]`).join('-->')}`,
			),
		/50エッジ/,
	);
	assert.throws(
		() =>
			assertMermaidRenderBudget(
				`flowchart TD\nA -- ${`${'x'.repeat(95)}#59;`.repeat(48)} --> B`,
			),
		/200文字/,
	);
	assert.doesNotThrow(() =>
		assertMermaidRenderBudget(`flowchart TD\nA["${'項目;'.repeat(50)}"]`),
	);
	assert.throws(
		() =>
			assertMermaidRenderBudget(`flowchart TD\nA["${'項目;'.repeat(100)}"]`),
		/200文字/,
	);
	assert.doesNotThrow(() =>
		assertMermaidRenderBudget(
			`flowchart TD\n${Array.from({ length: 26 }, (_, i) => `A${i}[left-->right and up-->down]`).join('\n')}`,
		),
	);
	const chain = Array.from({ length: 52 }, (_, index) => `A${index}`).join(
		'-->',
	);
	const result = await generateWebMcpDescriptor(mermaidRenderMcpTool).run({
		text: `graph TD\n${chain}`,
	});
	assert.equal(result.ok, false);
	if (!result.ok) assert.match(result.error, /50エッジ/);
});

test('Mermaid: 1行で大量展開するtimelineと長い1文を描画前に拒否', async () => {
	const renderer = generateWebMcpDescriptor(mermaidRenderMcpTool);
	const text = `timeline\n2020 ${': a '.repeat(1000)}`;
	assert.ok(text.length < 5000);
	const result = await renderer.run({ text });
	assert.equal(result.ok, false);
	if (!result.ok) assert.match(result.error, /フローチャート/);
	const longLabel = await renderer.run({
		text: `graph TD\nA[${'a'.repeat(201)}]`,
	});
	assert.equal(longLabel.ok, false);
});
