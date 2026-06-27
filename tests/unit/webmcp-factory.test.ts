import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failure, success } from '../../src/lib/webmcp/errors.ts';
import { createWebMcpTool } from '../../src/lib/webmcp/tool-factory.ts';
import { hashTool } from '../../src/lib/webmcp/tools/hash.webmcp.ts';
import { taxTool } from '../../src/lib/webmcp/tools/tax.webmcp.ts';
import {
	checkSizeLimit,
	isObject,
	optionalEnum,
	requireEnum,
	requireNumber,
	requireString,
} from '../../src/lib/webmcp/validation.ts';

// --- errors.ts ---

test('errors: success wraps value correctly', () => {
	const result = success({ hash: 'abc' });
	assert.deepEqual(result, { ok: true, value: { hash: 'abc' } });
});

test('errors: failure wraps error message correctly', () => {
	const result = failure('bad input');
	assert.deepEqual(result, { ok: false, error: 'bad input' });
});

// --- validation.ts ---

test('validation: isObject returns true for plain objects', () => {
	assert.equal(isObject({}), true);
	assert.equal(isObject({ a: 1 }), true);
});

test('validation: isObject returns false for non-objects', () => {
	assert.equal(isObject(null), false);
	assert.equal(isObject(undefined), false);
	assert.equal(isObject('string'), false);
	assert.equal(isObject(42), false);
	assert.equal(isObject(true), false);
});

test('validation: requireString succeeds for string values', () => {
	const result = requireString({ text: 'hello' }, 'text');
	assert.deepEqual(result, { ok: true, value: 'hello' });
});

test('validation: requireString fails for non-string values', () => {
	assert.equal(requireString({ text: 42 }, 'text').ok, false);
	assert.equal(requireString({ text: null }, 'text').ok, false);
	assert.equal(requireString({}, 'text').ok, false);
});

test('validation: requireNumber succeeds for finite numbers', () => {
	const result = requireNumber({ amount: 1000 }, 'amount');
	assert.deepEqual(result, { ok: true, value: 1000 });
});

test('validation: requireNumber fails for non-finite values', () => {
	assert.equal(requireNumber({ amount: 'abc' }, 'amount').ok, false);
	assert.equal(requireNumber({ amount: NaN }, 'amount').ok, false);
	assert.equal(requireNumber({ amount: Infinity }, 'amount').ok, false);
	assert.equal(requireNumber({}, 'amount').ok, false);
});

test('validation: requireEnum succeeds for valid enum values', () => {
	const result = requireEnum({ algo: 'md5' }, 'algo', [
		'md5',
		'sha-256',
	] as const);
	assert.deepEqual(result, { ok: true, value: 'md5' });
});

test('validation: requireEnum fails for invalid enum values', () => {
	assert.equal(
		requireEnum({ algo: 'invalid' }, 'algo', ['md5', 'sha-256'] as const).ok,
		false,
	);
	assert.equal(
		requireEnum({ algo: 42 }, 'algo', ['md5', 'sha-256'] as const).ok,
		false,
	);
});

test('validation: optionalEnum uses default when key is missing', () => {
	const result = optionalEnum(
		{},
		'rounding',
		['floor', 'ceil'] as const,
		'floor',
	);
	assert.deepEqual(result, { ok: true, value: 'floor' });
});

test('validation: optionalEnum uses provided value when present', () => {
	const result = optionalEnum(
		{ rounding: 'ceil' },
		'rounding',
		['floor', 'ceil'] as const,
		'floor',
	);
	assert.deepEqual(result, { ok: true, value: 'ceil' });
});

test('validation: optionalEnum fails for invalid provided value', () => {
	assert.equal(
		optionalEnum(
			{ rounding: 'bad' },
			'rounding',
			['floor', 'ceil'] as const,
			'floor',
		).ok,
		false,
	);
});

test('validation: checkSizeLimit passes for within-limit strings', () => {
	const result = checkSizeLimit('hello', 10);
	assert.deepEqual(result, { ok: true, value: 'hello' });
});

