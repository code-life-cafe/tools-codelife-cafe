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

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(
			new URL('../../workers/bg-remove.worker.ts', import.meta.url),
			{ type: 'module' },
		);
	}
	return worker;
}

/**
 * ページ表示時に先行初期化（lazy preload）
 * モデルを事前ダウンロードし、ドロップ即実行を可能にする
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

		const handler = (e: MessageEvent<WorkerResponse>) => {
			const msg = e.data;

			// progress は id に関係なく全て通知
			if (msg.type === 'progress') {
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
				w.removeEventListener('message', handler);

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
				w.removeEventListener('message', handler);
				reject(new Error(msg.message));
			}
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
			.catch(reject);
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
