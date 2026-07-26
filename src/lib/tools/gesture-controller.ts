// gesture-controller.ts — ポインタ操作を idle / drawing / two-finger-transform の
// 3状態として管理する純粋な状態遷移ロジック（reducer）。DOM・Reactに依存しない。
// 実際のPointerEventとの接続は src/lib/hooks/useGestureController.ts が担う。

import {
	computeDistance,
	computeMidpoint,
	type GeometryPoint,
} from './zoom-pan.ts';

export type GesturePoint = GeometryPoint;
export type GesturePhase = 'idle' | 'drawing' | 'two-finger-transform';

type Baseline = { distance: number; midpoint: GesturePoint };

export type GestureMachineState = {
	phase: GesturePhase;
	pointers: Map<number, GesturePoint>;
	singlePointerId: number | null;
	/**
	 * two-finger-transform から1本指に減った直後、残った指のpointerId。
	 * このIDのmove/up/cancelは単指操作として転送しない
	 * （「ピンチ後に残った1本指で意図せず描画が始まらない」ことを保証する）。
	 */
	suppressedPointerId: number | null;
	baseline: Baseline | null;
	lastMidpoint: GesturePoint | null;
};

export function createInitialGestureState(): GestureMachineState {
	return {
		phase: 'idle',
		pointers: new Map(),
		singlePointerId: null,
		suppressedPointerId: null,
		baseline: null,
		lastMidpoint: null,
	};
}

export type GestureEvent =
	| { type: 'down'; pointerId: number; point: GesturePoint }
	| { type: 'move'; pointerId: number; point: GesturePoint }
	| { type: 'up'; pointerId: number }
	| { type: 'cancel'; pointerId: number };

export type TwoFingerStartInfo = { distance: number; midpoint: GesturePoint };

export type TwoFingerMoveInfo = {
	startDistance: number;
	distance: number;
	startMidpoint: GesturePoint;
	midpoint: GesturePoint;
	previousMidpoint: GesturePoint;
};

export type GestureEffect =
	| { type: 'singleDown' }
	| { type: 'singleMove' }
	| { type: 'singleUp' }
	| { type: 'singleCancel' }
	| { type: 'singleInterrupted' }
	| { type: 'twoFingerStart'; info: TwoFingerStartInfo }
	| { type: 'twoFingerMove'; info: TwoFingerMoveInfo };

export type GestureReduceResult = {
	state: GestureMachineState;
	effects: GestureEffect[];
};

/** pointers Map（挿入順）の先頭2件を「基準ペア」として返す。2件未満なら null。 */
function primaryPair(
	pointers: Map<number, GesturePoint>,
): [GesturePoint, GesturePoint] | null {
	const iter = pointers.values();
	const a = iter.next();
	const b = iter.next();
	if (a.done || b.done) return null;
	return [a.value, b.value];
}

/** 呼び出し側で pointers.size >= 2 を確認済みの場合のみ呼ぶ（基準ペアが必ず取れる）。 */
function computeBaselineFromPair(pair: [GesturePoint, GesturePoint]): Baseline {
	return {
		distance: computeDistance(pair[0], pair[1]),
		midpoint: computeMidpoint(pair[0], pair[1]),
	};
}

export function reduceGestureEvent(
	state: GestureMachineState,
	event: GestureEvent,
): GestureReduceResult {
	const pointers = new Map(state.pointers);
	const effects: GestureEffect[] = [];

	if (event.type === 'down') {
		pointers.set(event.pointerId, event.point);
		const pair = primaryPair(pointers);
		if (pair) {
			if (state.phase === 'drawing')
				effects.push({ type: 'singleInterrupted' });
			const baseline = computeBaselineFromPair(pair);
			effects.push({ type: 'twoFingerStart', info: baseline });
			return {
				state: {
					phase: 'two-finger-transform',
					pointers,
					singlePointerId: null,
					suppressedPointerId: null,
					baseline,
					lastMidpoint: baseline.midpoint,
				},
				effects,
			};
		}
		effects.push({ type: 'singleDown' });
		return {
			state: {
				phase: 'drawing',
				pointers,
				singlePointerId: event.pointerId,
				suppressedPointerId: null,
				baseline: null,
				lastMidpoint: null,
			},
			effects,
		};
	}

	if (event.type === 'move') {
		if (state.phase === 'two-finger-transform') {
			if (!pointers.has(event.pointerId)) return { state, effects };
			pointers.set(event.pointerId, event.point);
			const pair = primaryPair(pointers);
			if (!pair || !state.baseline || !state.lastMidpoint) {
				return { state: { ...state, pointers }, effects };
			}
			const midpoint = computeMidpoint(pair[0], pair[1]);
			const distance = computeDistance(pair[0], pair[1]);
			effects.push({
				type: 'twoFingerMove',
				info: {
					startDistance: state.baseline.distance,
					distance,
					startMidpoint: state.baseline.midpoint,
					midpoint,
					previousMidpoint: state.lastMidpoint,
				},
			});
			return { state: { ...state, pointers, lastMidpoint: midpoint }, effects };
		}

		// 2本指解除直後に残った指のmoveは転送しない（drawingを誤って再開させないため）
		if (event.pointerId === state.suppressedPointerId) {
			pointers.set(event.pointerId, event.point);
			return { state: { ...state, pointers }, effects };
		}

		// idle/drawing かつ抑制対象でない: pointerdownを経ていないマウスの
		// 純粋なホバー移動も含め、常に singleMove として転送する
		if (pointers.has(event.pointerId))
			pointers.set(event.pointerId, event.point);
		effects.push({ type: 'singleMove' });
		return { state: { ...state, pointers }, effects };
	}

	// up / cancel
	if (event.pointerId === state.suppressedPointerId) {
		pointers.delete(event.pointerId);
		return {
			state: { ...state, pointers, suppressedPointerId: null },
			effects,
		};
	}
	if (!pointers.has(event.pointerId)) return { state, effects };
	pointers.delete(event.pointerId);

	if (state.phase === 'drawing' && event.pointerId === state.singlePointerId) {
		effects.push({ type: event.type === 'up' ? 'singleUp' : 'singleCancel' });
		return {
			state: {
				phase: 'idle',
				pointers,
				singlePointerId: null,
				suppressedPointerId: null,
				baseline: null,
				lastMidpoint: null,
			},
			effects,
		};
	}

	if (state.phase === 'two-finger-transform') {
		const pair = primaryPair(pointers);
		if (pair) {
			const baseline = computeBaselineFromPair(pair);
			effects.push({ type: 'twoFingerStart', info: baseline });
			return {
				state: {
					phase: 'two-finger-transform',
					pointers,
					singlePointerId: null,
					suppressedPointerId: null,
					baseline,
					lastMidpoint: baseline.midpoint,
				},
				effects,
			};
		}
		const remainingId = pointers.size === 1 ? [...pointers.keys()][0] : null;
		return {
			state: {
				phase: 'idle',
				pointers,
				singlePointerId: null,
				suppressedPointerId: remainingId ?? null,
				baseline: null,
				lastMidpoint: null,
			},
			effects,
		};
	}

	return { state: { ...state, pointers }, effects };
}
