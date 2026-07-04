import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	createResourceTracker,
	createRunTracker,
} from '../../src/lib/hooks/useProcessingLifecycle.ts';
import { runSingleResult } from '../../src/lib/hooks/useSingleResultProcessing.ts';

/** テスト内で processor の完了タイミングを外部から制御するためのヘルパー */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('runSingleResult', () => {
	it('processor から呼ばれた進捗コールバックがそのまま onProgress に反映される', async () => {
		const runner = createRunTracker();
		const progress: { done: number; total: number }[] = [];

		await runSingleResult(
			runner,
			async (onProgress) => {
				onProgress(1, 3);
				onProgress(2, 3);
				onProgress(3, 3);
				return 'result';
			},
			{
				onProgress: (p) => progress.push(p),
				onSuccess: () => {},
				onStaleResult: () => {},
				onError: () => {},
				onSettled: () => {},
			},
			'失敗しました',
		);

		assert.deepEqual(progress, [
			{ done: 1, total: 3 },
			{ done: 2, total: 3 },
			{ done: 3, total: 3 },
		]);
	});

	it('キャンセル後に処理が完了した場合、onSuccess ではなく onStaleResult が呼ばれる（結果は解放対象）', async () => {
		const runner = createRunTracker();
		const success: string[] = [];
		const stale: string[] = [];
		let settledCalled = false;
		const { promise, resolve } = deferred<string>();

		const run = runSingleResult(
			runner,
			async () => promise,
			{
				onProgress: () => {},
				onSuccess: (r) => success.push(r),
				onStaleResult: (r) => stale.push(r),
				onError: () => {},
				onSettled: () => {
					settledCalled = true;
				},
			},
			'失敗しました',
		);

		runner.cancel();
		resolve('blob-url-result');
		await run;

		assert.deepEqual(success, []);
		assert.deepEqual(stale, ['blob-url-result']);
		assert.equal(settledCalled, false);
	});

	it('processor完了前に新しいランが開始された場合（runId不一致）、古いランの結果は onStaleResult に渡される', async () => {
		const runner = createRunTracker();
		const success: string[] = [];
		const stale: string[] = [];
		const { promise, resolve } = deferred<string>();

		const oldRun = runSingleResult(
			runner,
			async () => promise,
			{
				onProgress: () => {},
				onSuccess: (r) => success.push(r),
				onStaleResult: (r) => stale.push(r),
				onError: () => {},
				onSettled: () => {},
			},
			'失敗しました',
		);

		// 古いランが完了するより先に、新しいランを開始して中断させる
		runner.beginRun();
		resolve('old-run-result');
		await oldRun;

		assert.deepEqual(success, []);
		assert.deepEqual(stale, ['old-run-result']);
	});

	it('中断された結果がObjectURLを保持している場合、releaseで確実にrevokeされる', async () => {
		const runner = createRunTracker();
		const resourceTracker = createResourceTracker<{ url: string }>();
		const revoked: string[] = [];
		const release = (r: { url: string }) => revoked.push(r.url);
		const { promise, resolve } = deferred<{ url: string }>();

		const run = runSingleResult(
			runner,
			async () => promise,
			{
				onProgress: () => {},
				onSuccess: (r) => resourceTracker.track([r]),
				onStaleResult: (r) => release(r),
				onError: () => {},
				onSettled: () => {},
			},
			'失敗しました',
		);

		runner.cancel();
		resolve({ url: 'blob:stale-result' });
		await run;

		assert.deepEqual(revoked, ['blob:stale-result']);

		// 通常完了時は resourceTracker に追跡させ、次ランの releaseAll で解放される
		const runner2 = createRunTracker();
		await runSingleResult(
			runner2,
			async () => ({ url: 'blob:kept-result' }),
			{
				onProgress: () => {},
				onSuccess: (r) => resourceTracker.track([r]),
				onStaleResult: () => {},
				onError: () => {},
				onSettled: () => {},
			},
			'失敗しました',
		);
		resourceTracker.releaseAll(release);

		assert.deepEqual(revoked, ['blob:stale-result', 'blob:kept-result']);
	});

	it('processorが失敗した場合、ラン継続中であればonErrorにメッセージが渡りonSettledが呼ばれる', async () => {
		const runner = createRunTracker();
		const errors: string[] = [];
		let settledCalled = false;

		await runSingleResult(
			runner,
			async () => {
				throw new Error('boom');
			},
			{
				onProgress: () => {},
				onSuccess: () => {},
				onStaleResult: () => {},
				onError: (message) => errors.push(message),
				onSettled: () => {
					settledCalled = true;
				},
			},
			'失敗しました',
		);

		assert.deepEqual(errors, ['boom']);
		assert.equal(settledCalled, true);
	});

	it('Errorインスタンスでない例外の場合はfallbackErrorMessageが使われる', async () => {
		const runner = createRunTracker();
		const errors: string[] = [];

		await runSingleResult(
			runner,
			async () => {
				throw 'not-an-error';
			},
			{
				onProgress: () => {},
				onSuccess: () => {},
				onStaleResult: () => {},
				onError: (message) => errors.push(message),
				onSettled: () => {},
			},
			'失敗しました',
		);

		assert.deepEqual(errors, ['失敗しました']);
	});
});
