// 実行方法: npm run test:unit（単体: node --test tests/unit/pdf-compress.test.ts）
//
// PDF圧縮のロジックを、計画のAC（文字・ページ・リンク維持、縮まない場合は元ファイル保持、
// 署名・フォーム・暗号化・破損の拒否、上限、画像化の向き・寸法維持、キャンセル）から検証する。
// 出力PDFの検証は実装とは独立に、PDF.js（テキスト・リンク抽出）と pdf-lib（ページ寸法）で行う。
// フィクスチャは tests/fixtures/pdf-expansion/generate-fixtures.ts で生成した合成PDF。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import {
	MAX_INPUT_BYTES,
	MAX_PAGES,
	type PageSizePt,
	PdfToolError,
	pixelSizeForPage,
	reductionPercent,
	validatePdfInput,
} from '../../src/lib/pdf/common.ts';
import {
	assertCompressibleFlags,
	chooseSmaller,
	compressedFileName,
	compressLossless,
	compressRaster,
	DEFAULT_PDF_COMPRESS_SETTINGS,
	inspectPdfForCompress,
	type PageRasterizer,
	sanitizePdfCompressSettings,
	scanRawMarkers,
} from '../../src/lib/tools/pdf-compress.ts';

const ROOT = process.cwd();
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'pdf-expansion');
const read = (name: string) =>
	new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));
const ENCRYPTED = new Uint8Array(
	fs.readFileSync(path.join(ROOT, 'tests', 'e2e', 'fixtures', 'encrypted.pdf')),
);

async function loadPdfjs() {
	return import(
		pathToFileURL(
			path.join(
				ROOT,
				'node_modules',
				'pdfjs-dist',
				'legacy',
				'build',
				'pdf.mjs',
			),
		).href
	);
}

/** PDF.js で各ページのテキストとリンクURLを抽出する（実装とは独立した検証手段） */
async function extractTextAndLinks(bytes: Uint8Array) {
	const pdfjs = await loadPdfjs();
	const task = pdfjs.getDocument({
		data: bytes.slice(),
		cMapUrl: `${path.join(ROOT, 'node_modules', 'pdfjs-dist', 'cmaps')}/`,
		cMapPacked: true,
		standardFontDataUrl: `${path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts')}/`,
		verbosity: 0,
	});
	const doc = await task.promise;
	const pages: Array<{ text: string; links: string[] }> = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n);
		const content = await page.getTextContent();
		const annotations = await page.getAnnotations();
		pages.push({
			text: content.items
				.map((item: { str?: string }) => item.str ?? '')
				.join(''),
			links: annotations
				.filter((a: { subtype: string }) => a.subtype === 'Link')
				.map((a: { url?: string }) => a.url ?? ''),
		});
	}
	await task.destroy();
	return pages;
}

async function pageSizes(bytes: Uint8Array) {
	const doc = await PDFDocument.load(bytes);
	return doc.getPages().map((p) => ({
		width: Math.round(p.getWidth()),
		height: Math.round(p.getHeight()),
		rotation: p.getRotation().angle,
	}));
}

async function rejects(
	promise: Promise<unknown>,
	code: string,
	messageIncludes?: string,
) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof PdfToolError, `PdfToolError expected: ${error}`);
		assert.equal(error.code, code);
		if (messageIncludes) assert.ok(error.message.includes(messageIncludes));
		return true;
	});
}

async function makePdf(pageCount: number): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	for (let i = 0; i < pageCount; i++) doc.addPage([200, 200]);
	// pdf-lib は既定で0ページ文書に空白ページを足すため、0ページを保つ
	return doc.save({ addDefaultPage: false });
}

// ---- 入力検証（読み込み前） ----

