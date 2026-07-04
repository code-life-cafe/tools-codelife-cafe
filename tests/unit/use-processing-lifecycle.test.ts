import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	createResourceTracker,
	createRunTracker,
} from '../../src/lib/hooks/useProcessingLifecycle.ts';

describe('createRunTracker', () => {
	it('cancel()を呼ぶと、直前に取得したrunIdのisCurrentがfalseになる（キャンセル伝播）', () => {
		const tracker = createRunTracker();
		const runId = tracker.beginRun();
		assert.equal(tracker.isCurrent(runId), true);

		tracker.cancel();

		assert.equal(tracker.isCurrent(runId), false);
	});

	it('新しいbeginRun()が呼ばれると、古いrunIdのisCurrentがfalseになる（runId不一致時の中断）', () => {
		const tracker = createRunTracker();
		const oldRunId = tracker.beginRun();

		const newRunId = tracker.beginRun();

		assert.notEqual(oldRunId, newRunId);
		assert.equal(tracker.isCurrent(oldRunId), false);
		assert.equal(tracker.isCurrent(newRunId), true);
	});

	it('beginRun()はキャンセル状態をリセットする', () => {
		const tracker = createRunTracker();
		const firstRunId = tracker.beginRun();
		tracker.cancel();
		assert.equal(tracker.isCurrent(firstRunId), false);

		const secondRunId = tracker.beginRun();

		assert.equal(tracker.isCurrent(secondRunId), true);
	});
});

describe('createResourceTracker', () => {
	it('releaseAll()はtrack()で登録した全リソースに対して解放関数を呼ぶ（アンマウント時のrevoke相当）', () => {
		const tracker = createResourceTracker<string>();
		const released: string[] = [];
		tracker.track(['a', 'b', 'c']);

		tracker.releaseAll((r) => released.push(r));

		assert.deepEqual(released, ['a', 'b', 'c']);
	});

	it('track()で差し替えた後は、新しい登録内容のみが解放対象になる', () => {
		const tracker = createResourceTracker<string>();
		tracker.track(['old']);

		tracker.track(['new']);
		const released: string[] = [];
		tracker.releaseAll((r) => released.push(r));

		assert.deepEqual(released, ['new']);
	});

	it('releaseAll()にrelease未指定でも例外を投げない', () => {
		const tracker = createResourceTracker<string>();
		tracker.track(['a']);

		assert.doesNotThrow(() => tracker.releaseAll());
	});
});
