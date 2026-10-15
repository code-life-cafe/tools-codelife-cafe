// render.ts — PDF.js によるページ描画（DOM依存。PDF圧縮の画像化・PDF→画像・プレビューで共有）
// - PDF.js 本体と Worker はこのモジュールから dynamic import し、利用ページ以外の bundle に含めない。
// - Worker・CMap・標準フォント・wasm はすべて Vite が出力する同一オリジンのアセットから読み込む。
//   PDFファイルの内容やファイル名を外部へ送信しない。
// - 埋め込みJavaScript・XFA・リンク等のアクションは実行しない（スクリプト用サンドボックスを読み込まず、
//   注釈レイヤーも生成しない。描画は canvas への静的描画のみ）。

import type {
	PDFDocumentLoadingTask,
	PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
	CANCELLED_MESSAGE,
	corruptError,
	encryptedError,
	imageGenerationError,
	MAX_PIXELS_PER_PAGE,
	type PageSizePt,
	type PdfDocumentFlags,
	PdfToolError,
	type PixelSize,
	throwIfAborted,
} from './common.ts';

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

// ビルド時に各ファイルを同一オリジンのアセットとして出力し、ファイル名→URLの表を作る。
// （小さいファイルも data: URL へインライン化せず、CSP connect-src 'self' の範囲で取得する）
const CMAP_URLS = import.meta.glob<string>(
	'../../../node_modules/pdfjs-dist/cmaps/*.bcmap',
	{ eager: true, query: '?url&no-inline', import: 'default' },
);
const STANDARD_FONT_URLS = import.meta.glob<string>(
	'../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}',
	{ eager: true, query: '?url&no-inline', import: 'default' },
);
const WASM_URLS = import.meta.glob<string>(
	'../../../node_modules/pdfjs-dist/wasm/{openjpeg,jbig2}.wasm',
	{ eager: true, query: '?url&no-inline', import: 'default' },
);

function byFileName(urls: Record<string, string>): Map<string, string> {
	return new Map(
		Object.entries(urls).map(([key, url]) => [
			key.split('/').pop() ?? key,
			url,
		]),
	);
}

const ASSET_TABLES: Record<string, Map<string, string>> = {
	cMapUrl: byFileName(CMAP_URLS),
	standardFontDataUrl: byFileName(STANDARD_FONT_URLS),
	wasmUrl: byFileName(WASM_URLS),
};

/**
 * PDF.js が CMap・標準フォント・wasm を要求したときに、バンドル済みアセットから返す。
 * useWorkerFetch: false のとき、メインスレッドでこのクラスが使われる。
 */
class BundledBinaryDataFactory {
	async fetch({
		kind,
		filename,
	}: {
		kind: string;
		filename: string;
	}): Promise<Uint8Array> {
		const url = ASSET_TABLES[kind]?.get(filename);
		if (!url) {
			throw new Error(`PDF.js asset is not bundled: ${kind}/${filename}`);
		}
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`PDF.js asset fetch failed: ${response.status}`);
		}
		return new Uint8Array(await response.arrayBuffer());
	}
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/** PDF.js（互換性の高い legacy ビルド）と Worker を遅延ロードする */
function loadPdfjs(): Promise<PdfjsModule> {
	pdfjsPromise ??= (async () => {
		const [pdfjs, worker] = await Promise.all([
			import('pdfjs-dist/legacy/build/pdf.mjs'),
			// Vite の module worker として同一オリジンの .js に出力する
			import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&url'),
		]);
		pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
		return pdfjs;
	})().catch((error) => {
		pdfjsPromise = null;
		throw error;
	});
	return pdfjsPromise;
}

export type RenderBackground = 'white' | 'transparent';

/**
 * ページから逐次取得したテキスト片。座標は回転（/Rotate）適用後の表示座標（pt、左上原点・下向き）。
 * 座標や寸法を取得できない場合は null とし、呼び出し側は内部順へ戻せる。
 */
export type PdfTextChunkItem = {
	str: string;
	hasEOL: boolean;
	x: number | null;
	y: number | null;
	width: number | null;
	fontSize: number | null;
	/** 表示上で左→右へ進む横書き（回転・反転・縦書きは false） */
	horizontal: boolean;
};

