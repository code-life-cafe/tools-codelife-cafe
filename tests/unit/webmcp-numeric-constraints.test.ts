import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cronCheckerMcpTool } from '../../src/lib/tools/cron-checker.mcp.ts';
import { jsonFormatterMcpTool } from '../../src/lib/tools/json-formatter.mcp.ts';
import { uuidMcpTool } from '../../src/lib/tools/uuid.mcp.ts';
import { generateWebMcpDescriptor } from '../../src/lib/webmcp/descriptor-generator.ts';

const uuid = generateWebMcpDescriptor(uuidMcpTool);
const cron = generateWebMcpDescriptor(cronCheckerMcpTool);
const formatter = generateWebMcpDescriptor(jsonFormatterMcpTool);

test('UUID・cron: countのschemaに整数・既存の上下限を公開する', () => {
	for (const [tool, maximum] of [
		[uuid, 100],
		[cron, 50],
	] as const) {
		const properties = tool.inputSchema.properties as Record<
			string,
			Record<string, unknown>
		>;
		assert.equal(properties.count.type, 'integer');
		assert.equal(properties.count.minimum, 1);
		assert.equal(properties.count.maximum, maximum);
	}
});

test('UUID・cron: countの上下限・省略時の件数を維持し、不正値を拒否する', async () => {
	for (const count of [1, 100, undefined]) {
		const result = await uuid.run({ type: 'v4', count });
		assert.ok(result.ok, result.ok ? undefined : result.error);
		assert.equal(result.value.ids.length, count ?? 1);
	}
	for (const count of [1, 50, undefined]) {
		const result = await cron.run({ expression: '* * * * *', count });
		assert.ok(result.ok, result.ok ? undefined : result.error);
		assert.equal(result.value.nextRuns.length, count ?? 5);
	}
	for (const [tool, input, maximum] of [
		[uuid, { type: 'v4' }, 100],
		[cron, { expression: '* * * * *' }, 50],
	] as const) {
		for (const count of [0, maximum + 1, 1.5, '1', null, NaN, Infinity]) {
			const result = await tool.run({ ...input, count });
			assert.equal(result.ok, false);
			if (!result.ok) assert.match(result.error, /count/);
		}
	}
});

test('JSON整形: indentは2・4だけをschemaに公開する', () => {
	const properties = formatter.inputSchema.properties as Record<
		string,
		Record<string, unknown>
	>;
	assert.equal(properties.indent.type, 'integer');
	assert.deepEqual(properties.indent.enum, [2, 4]);
});

test('JSON整形: 不正なindentを2へ補正しない', async () => {
	for (const minify of [false, true]) {
		for (const indent of [8, 0, 3, 2.5, '2', null]) {
			const result = await formatter.run({ json: '{"a":1}', indent, minify });
			assert.equal(result.ok, false);
			if (!result.ok) assert.match(result.error, /indent/);
		}
	}
});

test('JSON整形: indentの正常値・省略時・最小化を維持する', async () => {
	for (const indent of [2, 4, undefined]) {
		for (const minify of [false, true]) {
			const result = await formatter.run({ json: '{"a":1}', indent, minify });
			assert.ok(result.ok, result.ok ? undefined : result.error);
			assert.equal(
				result.value.output,
				JSON.stringify({ a: 1 }, null, minify ? undefined : (indent ?? 2)),
			);
		}
	}
});

test('静的manifestにも実行時と同じ数値schemaを公開する', () => {
	const manifest = JSON.parse(
		readFileSync(
			new URL(
				'../../public/.well-known/webmcp/tools.generated.json',
				import.meta.url,
			),
			'utf8',
		),
	);
	for (const tool of [uuid, cron, formatter]) {
		const entry = manifest.tools.find(
			(item: { name: string }) => item.name === tool.name,
		);
		assert.ok(entry);
		assert.deepEqual(entry.inputSchema, tool.inputSchema);
	}
});