test('validation: checkSizeLimit fails for oversized strings', () => {
	const result = checkSizeLimit('hello world', 5);
	assert.equal(result.ok, false);
});

// --- tool-factory.ts ---

test('tool-factory: createWebMcpTool wraps execute in try-catch and returns ok result', async () => {
	const tool = createWebMcpTool({
		name: 'test_tool',
		description: 'Test',
		inputSchema: {
			type: 'object',
			properties: { x: { type: 'string' } },
			required: ['x'],
		},
		validate: (input) => {
			if (!isObject(input) || typeof input.x !== 'string')
				return failure('bad');
			return success({ x: input.x });
		},
		execute: (input) => ({ result: input.x.toUpperCase() }),
	});

	const result = await tool.run({ x: 'hello' });
	assert.deepEqual(result, { ok: true, value: { result: 'HELLO' } });
});

test('tool-factory: createWebMcpTool returns error for invalid input without throwing', async () => {
	const tool = createWebMcpTool({
		name: 'test_tool',
		description: 'Test',
		inputSchema: { type: 'object', properties: {}, required: [] },
		validate: () => failure('validation failed'),
		execute: () => 'never reached',
	});

	const result = await tool.run({});
	assert.deepEqual(result, { ok: false, error: 'validation failed' });
});

test('tool-factory: createWebMcpTool catches thrown errors in execute', async () => {
	const tool = createWebMcpTool({
		name: 'test_tool',
		description: 'Test',
		inputSchema: { type: 'object', properties: {}, required: [] },
		validate: () => success(null),
		execute: () => {
			throw new Error('boom');
		},
	});

	const result = await tool.run({});
	assert.deepEqual(result, { ok: false, error: 'boom' });
});

test('tool-factory: createWebMcpTool catches non-Error thrown values', async () => {
	const tool = createWebMcpTool({
		name: 'test_tool',
		description: 'Test',
		inputSchema: { type: 'object', properties: {}, required: [] },
		validate: () => success(null),
		execute: () => {
			throw 'string error';
		},
	});

	const result = await tool.run({});
	assert.deepEqual(result, {
		ok: false,
		error: 'An unexpected error occurred',
	});
});

test('tool-factory: createWebMcpTool preserves metadata', () => {
	const tool = createWebMcpTool({
		name: 'my_tool',
		description: 'My tool description',
		inputSchema: {
			type: 'object',
			properties: { a: { type: 'string' } },
			required: ['a'],
		},
		outputSchema: {
			type: 'object',
			properties: { b: { type: 'string' } },
			required: ['b'],
		},
		validate: () => success(null),
		execute: () => ({ b: 'val' }),
	});

	assert.equal(tool.name, 'my_tool');
	assert.equal(tool.description, 'My tool description');
	assert.deepEqual(tool.inputSchema, {
		type: 'object',
		properties: { a: { type: 'string' } },
		required: ['a'],
	});
	assert.deepEqual(tool.outputSchema, {
		type: 'object',
		properties: { b: { type: 'string' } },
		required: ['b'],
	});
});

// --- inputSchema.required と validate の一致を機械検証 ---

function getRequiredFields(schema: Record<string, unknown>): string[] {
	const required = schema.required;
	if (!Array.isArray(required)) return [];
	return [...required].sort();
}

function testValidationRejectsEachRequiredField(
	toolName: string,
	tool: {
		inputSchema: Record<string, unknown>;
		run: (input: unknown) => Promise<{ ok: boolean }>;
	},
	validInput: Record<string, unknown>,
) {
	const requiredFields = getRequiredFields(tool.inputSchema);

	for (const field of requiredFields) {
		test(`${toolName}: validate rejects input when required field "${field}" is missing`, async () => {
			const incomplete = { ...validInput };
			delete incomplete[field];
			const result = await tool.run(incomplete);
			assert.equal(
				result.ok,
				false,
				`Should reject when "${field}" is missing`,
			);
		});
	}
}

