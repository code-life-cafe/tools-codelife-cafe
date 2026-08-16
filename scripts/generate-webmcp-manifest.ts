// generate-webmcp-manifest.ts — ツール定義（単一ソース）からWebMCPディスクリプタを
// ビルド時に自動生成し、public/.well-known/webmcp/tools.generated.json へ書き出す。
// 実行: npm run webmcp:generate （npm run build にも組み込まれている）
//
// 生成物は「定義からディスクリプタが自動生成されている」ことを検証可能にするための
// 静的アーティファクトであり、ランタイムの WebMCP 登録（document.modelContext.registerTool）
// 自体は各ツールページが descriptor-generator.ts を直接呼び出して行う。

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateWebMcpDescriptor } from '../src/lib/webmcp/descriptor-generator.ts';
import { mcpToolDefinitions } from '../src/lib/webmcp/registry.ts';

function assertValidJsonSchema(schema: unknown, label: string): void {
	if (typeof schema !== 'object' || schema === null) {
		throw new Error(`${label}: schema must be an object`);
	}
	const s = schema as Record<string, unknown>;
	if (s.type !== 'object') {
		throw new Error(`${label}: schema.type must be "object"`);
	}
	if (typeof s.properties !== 'object' || s.properties === null) {
		throw new Error(`${label}: schema.properties must be an object`);
	}
	if (!Array.isArray(s.required)) {
		throw new Error(`${label}: schema.required must be an array`);
	}
	const properties = s.properties as Record<string, unknown>;
	for (const key of s.required) {
		if (!(key in properties)) {
			throw new Error(
				`${label}: required field "${String(key)}" is missing from properties`,
			);
		}
	}
}

async function main() {
	if (mcpToolDefinitions.length === 0) {
		throw new Error(
			'No McpToolDefinition registered in src/lib/webmcp/registry.ts',
		);
	}

	const seenNames = new Set<string>();
	const tools = mcpToolDefinitions.map((definition) => {
		if (seenNames.has(definition.name)) {
			throw new Error(`Duplicate WebMCP tool name: "${definition.name}"`);
		}
		seenNames.add(definition.name);

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

		return {
			toolId: definition.toolId,
			name: descriptor.name,
			description: descriptor.description,
			aliases: definition.aliases ?? [],
			inputSchema: descriptor.inputSchema,
			outputSchema: descriptor.outputSchema ?? null,
			annotations: descriptor.annotations ?? {},
		};
	});

	const outDir = path.join(process.cwd(), 'public', '.well-known', 'webmcp');
	await mkdir(outDir, { recursive: true });
	const outFile = path.join(outDir, 'tools.generated.json');
	await writeFile(outFile, `${JSON.stringify({ tools }, null, 2)}\n`);

	console.log(
		`[generate-webmcp-manifest] generated ${tools.length} descriptor(s) -> ${path.relative(process.cwd(), outFile)}`,
	);
}

main().catch((err) => {
	console.error('[generate-webmcp-manifest] failed:', err);
	process.exitCode = 1;
});