test('validatePdfInput: 空・非PDF・50MiB超・シグネチャ不一致を日本語で拒否し、50MiBちょうどは許可する', () => {
	const pdfHead = new TextEncoder().encode('%PDF-');
	const base = { name: 'a.pdf', type: 'application/pdf', head: pdfHead };
	assert.equal(validatePdfInput({ ...base, size: 0 })?.code, 'empty');
	assert.equal(
		validatePdfInput({ ...base, name: 'a.txt', type: 'text/plain', size: 10 })
			?.code,
		'not-pdf',
	);
	assert.equal(
		validatePdfInput({ ...base, size: MAX_INPUT_BYTES + 1 })?.code,
		'too-large',
	);
	assert.equal(validatePdfInput({ ...base, size: MAX_INPUT_BYTES }), null);
	const notPdf = validatePdfInput({
		...base,
		size: 10,
		head: new TextEncoder().encode('PK\u0003\u0004'),
	});
	assert.equal(notPdf?.code, 'corrupt');
	assert.match(notPdf?.message ?? '', /PDFを読み込めませんでした/);
	// MIMEが空でも拡張子 .pdf なら受け付ける（OSによりMIMEが付かないため）
	assert.equal(validatePdfInput({ ...base, type: '', size: 10 }), null);
});

// ---- 事前検査 ----

test('inspectPdfForCompress: 通常PDFはページ数を返す', async () => {
	assert.deepEqual(await inspectPdfForCompress(read('text-ja.pdf')), {
		pageCount: 3,
	});
});

test('inspectPdfForCompress: 暗号化PDFは encrypted で拒否する', async () => {
	await rejects(
		inspectPdfForCompress(ENCRYPTED),
		'encrypted',
		'パスワード付きPDF',
	);
});

test('inspectPdfForCompress: 途中で切れたPDF・PDF風のゴミは corrupt で拒否する', async () => {
	await rejects(
		inspectPdfForCompress(read('text-ja.pdf').slice(0, 300)),
		'corrupt',
	);
	await rejects(
		inspectPdfForCompress(new TextEncoder().encode('%PDF-1.7\nnot a pdf')),
		'corrupt',
	);
});

test('inspectPdfForCompress: ページ数は100まで許可し、101と0は拒否する', async () => {
	assert.equal(
		(await inspectPdfForCompress(await makePdf(MAX_PAGES))).pageCount,
		100,
	);
	await rejects(
		inspectPdfForCompress(await makePdf(MAX_PAGES + 1)),
		'too-many-pages',
		'全101ページ',
	);
	await rejects(inspectPdfForCompress(await makePdf(0)), 'no-pages');
});

test('inspectPdfForCompress: 署名フィールド付きPDFを拒否する', async () => {
	await rejects(
		inspectPdfForCompress(read('signed.pdf')),
		'signed',
		'電子署名',
	);
});

test('inspectPdfForCompress: 参照されず圧縮オブジェクトストリーム内にある署名辞書も検出する', async () => {
	const bytes = read('signed-hidden.pdf');
	// 生バイト列には痕跡が出ない（＝解析結果側の検出を実際に通っている）ことを前提確認
	assert.equal(scanRawMarkers(bytes).signed, false);
	await rejects(inspectPdfForCompress(bytes), 'signed');
});

test('inspectPdfForCompress: フォーム付きPDFを拒否する', async () => {
	await rejects(
		inspectPdfForCompress(read('form.pdf')),
		'form',
		'入力フォーム',
	);
});

test('inspectPdfForCompress: ウィジェット注釈だけが残る（Fields空の）PDFもフォームとして拒否する', async () => {
	const doc = await PDFDocument.create();
	const page = doc.addPage([200, 200]);
	const widget = doc.context.register(
		doc.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 10, 10] }),
	);
	page.node.set(
		(await import('pdf-lib')).PDFName.of('Annots'),
		doc.context.obj([widget]),
	);
	await rejects(inspectPdfForCompress(await doc.save()), 'form');
});

test('scanRawMarkers: チャンク境界をまたぐ /ByteRange も検出する', () => {
	const chunk = 1024 * 1024;
	const bytes = new Uint8Array(chunk + 100).fill(0x20);
	const marker = new TextEncoder().encode('/ByteRange [0 1 2 3]');
	bytes.set(marker, chunk - 5);
	assert.equal(scanRawMarkers(bytes).signed, true);
	assert.deepEqual(scanRawMarkers(new Uint8Array(100).fill(0x20)), {
		signed: false,
		form: false,
	});
	// /SigFlags のような前方一致は署名マーカーとみなさない
	assert.equal(
		scanRawMarkers(new TextEncoder().encode('/FT /SigFlags')).signed,
		false,
	);
});

