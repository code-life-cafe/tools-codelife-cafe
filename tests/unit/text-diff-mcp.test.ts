import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { textDiffMcpTool } from '../../src/lib/tools/text-diff.mcp.ts';
import { computeDiff } from '../../src/lib/tools/text-diff.ts';
import {
	computeBoundedDiff,
	DIFF_MESSAGES,
	MAX_DIFF_OUTPUT_BYTES,
	MAX_DIFF_PARTS,
	parseDiffReply,
	safeDiffError,
	serializeDiffOutput,
	type TextDiffInput,
	TextDiffMcpError,
	type TextDiffOutput,
} from '../../src/lib/tools/text-diff-mcp-runtime.ts';
import { compareTextInWorker } from '../../src/lib/tools/text-diff-mcp-worker.ts';
import { generateWebMcpDescriptor } from '../../src/lib/webmcp/descriptor-generator.ts';
import { mcpToolDefinitions } from '../../src/lib/webmcp/registry.ts';

const tool = generateWebMcpDescriptor(textDiffMcpTool);
const input: TextDiffInput = { textA: '旧文', textB: '新文', mode: 'chars' };
const output = computeBoundedDiff(input);

test('schema/registry: 単一ソース・既定値・上限・出力', () => {
	assert.ok(mcpToolDefinitions.includes(textDiffMcpTool));
	const schema = tool.inputSchema as {
		required: string[];
		properties: Record<
			string,
			{ maxLength?: number; default?: string; enum?: string[] }
		>;
	};
	assert.deepEqual(schema.required, ['textA', 'textB']);
	assert.equal(schema.properties.textA.maxLength, 20000);
	assert.equal(schema.properties.textB.maxLength, 20000);
	assert.equal(schema.properties.mode.default, 'lines');
	assert.deepEqual(schema.properties.mode.enum, ['lines', 'chars']);
	assert.deepEqual((tool.outputSchema as { required: string[] }).required, [
		'mode',
		'hasChanges',
		'parts',
		'addedLines',
		'removedLines',
		'addedChars',
		'removedChars',
	]);
	assert.equal(tool.annotations?.readOnlyHint, true);
});

test('引数: 未指定/null/誤型/未知enumを拒否する', async () => {
	for (const value of [
		undefined,
		null,
		[],
		{},
		{ textA: null, textB: '' },
		{ textA: '', textB: 5 },
		{ textA: '', textB: '', mode: 'words' },
	]) {
		const result = await tool.run(value);
		assert.equal(result.ok, false, JSON.stringify(value));
	}
});

test('既定lines・空入力・hasChangesは末尾LF補完後の差分に従う', async () => {
	const empty = await tool.run({ textA: '', textB: '' });
	assert.deepEqual(empty, {
		ok: true,
		value: {
			mode: 'lines',
			hasChanges: false,
			parts: [],
			addedLines: 0,
			removedLines: 0,
			addedChars: 0,
			removedChars: 0,
		},
	});
	const equal = await tool.run({ textA: 'a', textB: 'a\n' });
	assert.ok(equal.ok);
	assert.equal(equal.value.hasChanges, false);
	assert.deepEqual(equal.value.parts, [{ value: 'a\n', type: 'unchanged' }]);
	assert.equal(
		computeBoundedDiff({ textA: 'a', textB: 'a\n', mode: 'chars' }).addedChars,
		1,
	);
});

test('両モード: 固定期待値と既存pureの一致（日本語/空白/改行/Unicode）', async () => {
	assert.deepEqual(
		computeBoundedDiff({ textA: 'abc', textB: 'axc', mode: 'chars' }),
		{
			mode: 'chars',
			hasChanges: true,
			parts: [
				{ value: 'a', type: 'unchanged' },
				{ value: 'b', type: 'removed' },
				{ value: 'x', type: 'added' },
				{ value: 'c', type: 'unchanged' },
			],
			addedLines: 1,
			removedLines: 1,
			addedChars: 1,
			removedChars: 1,
		},
	);
	for (const mode of ['lines', 'chars'] as const)
		for (const [textA, textB] of [
			['', '全追加'],
			['全削除', ''],
			['同じ', '同じ'],
			['日本語\n旧文😀', '日本語\n新文😺'],
			['a\r\n', 'a\r\n\r\n'],
			['a\n \n', 'a\n\t\n'],
			['<script>', '<img>'],
			['é', 'e\u0301'],
			['A a', 'a A'],
		]) {
			const expected = computeDiff(textA, textB, mode);
			const result = await tool.run({ textA, textB, mode });
			assert.ok(result.ok);
			assert.deepEqual(result.value, {
				mode,
				hasChanges: expected.parts.some(
					(p) => p.type !== 'unchanged' && p.value !== '',
				),
				...expected,
			});
		}
});

