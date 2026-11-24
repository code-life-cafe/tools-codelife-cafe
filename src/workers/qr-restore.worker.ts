// qr-restore.worker.ts — QRコード復元（前処理を順に試して読み取る）を Web Worker に隔離
// zxing-wasm/reader（MIT）を使用。/qr-restore ページでのみ動的に起動されるため、
// WASM が他ツールのバンドルに含まれることはない。WASM は同一オリジンから配信する
// （qr-reader.worker.ts と同じ理由。外部CDNを参照しない）。

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import {
	type GrayImage,
	grayToRgba,
	limitPixels,
	type RestoreAttempt,
	type RestoreProgress,
	resize,
	rgbaToGray,
	runRestore,
} from '@/lib/tools/qr-restore';

/** 画面に返す補正後画像の最大辺（表示用に縮小する） */
const PREVIEW_MAX_SIDE = 640;

let modulePrepared = false;

function ensureModulePrepared(): void {
	if (modulePrepared) return;
	prepareZXingModule({
		overrides: { locateFile: () => zxingWasmUrl },
		fireImmediately: false,
	});
	modulePrepared = true;
}

async function decodeGray(image: GrayImage): Promise<string[]> {
	const imageData = new ImageData(
		grayToRgba(image) as Uint8ClampedArray<ArrayBuffer>,
		image.width,
		image.height,
	);
	const results = await readBarcodes(imageData, {
		formats: ['QRCode'],
		maxNumberOfSymbols: 8,
	});
	return results.map((r) => r.text);
}

function toPreview(image: GrayImage): RestorePreview {
	const side = Math.max(image.width, image.height);
	const scaled =
		side > PREVIEW_MAX_SIDE
			? resize(
					image,
					Math.max(1, Math.round((image.width * PREVIEW_MAX_SIDE) / side)),
					Math.max(1, Math.round((image.height * PREVIEW_MAX_SIDE) / side)),
				)
			: image;
	return {
		width: scaled.width,
		height: scaled.height,
		rgba: grayToRgba(scaled),
	};
}

// --- メッセージ型 ---

export type RestorePreview = {
	width: number;
	height: number;
	rgba: Uint8ClampedArray;
};

// 中断は呼び出し側が Worker を terminate して行う（復元中は Worker がメッセージを
// 受け取れないため、中断メッセージは使わない）。
export type RestoreWorkerRequest = { type: 'restore'; id: string; blob: Blob };

export type RestoreWorkerResponse =
	| ({ type: 'progress'; id: string } & RestoreProgress)
	| {
			type: 'success';
			id: string;
			texts: string[];
			stepLabel: string;
			attempts: RestoreAttempt[];
			preview: RestorePreview;
	  }
	| { type: 'failed'; id: string; attempts: RestoreAttempt[] }
	| { type: 'error'; id: string; message: string };

async function loadGray(blob: Blob): Promise<GrayImage> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(blob);
	} catch {
		throw new Error(
			'画像を読み込めませんでした。ファイルが壊れていないか確認してください',
		);
	}
	try {
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('画像処理の準備に失敗しました');
		ctx.drawImage(bitmap, 0, 0);
		const { data, width, height } = ctx.getImageData(
			0,
			0,
			bitmap.width,
			bitmap.height,
		);
		return limitPixels(rgbaToGray(data, width, height));
	} finally {
		bitmap.close();
	}
}

self.onmessage = async (e: MessageEvent<RestoreWorkerRequest>) => {
	const req = e.data;
	const post = (msg: RestoreWorkerResponse, transfer: Transferable[] = []) =>
		self.postMessage(msg, { transfer });
	try {
		ensureModulePrepared();
		const gray = await loadGray(req.blob);
		const outcome = await runRestore(gray, decodeGray, {
			onProgress: (p) => post({ type: 'progress', id: req.id, ...p }),
		});
		if (outcome.status === 'success') {
			const preview = toPreview(outcome.image);
			post(
				{
					type: 'success',
					id: req.id,
					texts: outcome.texts,
					stepLabel: outcome.step.label,
					attempts: outcome.attempts,
					preview,
				},
				[preview.rgba.buffer],
			);
		} else {
			post({ type: 'failed', id: req.id, attempts: outcome.attempts });
		}
	} catch (err: unknown) {
		post({
			type: 'error',
			id: req.id,
			message: err instanceof Error ? err.message : String(err),
		});
	}
};