// --- hash.webmcp.ts ---

test('hash tool: has correct name and schema', () => {
	assert.equal(hashTool.name, 'generate_hash');
	assert.ok(hashTool.description.length > 0);
	assert.deepEqual(getRequiredFields(hashTool.inputSchema), [
		'algorithm',
		'text',
	]);
	assert.ok(hashTool.outputSchema);
});

test('hash tool: computes MD5 hash correctly', async () => {
	const result = await hashTool.run({ text: 'hello', algorithm: 'md5' });
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.hash, '5d41402abc4b2a76b9719d911017c592');
	}
});

test('hash tool: computes SHA-256 hash correctly', async () => {
	const result = await hashTool.run({ text: 'abc', algorithm: 'sha-256' });
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(
			result.value.hash,
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
	}
});

test('hash tool: computes SHA-512 hash correctly', async () => {
	const result = await hashTool.run({ text: 'abc', algorithm: 'sha-512' });
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(
			result.value.hash,
			'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
		);
	}
});

test('hash tool: rejects null input', async () => {
	const result = await hashTool.run(null);
	assert.equal(result.ok, false);
});

test('hash tool: rejects missing text', async () => {
	const result = await hashTool.run({ algorithm: 'md5' });
	assert.equal(result.ok, false);
});

test('hash tool: rejects missing algorithm', async () => {
	const result = await hashTool.run({ text: 'hello' });
	assert.equal(result.ok, false);
});

test('hash tool: rejects invalid algorithm', async () => {
	const result = await hashTool.run({ text: 'hello', algorithm: 'sha-1024' });
	assert.equal(result.ok, false);
});

test('hash tool: rejects non-string text', async () => {
	const result = await hashTool.run({ text: 123, algorithm: 'md5' });
	assert.equal(result.ok, false);
});

testValidationRejectsEachRequiredField('hash', hashTool, {
	text: 'hello',
	algorithm: 'md5',
});

// --- tax.webmcp.ts ---

test('tax tool: has correct name and schema', () => {
	assert.equal(taxTool.name, 'calc_tax');
	assert.ok(taxTool.description.length > 0);
	assert.deepEqual(getRequiredFields(taxTool.inputSchema), [
		'amount',
		'mode',
		'taxRate',
	]);
	assert.ok(taxTool.outputSchema);
});

test('tax tool: calculates tax-excluded to tax-included correctly (10000 * 10%)', async () => {
	const result = await taxTool.run({
		amount: 10000,
		taxRate: '10',
		mode: 'tax_excluded',
	});
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.base, 10000);
		assert.equal(result.value.tax, 1000);
		assert.equal(result.value.total, 11000);
		assert.equal(result.value.result, 11000);
		assert.equal(result.value.taxAmount, 1000);
	}
});

test('tax tool: calculates tax-included to tax-excluded correctly (1100 * 10%)', async () => {
	const result = await taxTool.run({
		amount: 1100,
		taxRate: '10',
		mode: 'tax_included',
	});
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.base, 1000);
		assert.equal(result.value.tax, 100);
		assert.equal(result.value.total, 1100);
		assert.equal(result.value.result, 1000);
	}
});

test('tax tool: uses floor rounding by default', async () => {
	const result = await taxTool.run({
		amount: 101,
		taxRate: '10',
		mode: 'tax_excluded',
	});
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.tax, 10);
	}
});

test('tax tool: uses ceil rounding when specified', async () => {
	const result = await taxTool.run({
		amount: 101,
		taxRate: '10',
		mode: 'tax_excluded',
		rounding: 'ceil',
	});
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.tax, 11);
	}
});

test('tax tool: supports reduced tax rate (8_reduced)', async () => {
	const result = await taxTool.run({
		amount: 1000,
		taxRate: '8_reduced',
		mode: 'tax_excluded',
	});
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.tax, 80);
		assert.equal(result.value.total, 1080);
	}
});