test('入力20k Unicode境界・追加フィールドで予算緩和できない', async () => {
	for (const text of ['あ'.repeat(20000), '😀'.repeat(20000)]) {
		assert.equal((await tool.run({ textA: text, textB: text })).ok, true);
		assert.equal(
			(await tool.run({ textA: `${text}x`, textB: text })).ok,
			false,
		);
		assert.equal(
			(await tool.run({ textA: text, textB: `${text}x` })).ok,
			false,
		);
	}
	const r = await tool.run({
		textA: 'a'.repeat(501),
		textB: 'b'.repeat(501),
		mode: 'chars',
		maxEditLength: 999999,
		timeout: 999999,
	});
	assert.equal(r.ok, false);
	if (!r.ok) assert.equal(r.error, DIFF_MESSAGES.budget);
});

test('編集距離1000ちょうどと1001を両モードで区別', () => {
	for (const mode of ['lines', 'chars'] as const) {
		const unit = mode === 'lines' ? 'a\n' : 'a';
		assert.equal(
			computeBoundedDiff({ textA: '', textB: unit.repeat(1000), mode })
				.hasChanges,
			true,
		);
		assert.throws(
			() => computeBoundedDiff({ textA: '', textB: unit.repeat(1001), mode }),
			/計算量または時間/,
		);
	}
});

test('算法の時間上限は中止として扱う（制御時計）', () => {
	let now = 0;
	const clock = mock.method(Date, 'now', () => {
		now += 501;
		return now;
	});
	try {
		assert.throws(
			() => computeBoundedDiff({ textA: 'aaa', textB: 'bbb', mode: 'chars' }),
			/計算量または時間/,
		);
	} finally {
		clock.mock.restore();
	}
});

test('出力: 合成結果でparts5000とUTF8 1MiBの境界（実入力経路とは別）', () => {
	const result: TextDiffOutput = {
		mode: 'chars',
		hasChanges: false,
		parts: Array.from({ length: MAX_DIFF_PARTS }, () => ({
			value: '',
			type: 'unchanged' as const,
		})),
		addedLines: 0,
		removedLines: 0,
		addedChars: 0,
		removedChars: 0,
	};
	assert.doesNotThrow(() => serializeDiffOutput(result));
	result.parts.push({ value: '', type: 'unchanged' });
	assert.throws(() => serializeDiffOutput(result), /5000断片/);
	result.parts = [{ value: '', type: 'unchanged' }];
	const base = new TextEncoder().encode(serializeDiffOutput(result)).byteLength;
	result.parts[0].value = `あ${'x'.repeat(MAX_DIFF_OUTPUT_BYTES - base - 3)}`;
	assert.equal(
		new TextEncoder().encode(serializeDiffOutput(result)).byteLength,
		MAX_DIFF_OUTPUT_BYTES,
	);
	assert.deepEqual(parseDiffReply(serializeDiffOutput(result)), result);
	result.parts[0].value += 'x';
	assert.throws(() => serializeDiffOutput(result), /1MiB/);
});

test('受信境界: 誤型・不正統計・不正断片・未知エラーは固定文言', () => {
	for (const value of [
		null,
		{},
		'[]',
		'null',
		'{',
		JSON.stringify({ error: 'private marker input' }),
		JSON.stringify({ ...output, addedLines: -1 }),
		JSON.stringify({ ...output, parts: [{ value: 1, type: 'added' }] }),
		JSON.stringify({ ...output, hasChanges: !output.hasChanges }),
		JSON.stringify({ ...output, extra: 'raw' }),
		'あ'.repeat(MAX_DIFF_OUTPUT_BYTES),
	])
		assert.throws(() => parseDiffReply(value), /受信できません/);
	assert.equal(
		safeDiffError(new Error('private marker input')),
		DIFF_MESSAGES.unexpected,
	);
	assert.equal(
		safeDiffError(new TextDiffMcpError('private marker input')),
		DIFF_MESSAGES.unexpected,
	);
	assert.equal(
		safeDiffError(new TextDiffMcpError(DIFF_MESSAGES.output)),
		DIFF_MESSAGES.output,
	);
});

