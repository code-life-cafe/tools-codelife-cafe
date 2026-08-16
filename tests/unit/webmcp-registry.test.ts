import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWebMcpDescriptor } from '../../src/lib/webmcp/descriptor-generator.ts';
import { mcpToolDefinitions } from '../../src/lib/webmcp/registry.ts';

// `scripts/generate-webmcp-manifest.ts` が使う検証ロジックと同等のチェックを
// 単体テストとしても走らせ、「定義→ディスクリプタ生成」の経路が壊れていないことを
// ビルドを実行せずに確認できるようにする。

function assertValidJsonSchema(schema: unknown, label: string) {
	assert.equal(typeof schema, 'object', `${label} should be an object`);
	assert.ok(schema, `${label} should not be null`);
	const s = schema as Record<string, unknown>;
	assert.equal(s.type, 'object', `${label}.type should be "object"`);
	assert.equal(
		typeof s.properties,
		'object',
		`${label}.properties should be an object`,
	);
	assert.ok(Array.isArray(s.required), `${label}.required should be an array`);
	const properties = s.properties as Record<string, unknown>;
	for (const key of s.required as string[]) {
		assert.ok(
			key in properties,
			`${label}: required field "${key}" missing from properties`,
		);
	}
}

test('registry: 少なくとも1つのMcpToolDefinitionが登録されている', () => {
	assert.ok(mcpToolDefinitions.length > 0);
});

test('registry: ツール名が重複していない', () => {
	const names = mcpToolDefinitions.map((def) => def.name);
	assert.equal(new Set(names).size, names.length);
});

test('registry: 全ての定義から妥当なJSON Schemaディスクリプタが生成される', () => {
	for (const definition of mcpToolDefinitions) {
		const descriptor = generateWebMcpDescriptor(definition);
		assertValidJsonSchema(
			descriptor.inputSchema,
			`${descriptor.name}.inputSchema`,
		);
		if (descriptor.outputSchema) {
			assertValidJsonSchema(
				descriptor.outputSchema,
				`${descriptor.name}.outputSchema`,
			);
		}
		assert.ok(descriptor.description.length > 0);
	}
});
