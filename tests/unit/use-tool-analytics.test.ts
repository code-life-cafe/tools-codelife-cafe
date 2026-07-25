import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	cancelDebounced,
	DEBOUNCE_MS,
	type DebounceHandle,
	scheduleDebounced,
} from '../../src/lib/hooks/useToolAnalytics.ts';

test('scheduleDebounced: 500ms以内の連続呼び出しは実行を1回にまとめる', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const handle: DebounceHandle = { current: null };
	let calls = 0;

	for (let i = 0; i < 10; i++) {
		scheduleDebounced(
			handle,
			() => {
				calls++;
			},
			DEBOUNCE_MS,
		);
		t.mock.timers.tick(100);
	}
	assert.strictEqual(calls, 0);

	t.mock.timers.tick(DEBOUNCE_MS);
	assert.strictEqual(calls, 1);
});

test('scheduleDebounced: 待機を挟めば複数回実行される', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const handle: DebounceHandle = { current: null };
	let calls = 0;

	scheduleDebounced(handle, () => calls++, DEBOUNCE_MS);
	t.mock.timers.tick(DEBOUNCE_MS);
	assert.strictEqual(calls, 1);

	scheduleDebounced(handle, () => calls++, DEBOUNCE_MS);
	t.mock.timers.tick(DEBOUNCE_MS);
	assert.strictEqual(calls, 2);
});

test('cancelDebounced: キャンセルすると保留中の実行が起きない（アンマウント相当）', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const handle: DebounceHandle = { current: null };
	let calls = 0;

	scheduleDebounced(handle, () => calls++, DEBOUNCE_MS);
	cancelDebounced(handle);
	t.mock.timers.tick(DEBOUNCE_MS * 2);

	assert.strictEqual(calls, 0);
});

test('cancelDebounced: 保留タイマーが無い状態で呼んでもエラーにならない', () => {
	const handle: DebounceHandle = { current: null };
	assert.doesNotThrow(() => cancelDebounced(handle));
});

test('scheduleDebounced: 独立したハンドル同士は互いに影響しない（別ツールslug相当）', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const handleA: DebounceHandle = { current: null };
	const handleB: DebounceHandle = { current: null };
	let callsA = 0;
	let callsB = 0;

	scheduleDebounced(handleA, () => callsA++, DEBOUNCE_MS);
	t.mock.timers.tick(200);
	scheduleDebounced(handleB, () => callsB++, DEBOUNCE_MS);
	t.mock.timers.tick(DEBOUNCE_MS - 200);

	// handleA は最初の呼び出しから DEBOUNCE_MS 経過済みなので発火、handleB はまだ
	assert.strictEqual(callsA, 1);
	assert.strictEqual(callsB, 0);

	t.mock.timers.tick(200);
	assert.strictEqual(callsB, 1);
});