test('tax tool: rejects null input', async () => {
	const result = await taxTool.run(null);
	assert.equal(result.ok, false);
});

test('tax tool: rejects missing amount', async () => {
	const result = await taxTool.run({ taxRate: '10', mode: 'tax_excluded' });
	assert.equal(result.ok, false);
});

test('tax tool: rejects missing taxRate', async () => {
	const result = await taxTool.run({ amount: 1000, mode: 'tax_excluded' });
	assert.equal(result.ok, false);
});

test('tax tool: rejects missing mode', async () => {
	const result = await taxTool.run({ amount: 1000, taxRate: '10' });
	assert.equal(result.ok, false);
});

test('tax tool: rejects invalid taxRate', async () => {
	const result = await taxTool.run({
		amount: 1000,
		taxRate: '15',
		mode: 'tax_excluded',
	});
	assert.equal(result.ok, false);
});

test('tax tool: rejects invalid mode', async () => {
	const result = await taxTool.run({
		amount: 1000,
		taxRate: '10',
		mode: 'bad_mode',
	});
	assert.equal(result.ok, false);
});

test('tax tool: rejects non-number amount', async () => {
	const result = await taxTool.run({
		amount: 'abc',
		taxRate: '10',
		mode: 'tax_excluded',
	});
	assert.equal(result.ok, false);
});

test('tax tool: rejects NaN amount', async () => {
	const result = await taxTool.run({
		amount: NaN,
		taxRate: '10',
		mode: 'tax_excluded',
	});
	assert.equal(result.ok, false);
});

test('tax tool: rejects invalid rounding', async () => {
	const result = await taxTool.run({
		amount: 1000,
		taxRate: '10',
		mode: 'tax_excluded',
		rounding: 'truncate',
	});
	assert.equal(result.ok, false);
});

testValidationRejectsEachRequiredField('tax', taxTool, {
	amount: 1000,
	taxRate: '10',
	mode: 'tax_excluded',
});

// --- provideToolsFromFactory adapter ---

test('provideToolsFromFactory: wraps tool results with isError for failures', async () => {
	const { provideToolsFromFactory } = await import('../../src/lib/webmcp.ts');

	let registeredTools: Array<{
		execute: (input: unknown) => Promise<unknown>;
	}> = [];

	const originalDocument = globalThis.document;
	const originalWindow = globalThis.window;

	Object.defineProperty(globalThis, 'window', {
		value: {},
		configurable: true,
	});
	Object.defineProperty(globalThis, 'document', {
		value: {
			modelContext: {
				registerTool(tool: unknown) {
					registeredTools.push(
						tool as { execute: (input: unknown) => Promise<unknown> },
					);
					return { unregister() {} };
				},
			},
		},
		configurable: true,
	});

	try {
		const testTool = createWebMcpTool({
			name: 'test_adapter',
			description: 'Test adapter',
			inputSchema: {
				type: 'object',
				properties: { x: { type: 'string' } },
				required: ['x'],
			},
			validate: (input) => {
				if (!isObject(input) || typeof input.x !== 'string')
					return failure('bad input');
				return success({ x: input.x });
			},
			execute: (input: { x: string }) => ({ upper: input.x.toUpperCase() }),
		});

		provideToolsFromFactory([testTool]);

		assert.equal(registeredTools.length, 1);

		const successResult = await registeredTools[0].execute({ x: 'hello' });
		assert.deepEqual(successResult, { upper: 'HELLO' });

		const errorResult = (await registeredTools[0].execute({ x: 123 })) as {
			error: string;
			isError: boolean;
		};
		assert.equal(errorResult.isError, true);
		assert.equal(typeof errorResult.error, 'string');
	} finally {
		Object.defineProperty(globalThis, 'document', {
			value: originalDocument,
			configurable: true,
		});
		Object.defineProperty(globalThis, 'window', {
			value: originalWindow,
			configurable: true,
		});
		registeredTools = [];
	}
});
