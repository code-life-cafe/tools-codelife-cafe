import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, before, test } from 'node:test';
import type {
	WorkerRequest,
	WorkerResponse,
} from '../../src/lib/transcribe/protocol.ts';

// 実際のWorkerハンドラを通す。推論エンジンだけを置き換え、モデル取得・外部通信をしない。
// 音声認識の精度ではなく、無音の推論抑止と出力セグメントの検証を担当する。
const inference = {
	inputs: [] as Float32Array[],
	output: {
		text: '',
		chunks: [] as { timestamp: [number, number | null]; text: string }[],
	},
};
const messages: WorkerResponse[] = [];
const worker = {
	onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null,
	addEventListener() {},
	postMessage(message: WorkerResponse) {
		messages.push(message);
	},
};
const globals = globalThis as unknown as Record<string, unknown>;
const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');

before(async () => {
	globals.__transcribeWorkerTest = inference;
	Object.defineProperty(globalThis, 'self', {
		configurable: true,
		value: worker,
	});
	const hooks = registerHooks({
		resolve(specifier, context, nextResolve) {
			return specifier === '@huggingface/transformers'
				? { url: 'test:transcribe-transformers', shortCircuit: true }
				: nextResolve(specifier, context);
		},
		load(url, context, nextLoad) {
			if (url !== 'test:transcribe-transformers') return nextLoad(url, context);
			return {
				format: 'module',
				shortCircuit: true,
				source: `
export const env = {};
export class WhisperTextStreamer {
	constructor(tokenizer, callbacks) { this.callbacks = callbacks; }
}
export async function pipeline() {
	return async (audio, options) => {
		const state = globalThis.__transcribeWorkerTest;
		state.inputs.push(audio);
		for (const chunk of state.output.chunks) {
			options.streamer.callbacks.on_chunk_start(chunk.timestamp[0]);
			options.streamer.callbacks.callback_function(chunk.text);
			options.streamer.callbacks.on_chunk_end(chunk.timestamp[1] ?? chunk.timestamp[0]);
		}
		return state.output;
	};
}
`,
			};
		},
	});
	try {
		await import('../../src/workers/transcribe.worker.ts');
	} finally {
		hooks.deregister();
	}
	await worker.onmessage?.({
		data: { type: 'load', modelId: 'tiny', device: 'wasm' },
	});
	assert.ok(messages.some((message) => message.type === 'ready'));
});

after(() => {
	delete globals.__transcribeWorkerTest;
	if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
	else delete globals.self;
});

async function run(audio: Float32Array) {
	messages.length = 0;
	inference.inputs.length = 0;
	assert.ok(worker.onmessage);
	await worker.onmessage({
		data: { type: 'transcribe', audio, language: 'ja' },
	});
	assert.equal(
		messages.some((message) => message.type === 'error'),
		false,
	);
	const done = messages.find((message) => message.type === 'done');
	assert.ok(done);
	return done.segments;
}

test('3秒・16kHzの全ゼロPCMは推論せず空結果を返し、反復文を表示しない', async () => {
	inference.output = {
		text: '架空の反復文',
		chunks: [{ timestamp: [0, 0], text: '架空の反復文' }],
	};
	assert.deepEqual(await run(new Float32Array(3 * 16000)), []);
	assert.equal(inference.inputs.length, 0);
	assert.equal(
		messages.some((message) => message.type === 'segment'),
		false,
	);
});

for (const amplitude of [0.5, 1 / 32768, 1e-10]) {
	test(`非ゼロ音声（振幅 ${amplitude}）は前後の無音も含めてそのまま推論する`, async () => {
		const audio = new Float32Array(3 * 16000);
		audio[16000] = amplitude;
		audio[16001] = -amplitude;
		const original = audio.slice();
		inference.output = {
			text: 'こんにちは',
			chunks: [{ timestamp: [1, 1.5], text: 'こんにちは' }],
		};
		assert.deepEqual(await run(audio), [
			{ id: 1, start: 1, end: 1.5, text: 'こんにちは' },
		]);
		assert.equal(inference.inputs[0], audio);
		assert.deepEqual(audio, original);
	});
}

test('0秒・逆転セグメントは暫定表示と最終結果の両方から除き、有効な発話を残す', async () => {
	inference.output = {
		text: '架空 はい',
		chunks: [
			{ timestamp: [0, 0], text: '架空' },
			{ timestamp: [2, 1], text: '逆転' },
			{ timestamp: [1, 1.01], text: 'はい' },
		],
	};
	const segments = await run(Float32Array.of(0.5));
	assert.deepEqual(
		segments.map(({ start, end, text }) => ({ start, end, text })),
		[{ start: 1, end: 1.01, text: 'はい' }],
	);
	const partial = messages.filter((message) => message.type === 'segment');
	assert.equal(partial.length, 1);
	assert.equal(partial[0].segment.text, 'はい');
});

test('異常セグメントを全件除去しても全文fallbackで復活させない', async () => {
	inference.output = {
		text: '架空の反復文',
		chunks: [{ timestamp: [0, 0], text: '架空の反復文' }],
	};
	assert.deepEqual(await run(Float32Array.of(0.5)), []);
});

test('終了時刻が未確定の実発話は次の開始時刻・音声末尾までとして保持する', async () => {
	inference.output = {
		text: 'こんにちは 世界',
		chunks: [
			{ timestamp: [1, null], text: 'こんにちは' },
			{ timestamp: [2, null], text: '世界' },
		],
	};
	assert.deepEqual(await run(new Float32Array(3 * 16000).fill(0.5)), [
		{ id: 1, start: 1, end: 2, text: 'こんにちは' },
		{ id: 2, start: 2, end: 3, text: '世界' },
	]);
});

test('時刻情報自体がない通常の全文結果は従来どおり保持する', async () => {
	inference.output = { text: 'こんにちは', chunks: [] };
	assert.deepEqual(await run(Float32Array.of(0.5)), [
		{ id: 1, start: 0, end: 1 / 16000, text: 'こんにちは' },
	]);
});
