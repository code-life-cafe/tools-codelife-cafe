// qr-reader.worker.ts — QRコードデコードを Web Worker に隔離
// zxing-wasm/reader（MIT）を使用。/qr-reader ページでのみ動的 import される
// ため、WASM チャンクが他ツールのバンドルに含まれることはない。

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
// Vite の `?url` サフィックスで .wasm をハッシュ付きアセットとして自己配信する。
// zxing-wasm の既定 locateFile は jsDelivr CDN を参照するが、本プロジェクトは
// 完全クライアントサイド処理かつオフライン動作（PWA）を前提とするため、
// 同一オリジンから配信する（Service Worker のランタイムキャッシュ対象）。
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

let modulePrepared = false;

function ensureModulePrepared(): void {
	if (modulePrepared) return;
	prepareZXingModule({
		overrides: {
			locateFile: () => zxingWasmUrl,
		},
		fireImmediately: false,
	});
	modulePrepared = true;
}

export type DecodedSymbol = {
	text: string;
};

/**
 * ImageData / Blob から QRコードをデコードする。
 * zxing-wasm モジュールは初回呼び出し時に遅延初期化される（lazily init）。
 */
export async function decodeSymbols(
	source: ImageData | Blob,
	options?: { maxSymbols?: number },
): Promise<DecodedSymbol[]> {
	ensureModulePrepared();

	const results = await readBarcodes(source, {
		formats: ['QRCode'],
		maxNumberOfSymbols: options?.maxSymbols ?? 64,
	});

	return results.map((r) => ({ text: r.text }));
}

// --- メッセージ型定義 ---

export type WorkerRequest =
	| {
			type: 'decodeFrame';
			id: string;
			imageData: ImageData;
			maxSymbols?: number;
	  }
	| {
			type: 'decodeImageFile';
			id: string;
			fileName: string;
			blob: Blob;
			maxSymbols?: number;
	  };

export type WorkerResultMessage = {
	type: 'result';
	id: string;
	symbols: DecodedSymbol[];
	fileName?: string;
};

export type WorkerErrorMessage = {
	type: 'error';
	id: string;
	message: string;
	fileName?: string;
};

export type WorkerResponse = WorkerResultMessage | WorkerErrorMessage;

// --- メッセージハンドラ ---

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
	const req = e.data;

	try {
		if (req.type === 'decodeFrame') {
			const symbols = await decodeSymbols(req.imageData, {
				maxSymbols: req.maxSymbols,
			});
			self.postMessage({
				type: 'result',
				id: req.id,
				symbols,
			} satisfies WorkerResultMessage);
			return;
		}

		if (req.type === 'decodeImageFile') {
			// createImageBitmap で破損ファイルを早期検出しつつデコード可能な状態にする
			let bitmap: ImageBitmap;
			try {
				bitmap = await createImageBitmap(req.blob);
			} catch {
				throw new Error(`画像を読み込めませんでした: ${req.fileName}`);
			}

			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				bitmap.close();
				throw new Error('画像処理コンテキストの取得に失敗しました');
			}
			ctx.drawImage(bitmap, 0, 0);
			const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
			bitmap.close();

			const symbols = await decodeSymbols(imageData, {
				maxSymbols: req.maxSymbols,
			});
			self.postMessage({
				type: 'result',
				id: req.id,
				symbols,
				fileName: req.fileName,
			} satisfies WorkerResultMessage);
			return;
		}
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		self.postMessage({
			type: 'error',
			id: req.id,
			message,
			fileName: 'fileName' in req ? req.fileName : undefined,
		} satisfies WorkerErrorMessage);
	}
};