export type PdfRenderSession = {
	readonly pageCount: number;
	readonly flags: PdfDocumentFlags;
	/** 表示上の寸法（/Rotate 適用後、pt） */
	getPageSize(pageNumber: number): Promise<PageSizePt>;
	/** 指定画素数の canvas に描画する（呼び出し側で releaseCanvas すること） */
	renderToCanvas(
		pageNumber: number,
		size: PixelSize,
		background: RenderBackground,
		signal?: AbortSignal,
	): Promise<HTMLCanvasElement>;
	/** 白背景で描画した JPEG のバイト列（PDF圧縮の画像化用） */
	renderJpeg(
		pageNumber: number,
		size: PixelSize,
		quality: number,
		signal?: AbortSignal,
	): Promise<Uint8Array>;
	/** JPEG は白背景、PNG は透過背景で描画した画像 */
	renderImage(
		pageNumber: number,
		size: PixelSize,
		format: 'jpeg' | 'png',
		quality: number,
		signal?: AbortSignal,
	): Promise<Blob>;
	/**
	 * 指定ページの文字データを streamTextContent でチャンクごとに逐次返す。
	 * signal の中断・呼び出し側の中断（break/throw）では読み取りを止め、キャンセルは PdfToolError('cancelled')。
	 * ページの文字データを持たない場合は空の列を返す（OCRはしない）。
	 */
	streamPageText(
		pageNumber: number,
		signal?: AbortSignal,
	): AsyncGenerator<PdfTextChunkItem[], void, void>;
	destroy(): Promise<void>;
};

/** canvas のメモリを即時に手放す（Safari は参照が残る間ビットマップを保持するため） */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
	canvas.width = 0;
	canvas.height = 0;
}

export function canvasToBlob(
	canvas: HTMLCanvasElement,
	type: 'image/jpeg' | 'image/png',
	quality?: number,
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		try {
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(imageGenerationError())),
				type,
				quality,
			);
		} catch {
			reject(imageGenerationError());
		}
	});
}

function toPdfToolError(error: unknown): PdfToolError {
	if (error instanceof PdfToolError) return error;
	const name = (error as { name?: string } | null)?.name;
	if (name === 'PasswordException') return encryptedError();
	return corruptError();
}

/**
 * PDFを PDF.js で開く。暗号化（閲覧パスワードなしで開けるものを含む）・破損は PdfToolError。
 * bytes は Worker へ転送されるため、呼び出し側のバッファを守るために複製して渡す。
 */