test('assertCompressibleFlags: PDF.js の情報で暗号化・署名・フォーム・XFAを拒否する', () => {
	const none = {
		encrypted: false,
		signatures: false,
		acroForm: false,
		xfa: false,
	};
	assert.doesNotThrow(() => assertCompressibleFlags(none));
	const codeOf = (flags: typeof none) => {
		try {
			assertCompressibleFlags(flags);
			return null;
		} catch (error) {
			return (error as PdfToolError).code;
		}
	};
	assert.equal(codeOf({ ...none, encrypted: true }), 'encrypted');
	assert.equal(codeOf({ ...none, signatures: true, acroForm: true }), 'signed');
	assert.equal(codeOf({ ...none, acroForm: true }), 'form');
	assert.equal(codeOf({ ...none, xfa: true }), 'form');
});

// ---- 標準（lossless） ----

test('compressLossless: 非圧縮の文字PDFは小さくなり、日本語テキスト・リンク・ページ寸法を維持する', async () => {
	const original = read('text-ja.pdf');
	const outcome = await compressLossless(original);
	assert.equal(outcome.reduced, true);
	assert.equal(outcome.mode, 'lossless');
	assert.ok(outcome.outputSize < outcome.originalSize);
	assert.equal(outcome.bytes.length, outcome.outputSize);
	assert.equal(outcome.pageCount, 3);

	assert.deepEqual(await pageSizes(outcome.bytes), await pageSizes(original));
	const before = await extractTextAndLinks(original);
	const after = await extractTextAndLinks(outcome.bytes);
	assert.deepEqual(after, before);
	assert.ok(after[0].text.includes('日本語テキストの抽出確認'));
	assert.ok(after[1].text.includes('圧縮テスト用の本文です。行番号24'));
	assert.deepEqual(after[2].links, ['https://example.com/page-3']);
});

test('compressLossless: 縮まないPDFは元のバイト列をそのまま返す（unchanged）', async () => {
	for (const name of ['compact.pdf', 'scan.pdf', 'rotated.pdf']) {
		const original = read(name);
		const outcome = await compressLossless(original);
		assert.equal(outcome.reduced, false, name);
		assert.equal(outcome.bytes, original, name);
		assert.equal(outcome.outputSize, original.length, name);
	}
});

test('compressLossless: 回転ページの /Rotate と寸法を維持する', async () => {
	// 再保存されたバイト列を確実に検証できるよう、圧縮可能なストリームを追加する。
	const doc = await PDFDocument.load(read('rotated.pdf'));
	doc.context.register(doc.context.stream(' '.repeat(10000)));
	const original = await doc.save({ useObjectStreams: false });
	const pages = await pageSizes(original);
	assert.deepEqual(
		pages.map((p) => p.rotation),
		[0, 90, 180, 270],
	);
	const outcome = await compressLossless(original);
	assert.equal(outcome.reduced, true);
	assert.notEqual(outcome.bytes, original);
	assert.deepEqual(await pageSizes(outcome.bytes), pages);
	assert.equal(doc.getPageCount(), 4);
});

test('compressLossless: 進捗は単調増加し total/total で終わる', async () => {
	const calls: Array<[number, number]> = [];
	await compressLossless(read('text-ja.pdf'), {
		onProgress: (done, total) => calls.push([done, total]),
	});
	assert.ok(calls.length >= 3);
	const total = calls[0][1];
	assert.ok(calls.every(([, t]) => t === total));
	for (let i = 1; i < calls.length; i++) {
		assert.ok(calls[i][0] >= calls[i - 1][0]);
	}
	assert.deepEqual(calls.at(-1), [total, total]);
});

