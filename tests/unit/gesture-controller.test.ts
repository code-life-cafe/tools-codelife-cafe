// 実行方法: npm run test:unit
// idle / drawing / two-finger-transform の状態遷移と、各遷移で発火する
// GestureEffect（UI側フックへの通知イベント）を検証する。
// DOM操作自体は E2E（Task 3.4以降）で検証する。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createInitialGestureState,
	reduceGestureEvent,
} from '../../src/lib/tools/gesture-controller.ts';

test('1本指down: drawingへ遷移しsingleDownが発火する', () => {
	const s0 = createInitialGestureState();
	const { state, effects } = reduceGestureEvent(s0, {
		type: 'down',
		pointerId: 1,
		point: { x: 0, y: 0 },
	});
	assert.equal(state.phase, 'drawing');
	assert.deepEqual(effects, [{ type: 'singleDown' }]);
});

test('drawing中に2本目down: singleInterrupted→twoFingerStartの順で発火し two-finger-transform へ遷移する', () => {
	let s = createInitialGestureState();
	({ state: s } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 1,
		point: { x: 0, y: 0 },
	}));
	const { state, effects } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 2,
		point: { x: 10, y: 0 },
	});
	assert.equal(state.phase, 'two-finger-transform');
	assert.deepEqual(
		effects.map((e) => e.type),
		['singleInterrupted', 'twoFingerStart'],
	);
});

test('idleでの2本指down（drawing経由でない）: singleInterruptedは発火せずtwoFingerStartのみ', () => {
	let s = createInitialGestureState();
	({ state: s } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 1,
		point: { x: 0, y: 0 },
	}));
	({ state: s } = reduceGestureEvent(s, { type: 'up', pointerId: 1 }));
	const { effects } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 2,
		point: { x: 0, y: 0 },
	});
	assert.deepEqual(effects, [{ type: 'singleDown' }]);
});

test('two-finger-transform中の3本目down: 基準ペアは先頭2件のまま再初期化される', () => {
	let s = createInitialGestureState();
	({ state: s } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 1,
		point: { x: 0, y: 0 },
	}));
	({ state: s } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 2,
		point: { x: 10, y: 0 },
	}));
	const { state, effects } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 3,
		point: { x: 5, y: 5 },
	});
	assert.equal(state.phase, 'two-finger-transform');
	assert.deepEqual(
		effects.map((e) => e.type),
		['twoFingerStart'],
	);
	const info = (
		effects[0] as {
			type: 'twoFingerStart';
			info: { midpoint: { x: number; y: number } };
		}
	).info;
	assert.deepEqual(info.midpoint, { x: 5, y: 0 });
});

test('two-finger-transform中に基準ペアの1本が離脱: 残った2点で再初期化される（指の入れ替わり）', () => {
	let s = createInitialGestureState();
	({ state: s } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 1,
		point: { x: 0, y: 0 },
	}));
	({ state: s } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 2,
		point: { x: 10, y: 0 },
	}));
	({ state: s } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 3,
		point: { x: 20, y: 0 },
	}));
	const { state, effects } = reduceGestureEvent(s, {
		type: 'up',
		pointerId: 1,
	});
	assert.equal(state.phase, 'two-finger-transform');
	assert.deepEqual(
		effects.map((e) => e.type),
		['twoFingerStart'],
	);
	const info = (
		effects[0] as {
			type: 'twoFingerStart';
			info: { midpoint: { x: number; y: number } };
		}
	).info;
	assert.deepEqual(info.midpoint, { x: 15, y: 0 });
});

test('2本指から1本指へ: idleへ遷移し、残った指のmove/upはsingle系イベントを発火しない', () => {
	let s = createInitialGestureState();
	({ state: s } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 1,
		point: { x: 0, y: 0 },
	}));
	({ state: s } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 2,
		point: { x: 10, y: 0 },
	}));
	({ state: s } = reduceGestureEvent(s, { type: 'up', pointerId: 2 }));
	assert.equal(s.phase, 'idle');
	assert.equal(s.suppressedPointerId, 1);
	const moveResult = reduceGestureEvent(s, {
		type: 'move',
		pointerId: 1,
		point: { x: 1, y: 1 },
	});
	assert.deepEqual(moveResult.effects, []);
	const upResult = reduceGestureEvent(moveResult.state, {
		type: 'up',
		pointerId: 1,
	});
	assert.deepEqual(upResult.effects, []);
	assert.equal(upResult.state.suppressedPointerId, null);
});

test('pointerdownを経ていない純粋なホバー移動はsingleMoveとして転送される', () => {
	const s0 = createInitialGestureState();
	const { effects } = reduceGestureEvent(s0, {
		type: 'move',
		pointerId: 99,
		point: { x: 5, y: 5 },
	});
	assert.deepEqual(effects, [{ type: 'singleMove' }]);
});

test('two-finger-transform中のmoveはtwoFingerMoveのみ発火しsingleMoveは発火しない', () => {
	let s = createInitialGestureState();
	({ state: s } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 1,
		point: { x: 0, y: 0 },
	}));
	({ state: s } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 2,
		point: { x: 10, y: 0 },
	}));
	const { effects } = reduceGestureEvent(s, {
		type: 'move',
		pointerId: 1,
		point: { x: 2, y: 0 },
	});
	assert.equal(effects.length, 1);
	assert.equal(effects[0].type, 'twoFingerMove');
});

test('pointercancelはpointerupと同じ後始末経路を通る（singleCancel発火）', () => {
	let s = createInitialGestureState();
	({ state: s } = reduceGestureEvent(s, {
		type: 'down',
		pointerId: 1,
		point: { x: 0, y: 0 },
	}));
	const { state, effects } = reduceGestureEvent(s, {
		type: 'cancel',
		pointerId: 1,
	});
	assert.equal(state.phase, 'idle');
	assert.deepEqual(effects, [{ type: 'singleCancel' }]);
});