export async function openPdfRenderSession(
	bytes: Uint8Array,
): Promise<PdfRenderSession> {
	const pdfjs = await loadPdfjs();
	const loadingTask: PDFDocumentLoadingTask = pdfjs.getDocument({
		data: bytes.slice(),
		BinaryDataFactory: BundledBinaryDataFactory,
		useWorkerFetch: false,
		cMapPacked: true,
		// 外部URLからの取得・先読みは使わない（data 指定のみ）
		disableAutoFetch: true,
		disableStream: true,
		disableRange: true,
		enableXfa: false,
		verbosity: pdfjs.VerbosityLevel.ERRORS,
	});
	let doc: PDFDocumentProxy;
	try {
		doc = await loadingTask.promise;
	} catch (error) {
		await loadingTask.destroy().catch(() => undefined);
		throw toPdfToolError(error);
	}

	let flags: PdfDocumentFlags;
	try {
		const { info } = await doc.getMetadata();
		const record = info as Record<string, unknown>;
		flags = {
			encrypted: record.EncryptFilterName != null,
			signatures: record.IsSignaturesPresent === true,
			acroForm: record.IsAcroFormPresent === true,
			xfa: record.IsXFAPresent === true,
		};
	} catch (error) {
		await loadingTask.destroy().catch(() => undefined);
		throw toPdfToolError(error);
	}

	const pageCount = doc.numPages;

	async function getPageSize(pageNumber: number): Promise<PageSizePt> {
		const page = await doc.getPage(pageNumber);
		const viewport = page.getViewport({ scale: 1 });
		return { widthPt: viewport.width, heightPt: viewport.height };
	}

	async function renderToCanvas(
		pageNumber: number,
		size: PixelSize,
		background: RenderBackground,
		signal?: AbortSignal,
	): Promise<HTMLCanvasElement> {
		throwIfAborted(signal);
		const page = await doc.getPage(pageNumber);
		throwIfAborted(signal);
		// 既定の回転（/Rotate）を適用した表示上の向きで描画する
		const viewport = page.getViewport({ scale: 1 });
		const canvas = document.createElement('canvas');
		canvas.width = size.width;
		canvas.height = size.height;
		const transparent = background === 'transparent';
		let canvasContext: CanvasRenderingContext2D | null;
		try {
			canvasContext = canvas.getContext('2d', { alpha: transparent });
		} catch {
			releaseCanvas(canvas);
			throw imageGenerationError();
		}
		if (!canvasContext) {
			releaseCanvas(canvas);
			throw imageGenerationError();
		}
		const task = page.render({
			canvas,
			canvasContext,
			viewport,
			// 画素数に合わせて縦横の倍率を個別に指定し、端数の余白を出さない
			transform: [
				size.width / viewport.width,
				0,
				0,
				size.height / viewport.height,
				0,
				0,
			],
			background: transparent ? 'rgba(0,0,0,0)' : '#ffffff',
			// 注釈の見た目は描画するが、操作可能な注釈レイヤー（リンク・フォーム）は作らない
			annotationMode: pdfjs.AnnotationMode.ENABLE,
		});
		const onAbort = () => task.cancel();
		signal?.addEventListener('abort', onAbort, { once: true });
		try {
			await task.promise;
		} catch (error) {
			releaseCanvas(canvas);
			if (
				signal?.aborted ||
				(error as { name?: string } | null)?.name ===
					'RenderingCancelledException'
			) {
				throw new PdfToolError('cancelled', CANCELLED_MESSAGE);
			}
			throw toPdfToolError(error);
		} finally {
			signal?.removeEventListener('abort', onAbort);
			page.cleanup();
		}
		return canvas;
	}

	async function renderImage(
		pageNumber: number,
		size: PixelSize,
		format: 'jpeg' | 'png',
		quality: number,
		signal?: AbortSignal,
	): Promise<Blob> {
		const canvas = await renderToCanvas(
			pageNumber,
			size,
			format === 'png' ? 'transparent' : 'white',
			signal,
		);
		try {
			return await canvasToBlob(
				canvas,
				format === 'png' ? 'image/png' : 'image/jpeg',
				format === 'jpeg' ? quality / 100 : undefined,
			);
		} finally {
			releaseCanvas(canvas);
		}
	}

	async function renderJpeg(
		pageNumber: number,
		size: PixelSize,
		quality: number,
		signal?: AbortSignal,
	): Promise<Uint8Array> {
		const blob = await renderImage(pageNumber, size, 'jpeg', quality, signal);
		return new Uint8Array(await blob.arrayBuffer());
	}

	const finite = (v: number) => Number.isFinite(v);

	async function* streamPageText(
		pageNumber: number,
		signal?: AbortSignal,
	): AsyncGenerator<PdfTextChunkItem[], void, void> {
		throwIfAborted(signal);
		let page: Awaited<ReturnType<typeof doc.getPage>>;
		try {
			page = await doc.getPage(pageNumber);
		} catch (error) {
			throw toPdfToolError(error);
		}
		const cancelReason = new Error('text extraction cancelled');
		let reader: ReadableStreamDefaultReader<unknown> | null = null;
		let finished = false;
		const onAbort = () => {
			// PDF.js は理由なしの cancel() を拒否するため Error を渡す
			void reader?.cancel(cancelReason).catch(() => undefined);
		};
		try {
			throwIfAborted(signal);
			// 表示上の座標へ変換するため、/Rotate 適用後のビューポート行列を使う
			const [a, b, c, d, e, f] = page.getViewport({ scale: 1 }).transform;
			// 互換正規化（NFKC等）はかけず、PDFの文字をそのまま返す。リンク・注釈は実行しない
			reader = page
				.streamTextContent({
					includeMarkedContent: false,
					disableNormalization: true,
				})
				.getReader();
			signal?.addEventListener('abort', onAbort, { once: true });
			for (;;) {
				const { done, value } = await reader.read();
				throwIfAborted(signal);
				if (done) {
					finished = true;
					return;
				}
				const items: PdfTextChunkItem[] = [];
				for (const item of (value as { items: unknown[] }).items) {
					const text = item as {
						str?: unknown;
						hasEOL?: unknown;
						transform?: unknown;
						width?: unknown;
					};
					if (typeof text.str !== 'string') continue;
					const m = Array.isArray(text.transform)
						? (text.transform as number[])
						: [];
					const valid =
						m.length >= 6 && m.slice(0, 6).every((v) => finite(v as number));
					let x: number | null = null;
					let y: number | null = null;
					let fontSize: number | null = null;
					let horizontal = false;
					if (valid) {
						x = a * m[4] + c * m[5] + e;
						y = b * m[4] + d * m[5] + f;
						// 文字の進行方向・縦方向を表示座標へ写して向きと大きさを得る
						const dirX = a * m[0] + c * m[1];
						const dirY = b * m[0] + d * m[1];
						fontSize = Math.hypot(a * m[2] + c * m[3], b * m[2] + d * m[3]);
						horizontal =
							dirX > 0 &&
							Math.abs(dirY) <= Math.abs(dirX) * 0.1 &&
							fontSize > 0;
						if (!finite(x) || !finite(y) || !finite(fontSize)) {
							x = null;
							y = null;
							fontSize = null;
							horizontal = false;
						}
					}
					const width =
						typeof text.width === 'number' && finite(text.width)
							? Math.abs(text.width) * Math.hypot(a, b)
							: null;
					items.push({
						str: text.str,
						hasEOL: text.hasEOL === true,
						x,
						y,
						width,
						fontSize,
						horizontal,
					});
				}
				yield items;
			}
		} catch (error) {
			if (signal?.aborted) {
				throw new PdfToolError('cancelled', CANCELLED_MESSAGE);
			}
			throw toPdfToolError(error);
		} finally {
			signal?.removeEventListener('abort', onAbort);
			// 途中で止める場合（上限超過・中断・呼び出し側の break）は読み取りを取り消す。
			// PDF.js は Worker 側で完了済みのストリームへの cancel に応答しないことがあるため、
			// 完了を待たない（待つと上限超過エラーが永久に返らない）。
			if (reader && !finished) {
				void reader.cancel(cancelReason).catch(() => undefined);
			}
			try {
				page.cleanup();
			} catch {
				// セッション破棄済みなら何もしない
			}
		}
	}

	return {
		pageCount,
		flags,
		getPageSize,
		renderToCanvas,
		renderJpeg,
		renderImage,
		streamPageText,
		destroy: () => loadingTask.destroy(),
	};
}

/**
 * 指定ページを最大幅 maxWidthPx 程度に縮小したプレビュー画像（白背景JPEG）を作る。
 * 失敗時は null（プレビューは補助表示のため、本処理の成否に影響させない）。
 */
export async function renderPreviewBlob(
	session: PdfRenderSession,
	pageNumber: number,
	maxWidthPx: number,
	signal?: AbortSignal,
): Promise<Blob | null> {
	try {
		const size = await session.getPageSize(pageNumber);
		const scale = Math.min(1.5, maxWidthPx / size.widthPt);
		const px = {
			width: Math.max(1, Math.round(size.widthPt * scale)),
			height: Math.max(1, Math.round(size.heightPt * scale)),
		};
		// 補助プレビューも出力と同じ面積制限内に抑える（極端に細長いページを含む）。
		if (
			!Number.isFinite(px.width) ||
			!Number.isFinite(px.height) ||
			px.width * px.height > MAX_PIXELS_PER_PAGE
		)
			return null;
		return await session.renderImage(pageNumber, px, 'jpeg', 85, signal);
	} catch {
		return null;
	}
}
