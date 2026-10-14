import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPipelineLifecycle } from '../../src/lib/model-assets/pipeline-lifecycle.ts';

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
};
test('初期化・推論を直列化し、同じmodeは再利用、切替前に解放する', async () => {
	const events: string[] = [];
	const gate = deferred();
	const manager = createPipelineLifecycle(async (mode: string) => {
		events.push(`load:${mode}`);
		return {
			async dispose() {
				events.push(`dispose:${mode}`);
			},
		};
	});
	const first = manager.run('high', 'a', async () => {
		events.push('a:start');
		await gate.promise;
		events.push('a:end');
	});
	const second = manager.run('high', 'b', async () => {
		events.push('b');
	});
	const third = manager.run('fast', 'c', async () => {
		events.push('c');
	});
	await new Promise((r) => setImmediate(r));
	assert.deepEqual(events, ['load:high', 'a:start']);
	gate.resolve();
	await Promise.all([first, second, third]);
	assert.deepEqual(events, [
		'load:high',
		'a:start',
		'a:end',
		'b',
		'dispose:high',
		'load:fast',
		'c',
	]);
});
test('ロード・推論失敗が後続を止めず、ロード失敗時は再試行する', async () => {
	let loads = 0;
	const manager = createPipelineLifecycle(async () => {
		if (++loads === 1) throw Error('load');
		return { async dispose() {} };
	});
	await assert.rejects(
		manager.run('high', 'a', async () => {}),
		/load/,
	);
	await assert.rejects(
		manager.run('high', 'b', async () => {
			throw Error('inference');
		}),
		/inference/,
	);
	assert.equal(await manager.run('high', 'c', async () => 42), 42);
	assert.equal(loads, 2);
});
test('解放失敗時は新モデルを確保せず、次回解放を再試行する', async () => {
	let releases = 0;
	const loads: string[] = [];
	const manager = createPipelineLifecycle(async (mode: string) => {
		loads.push(mode);
		return {
			async dispose() {
				if (++releases === 1) throw Error('release');
			},
		};
	});
	await manager.run('high', 'a', async () => {});
	await assert.rejects(
		manager.run('fast', 'b', async () => {}),
		/release/,
	);
	assert.deepEqual(loads, ['high']);
	await manager.run('fast', 'c', async () => {});
	assert.deepEqual(loads, ['high', 'fast']);
	assert.equal(releases, 2);
});

test('解放失敗後は旧modeでも旧pipelineを使わず、再解放して再ロードする', async () => {
	let loads = 0;
	let releases = 0;
	const used: number[] = [];
	const manager = createPipelineLifecycle(async () => {
		const number = ++loads;
		return {
			number,
			async dispose() {
				if (++releases === 1) throw Error('partial release');
			},
		};
	});
	await manager.run('high', 'a', async (pipe) => {
		used.push(pipe.number);
	});
	await assert.rejects(
		manager.run('fast', 'b', async (pipe) => {
			used.push(pipe.number);
		}),
		/partial release/,
	);
	await manager.run('high', 'c', async (pipe) => {
		used.push(pipe.number);
	});
	assert.deepEqual(used, [1, 2]);
	assert.equal(releases, 2);
	assert.equal(loads, 2);
});
test('旧sessionのdispose完了前に新sessionをロードしない', async () => {
	const gate = deferred();
	const events: string[] = [];
	const manager = createPipelineLifecycle(async (mode: string) => {
		events.push(`load:${mode}`);
		return {
			async dispose() {
				events.push('dispose:start');
				await gate.promise;
				events.push('dispose:end');
			},
		};
	});
	await manager.run('high', 'a', async () => {});
	const switched = manager.run('fast', 'b', async () => {
		events.push('run:fast');
	});
	await new Promise((r) => setImmediate(r));
	assert.deepEqual(events, ['load:high', 'dispose:start']);
	gate.resolve();
	await switched;
	assert.deepEqual(events, [
		'load:high',
		'dispose:start',
		'dispose:end',
		'load:fast',
		'run:fast',
	]);
});