test('compressLossless: 開始前・処理中のキャンセルで cancelled を投げる', async () => {
	const aborted = new AbortController();
	aborted.abort();
	await rejects(
		compressLossless(read('text-ja.pdf'), { signal: aborted.signal }),
		'cancelled',
	);

	const controller = new AbortController();
	let progressAfterAbort = 0;
	await rejects(
		compressLossless(read('text-ja.pdf'), {
			signal: controller.signal,
			onProgress: (done) => {
				if (controller.signal.aborted) progressAfterAbort++;
				if (done === 2) controller.abort();
			},
		}),
		'cancelled',
	);
	// 中断後に進む処理は高々1単位（中断を検知するまでの1ストリーム）
	assert.ok(progressAfterAbort <= 1);
});

test('chooseSmaller: 結果が大きい・同じ場合は元を採用し、小さい場合のみ reduced', () => {
	const original = new Uint8Array(100);
	const bigger = chooseSmaller(original, new Uint8Array(120), 'lossless', 1);
	assert.equal(bigger.reduced, false);
	assert.equal(bigger.bytes, original);
	assert.equal(bigger.outputSize, 100);
	const same = chooseSmaller(original, new Uint8Array(100), 'raster', 1);
	assert.equal(same.reduced, false);
	assert.equal(same.bytes, original);
	const smaller = new Uint8Array(60);
	const ok = chooseSmaller(original, smaller, 'raster', 1);
	assert.equal(ok.reduced, true);
	assert.equal(ok.bytes, smaller);
	assert.equal(reductionPercent(ok.originalSize, ok.outputSize), 40);
	assert.equal(reductionPercent(100, 120), 0);
});

// ---- 画像化（raster） ----

type RenderCall = {
	pageNumber: number;
	width: number;
	height: number;
	quality: number;
};

/** 指定寸法の単色JPEGを返す偽の描画実装 */
function fakeRasterizer(
	sizes: PageSizePt[],
	onRender?: (call: RenderCall) => void,
): PageRasterizer & { calls: RenderCall[] } {
	const calls: RenderCall[] = [];
	return {
		calls,
		pageCount: sizes.length,
		async getPageSize(n) {
			return sizes[n - 1];
		},
		async renderJpeg(pageNumber, size, quality) {
			const call = { pageNumber, ...size, quality };
			calls.push(call);
			onRender?.(call);
			return new Uint8Array(
				await sharp({
					create: {
						width: size.width,
						height: size.height,
						channels: 3,
						background: { r: 200, g: 200, b: 200 },
					},
				})
					.jpeg({ quality })
					.toBuffer(),
			);
		},
	};
}

/** 大きな元PDF（スキャン相当） */
const BIG_ORIGINAL = read('scan.pdf');

test('compressRaster: 表示上の寸法（回転後）・ページ数・順序を保ち、dpiに応じた画素数で描画する', async () => {
	// 縦・横・回転後に縦横が入れ替わったページを想定した表示寸法
	const sizes = [
		{ widthPt: 595, heightPt: 842 },
		{ widthPt: 842, heightPt: 595 },
		{ widthPt: 100, heightPt: 200 },
	];
	const rasterizer = fakeRasterizer(sizes);
	const outcome = await compressRaster(BIG_ORIGINAL, rasterizer, {
		dpi: 144,
		jpegQuality: 50,
	});
	assert.equal(outcome.reduced, true);
	assert.equal(outcome.mode, 'raster');
	assert.deepEqual(await pageSizes(outcome.bytes), [
		{ width: 595, height: 842, rotation: 0 },
		{ width: 842, height: 595, rotation: 0 },
		{ width: 100, height: 200, rotation: 0 },
	]);
	// 144dpi = 2倍。四捨五入した画素数で、ページ順に描画する
	assert.deepEqual(rasterizer.calls, [
		{ pageNumber: 1, width: 1190, height: 1684, quality: 50 },
		{ pageNumber: 2, width: 1684, height: 1190, quality: 50 },
		{ pageNumber: 3, width: 200, height: 400, quality: 50 },
	]);
	// 画像化後は文字を含まない（データ損失の明示が必要な理由の確認）
	const text = await extractTextAndLinks(outcome.bytes);
	assert.ok(text.every((p) => p.text === '' && p.links.length === 0));
});

