// pdf-compress.ts — PDF圧縮のコアロジック（DOM非依存）
// - 標準（lossless）: pdf-lib で同じ文書を読み込み、未圧縮ストリームの Flate 圧縮と
//   オブジェクトストリーム化で再保存する。文字・ページ・リンク・注釈は文書構造ごと維持される。
// - 画像化（raster）: 利用者が明示選択した場合のみ。各ページを JPEG にした新しいPDFを作る。
//   ページ描画は PageRasterizer（src/lib/pdf/render.ts の PDF.js 実装）を注入して行う。
// どちらも結果が元より小さくならない場合は元のバイト列をそのまま返す。
// 署名付き・フォーム付き・暗号化・破損PDFは処理前に拒否する。

import type {
	PDFDocument as PDFDocumentType,
	PDFRawStream as PDFRawStreamType,
} from 'pdf-lib';
import {
	corruptError,
	DPI_OPTIONS,
	type Dpi,
	encryptedError,
	isDpi,
	isJpegQuality,
	type JpegQuality,
	type PageSizePt,
	type PdfDocumentFlags,
	PdfToolError,
	type PixelSize,
	pixelSizeForPage,
	throwIfAborted,
	validatePageCount,
	validatePixelLimit,
} from '../pdf/common.ts';

export type CompressMode = 'lossless' | 'raster';

export type PdfCompressSettings = {
	dpi: Dpi;
	jpegQuality: JpegQuality;
};

export const DEFAULT_PDF_COMPRESS_SETTINGS: PdfCompressSettings = {
	dpi: 96,
	jpegQuality: 70,
};

/**
 * useToolSettings 用の検証関数。dpi・品質は許可値のみ採用する。
 * 圧縮方式（画像化）は毎回明示選択させるため設定として保持しない。
 */
export function sanitizePdfCompressSettings(
	value: unknown,
	defaults: PdfCompressSettings,
): PdfCompressSettings {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return { ...defaults };
	}
	const v = value as Record<string, unknown>;
	return {
		dpi: isDpi(v.dpi) ? v.dpi : defaults.dpi,
		jpegQuality: isJpegQuality(v.jpegQuality)
			? v.jpegQuality
			: defaults.jpegQuality,
	};
}

export type CompressOutcome = {
	/** 保存するバイト列。reduced=false の場合は入力と同一の参照 */
	bytes: Uint8Array;
	mode: CompressMode;
	originalSize: number;
	outputSize: number;
	/** 元より小さくなった場合のみ true */
	reduced: boolean;
	pageCount: number;
};

export type ProgressCallback = (done: number, total: number) => void;

export type ProcessOptions = {
	signal?: AbortSignal;
	onProgress?: ProgressCallback;
};

export type PdfStructureFindings = {
	signed: boolean;
	form: boolean;
};

export type PdfCompressInspection = {
	pageCount: number;
};

const SIGNED_PDF_MESSAGE =
	'電子署名（デジタル署名・タイムスタンプ）を含むPDFは圧縮できません。保存し直すと署名が無効になるためです。';
const FORM_PDF_MESSAGE =
	'入力フォーム（フォームフィールド）を含むPDFは圧縮できません。入力内容や動作が失われるおそれがあるためです。';

/** マイクロタスク連投によるUIフリーズを避けるため、イベントループへ一度返す */
function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 読み込み後の構造参照（ページツリー欠落など）で起きる想定外の例外を、
 * 破損PDFとして日本語メッセージに変換する。PdfToolError（キャンセル等）はそのまま投げる。
 */
async function withCorruptFallback<T>(task: () => Promise<T>): Promise<T> {
	try {
		return await task();
	} catch (error) {
		if (error instanceof PdfToolError) throw error;
		throw corruptError();
	}
}

/**
 * pdf-lib で読み込む。暗号化は encrypted、解析不能は corrupt の PdfToolError にする。
 * pdf-lib の EncryptedPDFError は instanceof 判定が効かないため、
 * 暗号化有無の判定に限り ignoreEncryption で再読込する（処理には使わない）。
 */
