import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
	MAX_UNICODE_INPUT_CHARACTERS,
	MAX_UNICODE_OUTPUT_BYTES,
	unicodeConverterMcpTool,
} from '../../src/lib/tools/unicode-converter.mcp.ts';
import {
	textToUnicode,
	unicodeToText,
} from '../../src/lib/tools/unicode-converter.ts';
import { generateWebMcpDescriptor } from '../../src/lib/webmcp/descriptor-generator.ts';
import { mcpToolDefinitions } from '../../src/lib/webmcp/registry.ts';
import { provideToolsFromFactory } from '../../src/lib/webmcp.ts';

const tool = generateWebMcpDescriptor(unicodeConverterMcpTool);
async function convert(text: string, action: 'encode' | 'decode') {
	const response = await tool.run({ text, action });
	assert.ok(response.ok, response.ok ? '' : response.error);
	return response.value.result;
}

test('単一ソースのschema・登録・注釈が公開契約と一致する', () => {
	assert.equal(tool.name, 'convert_unicode');
	assert.equal(
		mcpToolDefinitions.filter((t) => t.toolId === 'unicode-converter').length,
		1,
	);
	assert.deepEqual(tool.inputSchema.required, ['text', 'action']);
	assert.deepEqual(tool.inputSchema.properties, {
		text: {
			type: 'string',
			description: unicodeConverterMcpTool.params.text.description,
			maxLength: 20000,
		},
		action: {
			type: 'string',
			description: unicodeConverterMcpTool.params.action.description,
			enum: ['encode', 'decode'],
		},
	});
	assert.deepEqual(tool.outputSchema?.required, ['result']);
	assert.deepEqual(tool.annotations, {
		readOnlyHint: true,
		untrustedContentHint: true,
	});
});

test('encode: ASCII・改行維持、非ASCII・絵文字・バックスラッシュは固定期待値と一致', async () => {
	assert.equal(
		await convert('日本語😀', 'encode'),
		String.raw`\u65e5\u672c\u8a9e\ud83d\ude00`,
	);
	assert.equal(
		await convert(' A\r\n日\\"\0 ', 'encode'),
		' A\r\n\\u65e5\\u005c"\0 ',
	);
});

test('decode: 不完全表記は保持し、Unicodeのみ一度だけ置換する', async () => {
	for (const [input, expected] of [
		[String.raw`\u3042\u{1F600}`, 'あ😀'],
		[String.raw`\uZZZZ\u12\n\t\x41`, String.raw`\uZZZZ\u12\n\t\x41`],
		[String.raw`\\u3042`, '\\あ'],
		[String.raw`\u005cu3042`, String.raw`\u3042`],
		['"\\u3042"', '"あ"'],
	])
		assert.equal(await convert(input, 'decode'), expected);
});

test('既存UIの空白前処理と純粋関数に一致し、他の入力は正規化しない', async () => {
	for (const input of [
		'',
		' \t\r\n\u3000',
		' 前後 \r\n',
		'e\u0301',
		'\ud800',
		'\udfff',
		'\0A',
		String.raw`\u0000A`,
		'😀𩸽',
	]) {
		for (const action of ['encode', 'decode'] as const) {
			const expected = !input.trim()
				? ''
				: action === 'encode'
					? textToUnicode(input)
					: unicodeToText(input);
			assert.equal(await convert(input, action), expected);
		}
	}
});

test('コードポイント上限20000を両方向で許可し、20001/空白超過を変換前に拒否', async () => {
	assert.equal(MAX_UNICODE_INPUT_CHARACTERS, 20000);
	for (const action of ['encode', 'decode'] as const) {
		const output = await convert('😀'.repeat(20000), action);
		assert.equal(
			output,
			action === 'encode'
				? String.raw`\ud83d\ude00`.repeat(20000)
				: '😀'.repeat(20000),
		);
		for (const input of [
			'😀'.repeat(20001),
			' '.repeat(20001),
			'a'.repeat(20001),
		]) {
			const result = await tool.run({ text: input, action });
			assert.equal(result.ok, false);
			if (!result.ok) {
				assert.match(result.error, /上限/);
				assert.ok(!result.error.includes(input));
			}
		}
	}
	const largest = { result: String.raw`\ud83d\ude00`.repeat(20000) };
	assert.equal(
		new TextEncoder().encode(JSON.stringify(largest)).byteLength,
		280013,
	);
	assert.ok(
		new TextEncoder().encode(JSON.stringify(largest)).byteLength <
			MAX_UNICODE_OUTPUT_BYTES,
	);
});

test('必須・型・方向・JSON入力の異常を固定validationエラーで拒否', async () => {
	for (const input of [
		null,
		[],
		{},
		{ text: 'a' },
		{ action: 'encode' },
		{ text: 1, action: 'encode' },
		{ text: null, action: 'encode' },
		{ text: 'a', action: 'ENCODE' },
		{ text: 'a', action: 0 },
	]) {
		const result = await tool.run(input);
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /[ぁ-んァ-ヶ一-龠]/);
	}
});

test('範囲外と長いhexは固定デコードエラーで、原文・stackを返さない', async () => {
	for (const text of [
		String.raw`PRIVATE_PROBE\u{110000}`,
		`\\u{${'f'.repeat(19996)}}`,
	]) {
		const result = await tool.run({ text, action: 'decode' });
		assert.deepEqual(result, {
			ok: false,
			error:
				'デコードに失敗しました。ユニコード形式が正しいか確認してください。',
		});
	}
});

test('JSON出力予算の超過と未知例外を故障注入で確認し、部分結果や内部情報を返さない', async () => {
	const oversized = mock.method(
		TextEncoder.prototype,
		'encode',
		() => new Uint8Array(MAX_UNICODE_OUTPUT_BYTES + 1),
	);
	try {
		assert.deepEqual(await tool.run({ text: 'a', action: 'encode' }), {
			ok: false,
			error: '変換結果のサイズが上限を超えています。入力を短くしてください。',
		});
	} finally {
		oversized.mock.restore();
	}
	const failing = mock.method(TextEncoder.prototype, 'encode', () => {
		throw new Error('PRIVATE_INTERNAL_STACK');
	});
	try {
		for (const action of ['encode', 'decode'])
			assert.deepEqual(await tool.run({ text: 'a', action }), {
				ok: false,
				error: '変換に失敗しました。入力を確認してください。',
			});
	} finally {
		failing.mock.restore();
	}
	assert.equal(await convert('あ', 'encode'), String.raw`\u3042`);
});

test('実登録bridgeのAbortSignalで解除し、再登録できる', () => {
	const descriptors = ['window', 'document', 'navigator'].map(
		(key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
	);
	const registered: string[] = [];
	try {
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: {},
		});
		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: {},
		});
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: {
				modelContext: {
					registerTool(t: { name: string }, options: { signal: AbortSignal }) {
						registered.push(t.name);
						options.signal.addEventListener('abort', () => {
							registered.splice(registered.indexOf(t.name), 1);
						});
						return Promise.resolve();
					},
				},
			},
		});
		const cleanup = provideToolsFromFactory([tool]);
		assert.deepEqual(registered, ['convert_unicode']);
		cleanup();
		assert.deepEqual(registered, []);
		const second = provideToolsFromFactory([tool]);
		assert.deepEqual(registered, ['convert_unicode']);
		second();
		assert.deepEqual(registered, []);
	} finally {
		for (const [key, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
});
