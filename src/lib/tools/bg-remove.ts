// bg-remove.ts — Worker ラッパ + Canvas 後処理
// UIから推論詳細を隠蔽し、Blob入力 → PNG Blob出力 のシンプルなAPIを提供

import type {
	ModelMode,
	WorkerRequest,
	WorkerResponse,
} from '@/workers/bg-remove.worker';

export type { ModelMode };

export type ProgressInfo = {
	status: string;
	progress: number;
	loaded?: number;
	total?: number;
	file?: string;
};

// --- Worker シングルトン ---
let worker: Worker | null = null;

// 現在進行中の removeBackground 呼び出し（同時に1件のみ）。
// 新しい呼び出しで上書きされた場合や Worker 終了時に、
// 古いリスナーの解除と Promise の reject を確実に行うために保持する。
let activeCall: {
	id: string;
	handler: (e: MessageEvent<WorkerResponse>) => void;
	reject: (reason: unknown) => void;
} | null = null;

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(
			new URL('../../workers/bg-remove.worker.ts', import.meta.url),
			{ type: 'module' },
		);
	}
	return worker;
}

/** 進行中の呼び出しがあれば、リスナーを解除し reject してから破棄する */
function cancelActiveCall(w: Worker, reason: string): void {
	if (!activeCall) return;
	const current = activeCall;
	activeCall = null;
	w.removeEventListener('message', current.handler);
	current.reject(new Error(reason));
}

/**
 * 明示的な先行初期化用。
 * 通常はファイル選択後に removeBackground 経由で必要なモデルだけ読み込む。
 */
export function preload(mode: ModelMode = 'high'): void {
	const w = getWorker();
	w.postMessage({
		id: 'preload',
		mode,
		preloadOnly: true,
	} satisfies WorkerRequest);
}

/**
 * Worker を終了してリソースを解放
 */
export function terminateWorker(): void {
	if (worker) {
		cancelActiveCall(worker, 'Worker が終了されました');
		worker.terminate();
		worker = null;
	}
}

/**
 * 画像ファイルから背景を削除し、透過 PNG の Blob を返す
 */
export function removeBackground(
	file: Blob,
	mode: ModelMode,
	onProgress?: (info: ProgressInfo) => void,
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const w = getWorker();
		const id = crypto.randomUUID();

		// 前回呼び出しが完了・失敗していない場合は上書きとみなし、
		// 古いリスナーを解除してその Promise を reject する（メモリリーク防止）。
		cancelActiveCall(w, '新しい処理により上書きされました');

		// このハンドラを Worker から確実に外し、activeCall を自分自身に限って解放する
		const cleanup = () => {
			w.removeEventListener('message', handler);
			if (activeCall?.id === id) activeCall = null;
		};

		const handler = (e: MessageEvent<WorkerResponse>) => {
			const msg = e.data;

			// progress は自分の処理 id に一致するものだけ通知する
			// （preload や並行処理からの進捗混信を防止）
			if (msg.type === 'progress') {
				if (msg.id !== id) return;
				onProgress?.({
					status: msg.payload.status,
					progress: msg.payload.progress ?? 0,
					loaded: msg.payload.loaded,
					total: msg.payload.total,
					file: msg.payload.file,
				});
				return;
			}

			// id が一致するメッセージのみ処理
			if (!('id' in msg) || msg.id !== id) return;

			if (msg.type === 'result') {
				cleanup();

				// RGBA ピクセルデータを Canvas 経由で PNG Blob に変換
				const rgba = new Uint8ClampedArray(msg.data);
				const imageData = new ImageData(rgba, msg.width, msg.height);

				const canvas = document.createElement('canvas');
				canvas.width = msg.width;
				canvas.height = msg.height;
				const ctx = canvas.getContext('2d');

				if (!ctx) {
					reject(new Error('Canvas 2D コンテキストの取得に失敗しました'));
					return;
				}

				ctx.putImageData(imageData, 0, 0);

				canvas.toBlob((blob) => {
					if (blob) {
						resolve(blob);
					} else {
						reject(new Error('PNG Blob の生成に失敗しました'));
					}
				}, 'image/png');
			}

			if (msg.type === 'error') {
				cleanup();
				reject(new Error(msg.message));
			}
		};

		activeCall = {
			id,
			handler,
			reject: (reason) => {
				cleanup();
				reject(reason);
			},
		};

		w.addEventListener('message', handler);

		// File/Blob → ArrayBuffer → Worker へ transferable 送信
		file
			.arrayBuffer()
			.then((buffer) => {
				w.postMessage(
					{
						id,
						mode,
						imageData: buffer,
						mimeType: file.type || 'application/octet-stream',
					} satisfies WorkerRequest,
					[buffer],
				);
			})
			.catch((err) => {
				cleanup();
				reject(err);
			});
	});
}

/**
 * 透過画像に背景色/画像を合成して新しい PNG Blob を返す
 */
export async function compositeBackground(
	foregroundBlob: Blob,
	background: { type: 'color'; value: string } | { type: 'image'; value: Blob },
): Promise<Blob> {
	const img = await createImageBitmap(foregroundBlob);
	const canvas = document.createElement('canvas');
	canvas.width = img.width;
	canvas.height = img.height;
	const ctx = canvas.getContext('2d');

	if (!ctx) {
		throw new Error('Canvas 2D コンテキストの取得に失敗しました');
	}

	// 背景を描画
	if (background.type === 'color') {
		ctx.fillStyle = background.value;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	} else {
		const bgImg = await createImageBitmap(background.value);
		ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
		bgImg.close();
	}

	// 前景（透過済み）を重ねる
	ctx.drawImage(img, 0, 0);
	img.close();

	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new Error('合成画像の生成に失敗しました'));
			}
		}, 'image/png');
	});
}