async function loadDocument(bytes: Uint8Array): Promise<PDFDocumentType> {
	const { PDFDocument } = await import('pdf-lib');
	try {
		return await PDFDocument.load(bytes, { updateMetadata: false });
	} catch {
		try {
			const doc = await PDFDocument.load(bytes, {
				updateMetadata: false,
				ignoreEncryption: true,
			});
			if (doc.isEncrypted) throw encryptedError();
		} catch (inner) {
			if (inner instanceof PdfToolError) throw inner;
		}
		throw corruptError();
	}
}

// 生バイト列から検出する署名・フォームの痕跡。圧縮されたオブジェクトストリーム内は
// pdf-lib の解析結果側（detectInDocument）で検出する。
const RAW_SIGNATURE_PATTERNS = [
	/\/ByteRange\s*\[/,
	/\/Type\s*\/(?:Sig|DocTimeStamp)(?![A-Za-z0-9])/,
	/\/FT\s*\/Sig(?![A-Za-z0-9])/,
];
const RAW_FORM_PATTERNS = [
	/\/Subtype\s*\/Widget(?![A-Za-z0-9])/,
	/\/XFA(?![A-Za-z0-9])/,
];
const RAW_SCAN_CHUNK = 1024 * 1024;
const RAW_SCAN_OVERLAP = 64;

/** ファイル全体を 1MiB ずつ latin1 で走査し、署名・フォームの痕跡を探す */
export function scanRawMarkers(bytes: Uint8Array): PdfStructureFindings {
	const decoder = new TextDecoder('latin1');
	const findings: PdfStructureFindings = { signed: false, form: false };
	for (let start = 0; start < bytes.length; start += RAW_SCAN_CHUNK) {
		const end = Math.min(
			bytes.length,
			start + RAW_SCAN_CHUNK + RAW_SCAN_OVERLAP,
		);
		const text = decoder.decode(bytes.subarray(start, end));
		if (!findings.signed) {
			findings.signed = RAW_SIGNATURE_PATTERNS.some((re) => re.test(text));
		}
		if (!findings.form) {
			findings.form = RAW_FORM_PATTERNS.some((re) => re.test(text));
		}
		if (findings.signed && findings.form) break;
	}
	return findings;
}

/**
 * 解析済み文書から署名・フォームを検出する。
 * AcroForm の Fields・SigFlags・XFA、カタログの Perms（DocMDP/UR）に加え、
 * 参照されていない署名辞書やウィジェット注釈も全間接オブジェクトの走査で拾う。
 */
async function detectInDocument(
	doc: PDFDocumentType,
): Promise<PdfStructureFindings> {
	const { PDFArray, PDFDict, PDFName, PDFNumber, PDFStream } = await import(
		'pdf-lib'
	);
	const findings: PdfStructureFindings = { signed: false, form: false };
	const name = (key: string) => PDFName.of(key);
	const catalog = doc.catalog;

	if (catalog.has(name('Perms'))) findings.signed = true;

	const acroForm = catalog.lookup(name('AcroForm'));
	if (acroForm instanceof PDFDict) {
		const sigFlags = acroForm.lookup(name('SigFlags'));
		if (sigFlags instanceof PDFNumber && sigFlags.asNumber() > 0) {
			findings.signed = true;
		}
		if (acroForm.has(name('XFA'))) findings.form = true;
		const fields = acroForm.lookup(name('Fields'));
		if (fields instanceof PDFArray && fields.size() > 0) findings.form = true;
	}

	for (const [, object] of doc.context.enumerateIndirectObjects()) {
		const dict =
			object instanceof PDFDict
				? object
				: object instanceof PDFStream
					? object.dict
					: null;
		if (!dict) continue;
		const type = dict.lookup(name('Type'));
		const ft = dict.lookup(name('FT'));
		if (
			type === name('Sig') ||
			type === name('DocTimeStamp') ||
			ft === name('Sig') ||
			(dict.has(name('ByteRange')) && dict.has(name('Contents')))
		) {
			findings.signed = true;
		}
		if (dict.lookup(name('Subtype')) === name('Widget')) {
			findings.form = true;
		}
		if (findings.signed && findings.form) break;
	}
	return findings;
}

/**
 * 圧縮前の検査。暗号化・破損・ページ数・署名・フォームを確認し、問題があれば
 * 日本語メッセージの PdfToolError を投げる（署名とフォームが両方ある場合は署名を優先）。
 */
export async function inspectPdfForCompress(
	bytes: Uint8Array,
): Promise<PdfCompressInspection> {
	return withCorruptFallback(async () => {
		const doc = await loadDocument(bytes);
		const pageCount = doc.getPageCount();
		const pageCountError = validatePageCount(pageCount);
		if (pageCountError) throw pageCountError;
		const parsed = await detectInDocument(doc);
		const raw = scanRawMarkers(bytes);
		if (parsed.signed || raw.signed) {
			throw new PdfToolError('signed', SIGNED_PDF_MESSAGE);
		}
		if (parsed.form || raw.form) {
			throw new PdfToolError('form', FORM_PDF_MESSAGE);
		}
		return { pageCount };
	});
}

/**
 * PDF.js が読み取った文書情報による追加検査（pdf-lib の検出と二重に確認する）。
 * 閲覧パスワードなしで開ける暗号化PDFもここで拒否する。
 */
export function assertCompressibleFlags(flags: PdfDocumentFlags): void {
	if (flags.encrypted) throw encryptedError();
	if (flags.signatures) throw new PdfToolError('signed', SIGNED_PDF_MESSAGE);
	if (flags.acroForm || flags.xfa) {
		throw new PdfToolError('form', FORM_PDF_MESSAGE);
	}
}

/** 結果が元より小さい場合だけ採用する */
export function chooseSmaller(
	original: Uint8Array,
	candidate: Uint8Array,
	mode: CompressMode,
	pageCount: number,
): CompressOutcome {
	const reduced = candidate.length < original.length;
	const bytes = reduced ? candidate : original;
	return {
		bytes,
		mode,
		originalSize: original.length,
		outputSize: bytes.length,
		reduced,
		pageCount,
	};
}

/** zlib 形式（FlateDecode 互換）で圧縮する */
async function deflate(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data as Uint8Array<ArrayBuffer>])
		.stream()
		.pipeThrough(new CompressionStream('deflate'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

// 再圧縮しないストリーム種別（相互参照・オブジェクトストリームは保存時に再生成され、
// XMPメタデータは非圧縮のまま読まれる前提のツールがあるため対象外）
const SKIP_STREAM_TYPES = ['XRef', 'ObjStm', 'Metadata'];

/**
 * 標準圧縮（文字を画像化しない）。同じ文書を pdf-lib で読み込み、フィルタ未指定の
 * ストリームを Flate 圧縮し、オブジェクトストリームを使って再保存する。
 * 入力は事前に inspectPdfForCompress で検査済みであること。
 */
export async function compressLossless(
	original: Uint8Array,
	options: ProcessOptions = {},
): Promise<CompressOutcome> {
	return withCorruptFallback(() => optimizeDocument(original, options));
}

async function optimizeDocument(
	original: Uint8Array,
	options: ProcessOptions,
): Promise<CompressOutcome> {
	const { signal, onProgress } = options;
	throwIfAborted(signal);
	const { PDFName, PDFRawStream } = await import('pdf-lib');
	const doc = await loadDocument(original);
	throwIfAborted(signal);
	const pageCount = doc.getPageCount();

	const filterKey = PDFName.of('Filter');
	// 元のフィルタが無い場合でも、残った復号パラメータを新しいFlateへ適用すると画像が変わる。
	const decodeParmsKey = PDFName.of('DecodeParms');
	const typeKey = PDFName.of('Type');
	const skipTypes = SKIP_STREAM_TYPES.map((t) => PDFName.of(t));
	const targets = doc.context
		.enumerateIndirectObjects()
		.filter(
			([, object]) =>
				object instanceof PDFRawStream &&
				!object.dict.has(filterKey) &&
				!object.dict.has(decodeParmsKey) &&
				!skipTypes.includes(object.dict.get(typeKey) as never),
		);
	// 読み込み・各ストリーム・保存を進捗の単位とする
	const total = targets.length + 2;
	let done = 1;
	onProgress?.(done, total);

	for (const [ref, object] of targets) {
		throwIfAborted(signal);
		const stream = object as PDFRawStreamType;
		const compressed = await deflate(stream.contents);
		// 「/Filter /FlateDecode」の追加分を見込んで、確実に小さくなる場合だけ置き換える
		if (compressed.length + 24 < stream.contents.length) {
			const dict = stream.dict.clone(doc.context);
			dict.set(filterKey, PDFName.of('FlateDecode'));
			doc.context.assign(ref, PDFRawStream.of(dict, compressed));
		}
		done++;
		onProgress?.(done, total);
		if (done % 20 === 0) await yieldToEventLoop();
	}

	throwIfAborted(signal);
	const saved = await doc.save({ useObjectStreams: true, objectsPerTick: 50 });
	throwIfAborted(signal);
	onProgress?.(total, total);
	return chooseSmaller(original, saved, 'lossless', pageCount);
}

/** 画像化圧縮でページを描画する実装（PDF.js + canvas）。テストでは差し替える */
export interface PageRasterizer {
	readonly pageCount: number;
	/** 表示上の寸法（回転適用後、pt） */
	getPageSize(pageNumber: number): Promise<PageSizePt>;
	/** 指定画素数で白背景に描画し、JPEGバイト列を返す */
	renderJpeg(
		pageNumber: number,
		size: PixelSize,
		quality: JpegQuality,
		signal?: AbortSignal,
	): Promise<Uint8Array>;
}

export function validateCompressSettings(
	settings: PdfCompressSettings,
): PdfToolError | null {
	if (!isDpi(settings.dpi)) {
		return new PdfToolError(
			'invalid-option',
			`解像度は${DPI_OPTIONS.join(' / ')}dpiから選択してください。`,
		);
	}
	if (!isJpegQuality(settings.jpegQuality)) {
		return new PdfToolError(
			'invalid-option',
			'JPEG品質の指定が正しくありません。',
		);
	}
	return null;
}

/**
 * 画像化圧縮。各ページを指定dpiのJPEGに描画し、表示上の寸法（pt）・向き・順序を
 * 保った新しいPDFを作る。文字選択・検索・リンク・注釈・フォームは失われる。
 * ページは1枚ずつ描画して即座にPDFへ埋め込み、描画結果を溜め込まない。
 */
export async function compressRaster(
	original: Uint8Array,
	rasterizer: PageRasterizer,
	settings: PdfCompressSettings,
	options: ProcessOptions = {},
): Promise<CompressOutcome> {
	return withCorruptFallback(async () => {
		const { signal, onProgress } = options;
		const settingsError = validateCompressSettings(settings);
		if (settingsError) throw settingsError;
		const pageCountError = validatePageCount(rasterizer.pageCount);
		if (pageCountError) throw pageCountError;

		const sizes: Array<{ pageNumber: number; size: PageSizePt }> = [];
		for (let n = 1; n <= rasterizer.pageCount; n++) {
			throwIfAborted(signal);
			sizes.push({ pageNumber: n, size: await rasterizer.getPageSize(n) });
		}
		const pixelError = validatePixelLimit(sizes, settings.dpi);
		if (pixelError) throw pixelError;

		const { PDFDocument } = await import('pdf-lib');
		const out = await PDFDocument.create({ updateMetadata: false });
		const total = sizes.length + 1;
		onProgress?.(0, total);
		for (const { pageNumber, size } of sizes) {
			throwIfAborted(signal);
			const jpeg = await rasterizer.renderJpeg(
				pageNumber,
				pixelSizeForPage(size, settings.dpi),
				settings.jpegQuality,
				signal,
			);
			throwIfAborted(signal);
			const image = await out.embedJpg(jpeg);
			const page = out.addPage([size.widthPt, size.heightPt]);
			page.drawImage(image, {
				x: 0,
				y: 0,
				width: size.widthPt,
				height: size.heightPt,
			});
			onProgress?.(pageNumber, total);
			await yieldToEventLoop();
		}
		throwIfAborted(signal);
		const saved = await out.save({ useObjectStreams: true });
		throwIfAborted(signal);
		onProgress?.(total, total);
		return chooseSmaller(original, saved, 'raster', sizes.length);
	});
}

/** 出力ファイル名（元ファイル名_compressed.pdf） */
export function compressedFileName(baseName: string): string {
	return `${baseName}_compressed.pdf`;
}
