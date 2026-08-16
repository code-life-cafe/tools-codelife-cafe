import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashMcpTool } from '../../src/lib/tools/hash.mcp.ts';
import { defineMcpTool } from '../../src/lib/webmcp/define-tool.ts';
import {
	buildInputSchema,
	buildOutputSchema,
	buildValidator,
	generateWebMcpDescriptor,
} from '../../src/lib/webmcp/descriptor-generator.ts';

// --- buildInputSchema / buildOutputSchema ---

test('buildInputSchema: required フィールドを列挙し enum を反映する', () => {
	const schema = buildInputSchema({
		text: { type: 'string', description: 'text' },
		mode: {
			type: 'string',
			description: 'mode',
			required: false,
			enum: ['a', 'b'],
		},
	});
	assert.deepEqual(schema, {
		type: 'object',
		properties: {
			text: { type: 'string', description: 'text' },
			mode: { type: 'string', description: 'mode', enum: ['a', 'b'] },
		},
		required: ['text'],
	});
});

test('buildOutputSchema: 全フィールドを required として扱う', () => {
	const schema = buildOutputSchema({
		hash: { type: 'string', description: 'hash value' },
		length: { type: 'number' },
	});
	assert.deepEqual(schema, {
		type: 'object',
		properties: {
			hash: { type: 'string', description: 'hash value' },
			length: { type: 'number' },
		},
		required: ['hash', 'length'],
	});
});

// --- buildValidator ---

test('buildValidator: 必須項目の欠落を拒否する', () => {
	const validate = buildValidator({
		text: { type: 'string', description: 'text' },
	});
	const result = validate({});
	assert.equal(result.ok, false);
});

test('buildValidator: 型不一致を拒否する', () => {
	const validate = buildValidator({
		amount: { type: 'number', description: 'amount' },
	});
	assert.equal(validate({ amount: 'not-a-number' }).ok, false);
	assert.equal(validate({ amount: Number.NaN }).ok, false);
	assert.equal(validate({ amount: 42 }).ok, true);
});

test('buildValidator: enum に含まれない文字列を拒否する', () => {
	const validate = buildValidator({
		mode: { type: 'string', description: 'mode', enum: ['a', 'b'] },
	});
	assert.equal(validate({ mode: 'c' }).ok, false);
	assert.equal(validate({ mode: 'a' }).ok, true);
});

test('buildValidator: maxLength を超える文字列を拒否する', () => {
	const validate = buildValidator({
		text: { type: 'string', description: 'text', maxLength: 3 },
	});
	assert.equal(validate({ text: 'abcd' }).ok, false);
	assert.equal(validate({ text: 'abc' }).ok, true);
});

test('buildValidator: required: false かつ省略時は default 値を補完する', () => {
	const validate = buildValidator({
		rounding: {
			type: 'string',
			description: 'rounding',
			required: false,
			enum: ['floor', 'ceil'],
			default: 'floor',
		},
	});
	const result = validate({});
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.value.rounding, 'floor');
});

test('buildValidator: boolean 型を検証する', () => {
	const validate = buildValidator({
		flag: { type: 'boolean', description: 'flag' },
	});
	assert.equal(validate({ flag: true }).ok, true);
	assert.equal(validate({ flag: 'true' }).ok, false);
});

test('buildValidator: オブジェクトでない入力を拒否する', () => {
	const validate = buildValidator({
		text: { type: 'string', description: 'text' },
	});
	assert.equal(validate(null).ok, false);
	assert.equal(validate('string').ok, false);
	assert.equal(validate(42).ok, false);
});

// --- generateWebMcpDescriptor（宣言的定義 → 実行可能ディスクリプタの経路） ---

const sampleDefinition = defineMcpTool<{ text: string }, { upper: string }>({
	toolId: 'sample',
	name: 'sample_tool',
	description: 'Sample tool for descriptor-generator tests',
	params: {
		text: { type: 'string', description: 'Text to uppercase' },
	},
	returns: {
		upper: { type: 'string', description: 'Uppercased text' },
	},
	annotations: { readOnlyHint: true },
	handler(input) {
		return { upper: input.text.toUpperCase() };
	},
});

test('generateWebMcpDescriptor: 定義から name/description/schema/annotations を生成する', () => {
	const descriptor = generateWebMcpDescriptor(sampleDefinition);
	assert.equal(descriptor.name, 'sample_tool');
	assert.equal(descriptor.description, sampleDefinition.description);
	assert.deepEqual(descriptor.inputSchema, {
		type: 'object',
		properties: {
			text: { type: 'string', description: 'Text to uppercase' },
		},
		required: ['text'],
	});
	assert.deepEqual(descriptor.outputSchema, {
		type: 'object',
		properties: {
			upper: { type: 'string', description: 'Uppercased text' },
		},
		required: ['upper'],
	});
	assert.deepEqual(descriptor.annotations, { readOnlyHint: true });
});

test('generateWebMcpDescriptor: 生成された run() が validate → handler を通す', async () => {
	const descriptor = generateWebMcpDescriptor(sampleDefinition);
	const ok = await descriptor.run({ text: 'hello' });
	assert.deepEqual(ok, { ok: true, value: { upper: 'HELLO' } });

	const bad = await descriptor.run({});
	assert.equal(bad.ok, false);
});

// --- 参照実装: hash.mcp.ts の単一ソース定義から生成したディスクリプタ ---

test('reference implementation: hashMcpTool から生成したディスクリプタが手書き版と同じ形状になる', () => {
	const descriptor = generateWebMcpDescriptor(hashMcpTool);
	assert.equal(descriptor.name, 'generate_hash');
	assert.deepEqual(descriptor.inputSchema, {
		type: 'object',
		properties: {
			text: {
				type: 'string',
				description: 'Text to hash / ハッシュ化する文字列',
			},
			algorithm: {
				type: 'string',
				description: 'Hash algorithm to use',
				enum: ['md5', 'sha-256', 'sha-512'],
			},
		},
		required: ['text', 'algorithm'],
	});
	assert.deepEqual(descriptor.outputSchema, {
		type: 'object',
		properties: {
			hash: { type: 'string', description: 'Hex-encoded hash value' },
		},
		required: ['hash'],
	});
});

test('reference implementation: hashMcpTool から生成したディスクリプタが正しくハッシュを計算する', async () => {
	const descriptor = generateWebMcpDescriptor(hashMcpTool);
	const result = await descriptor.run({ text: 'hello', algorithm: 'md5' });
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.hash, '5d41402abc4b2a76b9719d911017c592');
	}
});
