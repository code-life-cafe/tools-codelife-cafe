import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	cancelReset,
	type ResetHandle,
	scheduleReset,
} from '../../src/lib/hooks/useCopyFeedback.ts';

test('scheduleReset: delayMs 経過後に fn が1回だけ実行される', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const handle: ResetHandle = { current: null };
	let calls = 0;

	scheduleReset(handle, () => calls++, 2000);
	t.mock.timers.tick(1999);
	assert.strictEqual(calls, 0);

	t.mock.timers.tick(1);
	assert.strictEqual(calls, 1);
});

test('scheduleReset: 連打（連続呼び出し）しても古いタイマーが新しい表示を早期に消さない', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const handle: ResetHandle = { current: null };
	const calls: number[] = [];

	scheduleReset(handle, () => calls.push(1), 2000);
	t.mock.timers.tick(1000);
	// 1000ms経過時点で連打（表示をやり直す）。古いタイマーは解除され、新たに2000ms後まで延長される
	scheduleReset(handle, () => calls.push(2), 2000);
	t.mock.timers.tick(1000);
	assert.deepEqual(calls, []);

	t.mock.timers.tick(1000);
	assert.deepEqual(calls, [2]);
});

test('cancelReset: 保留中のタイマーを解除すると fn は実行されない（アンマウント相当）', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const handle: ResetHandle = { current: null };
	let calls = 0;

	scheduleReset(handle, () => calls++, 2000);
	cancelReset(handle);
	t.mock.timers.tick(4000);

	assert.strictEqual(calls, 0);
	assert.strictEqual(handle.current, null);
});

test('cancelReset: 保留タイマーが無い状態で呼んでもエラーにならない', () => {
	const handle: ResetHandle = { current: null };
	assert.doesNotThrow(() => cancelReset(handle));
});
