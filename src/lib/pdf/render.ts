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
		canvas.toBlob(
			(blob) =>
				blob
					? resolve(blob)
					: reject(
							new Error(
								'画像の生成に失敗しました。解像度を下げてお試しください。',
							),
						),
			type,
			quality,
		);
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
		const canvasContext = canvas.getContext('2d', { alpha: transparent });
		if (!canvasContext) {
			releaseCanvas(canvas);
			throw new Error('canvas を利用できません。');
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

	return {
		pageCount,
		flags,
		getPageSize,
		renderToCanvas,
		renderJpeg,
		renderImage,
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
