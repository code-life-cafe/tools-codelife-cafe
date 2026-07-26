// useGestureController.ts — reducerをReactのPointerEventに接続する薄いアダプタ。
// イベント所有権はcanvas要素自身に固定する: 有効なpointerdownごとに
// setPointerCapture し、pointerup/pointercancel/lostpointercaptureで
// releasePointerCaptureする。これにより、削除✕ボタン等の兄弟オーバーレイに
// キャプチャを奪われず、canvas外へ出た指のイベントも確実にcanvasへ配送される。
import { useCallback, useRef } from 'react';
import {
	createInitialGestureState,
	type GestureMachineState,
	reduceGestureEvent,
	type TwoFingerMoveInfo,
	type TwoFingerStartInfo,
} from '@/lib/tools/gesture-controller';

type ReactPointerEvent = React.PointerEvent<HTMLCanvasElement>;

export type GestureControllerCallbacks = {
	onSinglePointerDown: (e: ReactPointerEvent) => void;
	onSinglePointerMove: (e: ReactPointerEvent) => void;
	onSinglePointerUp: (e: ReactPointerEvent) => void;
	onSinglePointerCancel: (e: ReactPointerEvent) => void;
	/** 単指操作中に2本目が追加された際、進行中の描画/ドラッグを破棄させるために一度だけ発火 */
	onSinglePointerInterrupted: () => void;
	onTwoFingerStart: (info: TwoFingerStartInfo) => void;
	onTwoFingerMove: (info: TwoFingerMoveInfo) => void;
};

export function useGestureController(callbacks: GestureControllerCallbacks) {
	const machineRef = useRef<GestureMachineState>(createInitialGestureState());
	const callbacksRef = useRef(callbacks);
	callbacksRef.current = callbacks;

	const dispatch = useCallback(
		(
			event:
				| {
						type: 'down' | 'move';
						pointerId: number;
						point: { x: number; y: number };
				  }
				| { type: 'up' | 'cancel'; pointerId: number },
			originalEvent: ReactPointerEvent,
		) => {
			const { state, effects } = reduceGestureEvent(machineRef.current, event);
			machineRef.current = state;
			const cb = callbacksRef.current;
			for (const effect of effects) {
				switch (effect.type) {
					case 'singleDown':
						cb.onSinglePointerDown(originalEvent);
						break;
					case 'singleMove':
						cb.onSinglePointerMove(originalEvent);
						break;
					case 'singleUp':
						cb.onSinglePointerUp(originalEvent);
						break;
					case 'singleCancel':
						cb.onSinglePointerCancel(originalEvent);
						break;
					case 'singleInterrupted':
						cb.onSinglePointerInterrupted();
						break;
					case 'twoFingerStart':
						cb.onTwoFingerStart(effect.info);
						break;
					case 'twoFingerMove':
						cb.onTwoFingerMove(effect.info);
						break;
				}
			}
		},
		[],
	);

	const onPointerDown = useCallback(
		(e: ReactPointerEvent) => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			e.currentTarget.setPointerCapture(e.pointerId);
			dispatch(
				{
					type: 'down',
					pointerId: e.pointerId,
					point: { x: e.clientX, y: e.clientY },
				},
				e,
			);
		},
		[dispatch],
	);

	const onPointerMove = useCallback(
		(e: ReactPointerEvent) => {
			dispatch(
				{
					type: 'move',
					pointerId: e.pointerId,
					point: { x: e.clientX, y: e.clientY },
				},
				e,
			);
		},
		[dispatch],
	);

	const endPointer = useCallback(
		(type: 'up' | 'cancel', e: ReactPointerEvent) => {
			if (e.currentTarget.hasPointerCapture(e.pointerId)) {
				e.currentTarget.releasePointerCapture(e.pointerId);
			}
			dispatch({ type, pointerId: e.pointerId }, e);
		},
		[dispatch],
	);

	const onPointerUp = useCallback(
		(e: ReactPointerEvent) => endPointer('up', e),
		[endPointer],
	);
	const onPointerCancel = useCallback(
		(e: ReactPointerEvent) => endPointer('cancel', e),
		[endPointer],
	);
	// ブラウザ側のジェスチャー横取り等でcaptureが失われた場合もcancelと同じ後始末経路を通す
	const onLostPointerCapture = useCallback(
		(e: ReactPointerEvent) => endPointer('cancel', e),
		[endPointer],
	);

	return {
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerCancel,
		onLostPointerCapture,
	};
}