class FakeWorker {
	static scenario = 'success';
	static instances: FakeWorker[] = [];
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: ((event: { preventDefault: () => void }) => void) | null = null;
	onmessageerror: (() => void) | null = null;
	terminated = false;
	prevented = false;
	constructor() {
		if (FakeWorker.scenario === 'constructor')
			throw new Error('private marker constructor');
		FakeWorker.instances.push(this);
	}
	terminate() {
		this.terminated = true;
	}
	postMessage(request: TextDiffInput) {
		if (FakeWorker.scenario === 'post') throw new Error('private marker post');
		if (FakeWorker.scenario === 'hang') return;
		queueMicrotask(() => {
			if (FakeWorker.scenario === 'error')
				this.onerror?.({
					preventDefault: () => {
						this.prevented = true;
					},
				});
			else if (FakeWorker.scenario === 'messageerror') this.onmessageerror?.();
			else
				this.onmessage?.({
					data:
						FakeWorker.scenario === 'bad'
							? 'private marker bad'
							: FakeWorker.scenario === 'unknown'
								? JSON.stringify({ error: 'private marker exception' })
								: serializeDiffOutput(computeBoundedDiff(request)),
				});
		});
	}
}
async function browser(
	run: (timers: Map<number, () => void>) => Promise<void>,
) {
	const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'),
		savedWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	const timers = new Map<number, () => void>();
	let id = 0;
	FakeWorker.instances = [];
	FakeWorker.scenario = 'success';
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			setTimeout: (cb: () => void) => {
				timers.set(++id, cb);
				return id;
			},
			clearTimeout: (key: number) => timers.delete(key),
		},
	});
	Object.defineProperty(globalThis, 'Worker', {
		configurable: true,
		value: FakeWorker,
	});
	try {
		await run(timers);
	} finally {
		if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow);
		else Reflect.deleteProperty(globalThis, 'window');
		if (savedWorker) Object.defineProperty(globalThis, 'Worker', savedWorker);
		else Reflect.deleteProperty(globalThis, 'Worker');
	}
}

test('Worker: 成功/起動/送信/受信失敗の解放と再実行、入力漏れなし', async () => {
	await browser(async (timers) => {
		for (const scenario of [
			'success',
			'constructor',
			'post',
			'error',
			'messageerror',
			'bad',
			'unknown',
		]) {
			FakeWorker.scenario = scenario;
			const result = await tool.run(input);
			assert.equal(result.ok, scenario === 'success', scenario);
			if (!result.ok) assert.ok(!result.error.includes('private marker'));
			assert.equal(timers.size, 0);
			assert.ok(FakeWorker.instances.every((worker) => worker.terminated));
			if (scenario === 'error')
				assert.equal(FakeWorker.instances.at(-1)?.prevented, true);
			FakeWorker.scenario = 'success';
			assert.deepEqual(await compareTextInWorker(input), output);
		}
	});
});

test('Worker: 期限/同時実行拒否/解放後再実行（故障注入）', async () => {
	await browser(async (timers) => {
		FakeWorker.scenario = 'hang';
		const first = tool.run(input);
		const busy = await tool.run(input);
		assert.equal(busy.ok, false);
		if (!busy.ok) assert.equal(busy.error, DIFF_MESSAGES.busy);
		assert.equal(FakeWorker.instances.length, 1);
		const timeout = timers.values().next().value;
		assert.ok(timeout);
		timeout();
		const expired = await first;
		assert.equal(expired.ok, false);
		if (!expired.ok) assert.equal(expired.error, DIFF_MESSAGES.timeout);
		assert.equal(timers.size, 0);
		assert.equal(FakeWorker.instances[0].terminated, true);
		FakeWorker.scenario = 'success';
		assert.deepEqual(await compareTextInWorker(input), output);
	});
});

test('Worker不可は同期fallbackなし。検証失敗はWorker起動前', async () => {
	await browser(async () => {
		assert.equal(
			(await tool.run({ textA: 'x'.repeat(20001), textB: '' })).ok,
			false,
		);
		assert.equal(FakeWorker.instances.length, 0);
		Object.defineProperty(globalThis, 'Worker', {
			configurable: true,
			value: undefined,
		});
		const result = await tool.run(input);
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.error, DIFF_MESSAGES.unavailable);
	});
});