test('compressRaster: 元より大きくなる場合は元のPDFを返す', async () => {
	const original = read('compact.pdf');
	const outcome = await compressRaster(
		original,
		fakeRasterizer([{ widthPt: 595, heightPt: 842 }]),
		{ dpi: 144, jpegQuality: 92 },
	);
	assert.equal(outcome.reduced, false);
	assert.equal(outcome.bytes, original);
});

test('compressRaster: 16メガピクセル超のページがあれば描画前に拒否する', async () => {
	// 2000×2000pt は 144dpi で 4000×4000px（16.0MP）。上限 16,000,000 ちょうどは許可
	const atLimit = fakeRasterizer([{ widthPt: 2000, heightPt: 2000 }]);
	assert.equal(
		pixelSizeForPage({ widthPt: 2000, heightPt: 2000 }, 144).width,
		4000,
	);
	await compressRaster(BIG_ORIGINAL, atLimit, { dpi: 144, jpegQuality: 50 });

	const over = fakeRasterizer([
		{ widthPt: 595, heightPt: 842 },
		{ widthPt: 2001, heightPt: 2000 },
	]);
	await rejects(
		compressRaster(BIG_ORIGINAL, over, { dpi: 144, jpegQuality: 50 }),
		'too-many-pixels',
		'2ページ目',
	);
	assert.equal(over.calls.length, 0);
	// 解像度を下げれば同じページを処理できる
	await compressRaster(BIG_ORIGINAL, over, { dpi: 96, jpegQuality: 50 });
});

test('compressRaster: 処理中のキャンセルで以降のページを描画しない', async () => {
	const controller = new AbortController();
	const rasterizer = fakeRasterizer(
		Array.from({ length: 5 }, () => ({ widthPt: 100, heightPt: 100 })),
		(call) => {
			if (call.pageNumber === 2) controller.abort();
		},
	);
	await rejects(
		compressRaster(
			BIG_ORIGINAL,
			rasterizer,
			{ dpi: 72, jpegQuality: 70 },
			{ signal: controller.signal },
		),
		'cancelled',
	);
	assert.deepEqual(
		rasterizer.calls.map((c) => c.pageNumber),
		[1, 2],
	);
});

test('compressRaster: 不正な設定・ページ数上限を拒否する', async () => {
	await rejects(
		compressRaster(
			BIG_ORIGINAL,
			fakeRasterizer([{ widthPt: 1, heightPt: 1 }]),
			{
				dpi: 300 as never,
				jpegQuality: 70,
			},
		),
		'invalid-option',
	);
	await rejects(
		compressRaster(
			BIG_ORIGINAL,
			fakeRasterizer([{ widthPt: 1, heightPt: 1 }]),
			{
				dpi: 96,
				jpegQuality: 101 as never,
			},
		),
		'invalid-option',
	);
	await rejects(
		compressRaster(
			BIG_ORIGINAL,
			fakeRasterizer(
				Array.from({ length: 101 }, () => ({ widthPt: 1, heightPt: 1 })),
			),
			DEFAULT_PDF_COMPRESS_SETTINGS,
		),
		'too-many-pages',
	);
});

// ---- 設定・ファイル名 ----

test('sanitizePdfCompressSettings: 許可値のみ採用し、圧縮方式は保持しない', () => {
	const defaults = DEFAULT_PDF_COMPRESS_SETTINGS;
	assert.deepEqual(
		sanitizePdfCompressSettings({ dpi: 144, jpegQuality: 85 }, defaults),
		{ dpi: 144, jpegQuality: 85 },
	);
	assert.deepEqual(
		sanitizePdfCompressSettings(
			{ dpi: 150, jpegQuality: '85', mode: 'raster' },
			defaults,
		),
		defaults,
	);
	assert.deepEqual(sanitizePdfCompressSettings(null, defaults), defaults);
	assert.deepEqual(sanitizePdfCompressSettings([96], defaults), defaults);
});

test('compressedFileName: 元のファイル名に _compressed を付ける', () => {
	assert.equal(compressedFileName('見積書'), '見積書_compressed.pdf');
});

test('文字を含む標準フォントPDF（pdf-lib生成）も lossless で文字を維持する', async () => {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	doc.addPage([300, 300]).drawText('Keep this text', { x: 10, y: 150, font });
	const original = await doc.save({ useObjectStreams: false });
	const outcome = await compressLossless(original);
	const pages = await extractTextAndLinks(outcome.bytes);
	assert.equal(pages[0].text, 'Keep this text');
});

