import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maskingMcpTool } from '../../src/lib/tools/masking.mcp.ts';
import { mermaidMcpTool } from '../../src/lib/tools/mermaid.mcp.ts';
import { yamlJsonTomlMcpTool } from '../../src/lib/tools/yaml-json-toml.mcp.ts';
import { generateWebMcpDescriptor } from '../../src/lib/webmcp/descriptor-generator.ts';
import { provideToolsFromFactory } from '../../src/lib/webmcp.ts';

const mermaid = generateWebMcpDescriptor(mermaidMcpTool);
const formats = generateWebMcpDescriptor(yamlJsonTomlMcpTool);
const masking = generateWebMcpDescriptor(maskingMcpTool);

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
	assert.equal((await mermaid.run({ text: 'x', action: 'exec' })).ok, false);
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