// 残存DecodeParmsは、フィルタ未指定では無視されるがFlate追加後は有効になる。
// 同じPDFの描画を独立に比較し、標準モードが画像を変更しないことを保証する。
test('標準圧縮: フィルタなし画像のDecodeParmsを新しいFlateに適用せず画素を保持する', async () => {
	const doc = await PDFDocument.create();
	const page = doc.addPage([200, 200]);
	const rgb = new Uint8Array(100 * 100 * 3);
	for (let i = 0; i < rgb.length; i += 3) {
		rgb[i] = 255;
		rgb[i + 1] = i % 300 < 150 ? 32 : 220;
		rgb[i + 2] = 32;
	}
	const rawImage = PDFRawStream.of(
		doc.context.obj({
			Type: 'XObject',
			Subtype: 'Image',
			Width: 100,
			Height: 100,
			ColorSpace: 'DeviceRGB',
			BitsPerComponent: 8,
			DecodeParms: {
				Predictor: 12,
				Colors: 3,
				BitsPerComponent: 8,
				Columns: 100,
			},
		}),
		rgb,
	);
	const ref = doc.context.register(rawImage);
	page.node.set(
		PDFName.of('Resources'),
		doc.context.obj({ XObject: { Im0: ref } }),
	);
	page.node.set(
		PDFName.of('Contents'),
		doc.context.register(doc.context.stream('q 200 0 0 200 0 0 cm /Im0 Do Q')),
	);
	const original = await doc.save({ useObjectStreams: false });
	const result = await compressLossless(original);
	const pdfjs = await loadPdfjs();
	const { createCanvas } = await import('@napi-rs/canvas');
	async function renderPixels(bytes: Uint8Array) {
		const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
		try {
			const loaded = await task.promise;
			const p = await loaded.getPage(1);
			const canvas = createCanvas(200, 200);
			const context = canvas.getContext('2d');
			await p.render({
				canvas,
				canvasContext: context,
				viewport: p.getViewport({ scale: 1 }),
			}).promise;
			return context.getImageData(0, 0, 200, 200).data;
		} finally {
			await task.destroy();
		}
	}
	assert.deepEqual(
		await renderPixels(result.bytes),
		await renderPixels(original),
	);
});

test('inspectPdfForCompress: 圧縮オブジェクト内の間接参照Subtypeもフォームとして拒否する', async () => {
	const doc = await PDFDocument.create();
	doc.addPage([200, 200]);
	const subtype = doc.context.register(PDFName.of('Widget'));
	doc.context.register(
		doc.context.obj({ Subtype: subtype, Rect: [0, 0, 100, 30] }),
	);
	await rejects(inspectPdfForCompress(await doc.save()), 'form');
});

test('画像化圧縮: 不正なJPEGを返す失敗経路も日本語のPdfToolErrorとして通知する', async () => {
	const renderer: PageRasterizer = {
		pageCount: 1,
		getPageSize: async () => ({ widthPt: 200, heightPt: 200 }),
		renderJpeg: async () => new Uint8Array([1, 2, 3]),
	};
	await rejects(
		compressRaster(
			read('compact.pdf'),
			renderer,
			DEFAULT_PDF_COMPRESS_SETTINGS,
		),
		'corrupt',
		'PDFを読み込めませんでした',
	);
});

test('画像化圧縮: 描画リソース失敗はPDF破損に上書きせず回復案内を維持する', async () => {
	const { imageGenerationError } = await import('../../src/lib/pdf/common.ts');
	const renderer: PageRasterizer = {
		pageCount: 1,
		getPageSize: async () => ({ widthPt: 200, heightPt: 200 }),
		renderJpeg: async () => {
			throw imageGenerationError();
		},
	};
	await rejects(
		compressRaster(
			read('compact.pdf'),
			renderer,
			DEFAULT_PDF_COMPRESS_SETTINGS,
		),
		'render-failed',
		'解像度を下げてお試しください',
	);
});
