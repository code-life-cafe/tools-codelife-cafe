// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/pdf.test.ts
//
// pdf-lib を用いた merge / split / 範囲パース / 暗号化検出のロジックを検証する。
// テスト用PDFは pdf-lib でその場生成し、暗号化PDFのみ事前生成フィクスチャ
// （tests/e2e/fixtures/encrypted.pdf、生成方法は tests/e2e/fixtures/README.md）を使う。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
	hasPdfSignature,
	loadPdfInfo,
	MAX_MERGE_FILES,
	mergePdfs,
	parsePageRanges,
	singlePageRanges,
	splitFileName,
	splitPdf,
	validateMergeFileCount,
	validateTotalInputSize,
} from '../../src/lib/tools/pdf.ts';

const ENCRYPTED_PDF = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'encrypted.pdf',
);

/** pdf-lib で nPages ページのPDFを生成する */
async function makePdf(nPages: number): Promise<Uint8Array> {
	const { PDFDocument } = await import('pdf-lib');
	const doc = await PDFDocument.create();
	for (let i = 0; i < nPages; i++) {
		const page = doc.addPage([200, 200]);
		page.drawText(`Page ${i + 1}`, { x: 20, y: 100 });
	}
	return doc.save();
}

/** 1x1 赤ピクセルの最小PNG（決定的バイト列） */
const TINY_PNG = Uint8Array.from(
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
		'base64',
	),
);

async function pageCountOf(bytes: Uint8Array): Promise<number> {
	const { PDFDocument } = await import('pdf-lib');
	const doc = await PDFDocument.load(bytes);
	return doc.getPageCount();
}

// ---------------------------------------------------------------------------
// mergePdfs
// ---------------------------------------------------------------------------

test('mergePdfs: PDF 2つ + PNG 1つの結合結果のページ数が合計と一致する', async () => {
	const [a, b] = await Promise.all([makePdf(3), makePdf(5)]);
	const merged = await mergePdfs([
		{ kind: 'pdf', name: 'a.pdf', bytes: a },
		{ kind: 'pdf', name: 'b.pdf', bytes: b },
		{ kind: 'image', name: 'c.png', bytes: TINY_PNG, mime: 'image/png' },
	]);
	assert.ok(hasPdfSignature(merged), '%PDF- シグネチャで始まる');
	assert.equal(await pageCountOf(merged), 9);
});

test('mergePdfs: 進捗コールバックがファイルごとに呼ばれる', async () => {
	const a = await makePdf(1);
	const calls: Array<[number, number]> = [];
	await mergePdfs(
		[
			{ kind: 'pdf', name: 'a.pdf', bytes: a },
			{ kind: 'image', name: 'b.png', bytes: TINY_PNG, mime: 'image/png' },
		],
		(done, total) => calls.push([done, total]),
	);
	assert.deepEqual(calls, [
		[1, 2],
		[2, 2],
	]);
});

test('mergePdfs: 暗号化PDFを渡すとエラーになる', async () => {
	const bytes = new Uint8Array(fs.readFileSync(ENCRYPTED_PDF));
	await assert.rejects(mergePdfs([{ kind: 'pdf', name: 'enc.pdf', bytes }]));
});

// ---------------------------------------------------------------------------
// loadPdfInfo
// ---------------------------------------------------------------------------

test('loadPdfInfo: 通常PDFはページ数を返し encrypted: false', async () => {
	const bytes = await makePdf(4);
	assert.deepEqual(await loadPdfInfo(bytes), {
		pageCount: 4,
		encrypted: false,
	});
});

test('loadPdfInfo: 暗号化PDFは encrypted: true を返す', async () => {
	const bytes = new Uint8Array(fs.readFileSync(ENCRYPTED_PDF));
	assert.deepEqual(await loadPdfInfo(bytes), { pageCount: 0, encrypted: true });
});

// ---------------------------------------------------------------------------
// parsePageRanges
// ---------------------------------------------------------------------------

test('parsePageRanges: 正常系 1-3,5', () => {
	const result = parsePageRanges('1-3,5', 10);
	assert.ok(result.ok);
	assert.deepEqual(result.ranges, [[1, 2, 3], [5]]);
});

test('parsePageRanges: 開始のみ指定 8- は最終ページまで', () => {
	const result = parsePageRanges('8-', 10);
	assert.ok(result.ok);
	assert.deepEqual(result.ranges, [[8, 9, 10]]);
});

test('parsePageRanges: 全角数字・全角カンマ・空白を正規化する', () => {
	const result = parsePageRanges('１−３， 5　', 10);
	assert.ok(result.ok);
	assert.deepEqual(result.ranges, [[1, 2, 3], [5]]);
	assert.equal(result.normalizedInput, '1-3,5');
});

test('parsePageRanges: 順不同・重複も許容する', () => {
	const result = parsePageRanges('5,1-2,5', 10);
	assert.ok(result.ok);
	assert.deepEqual(result.ranges, [[5], [1, 2], [5]]);
});

test('parsePageRanges: 0 はエラー', () => {
	const result = parsePageRanges('0', 10);
	assert.ok(!result.ok);
	assert.equal(result.errors.length, 1);
	assert.equal(result.errors[0].token, '0');
	assert.match(result.errors[0].message, /1以上/);
});

test('parsePageRanges: ページ数超過はエラー（99-1000, 10ページ）', () => {
	const result = parsePageRanges('99-1000', 10);
	assert.ok(!result.ok);
	assert.match(result.errors[0].message, /全10ページ/);
});

test('parsePageRanges: 空文字はエラー', () => {
	const result = parsePageRanges('', 10);
	assert.ok(!result.ok);
	assert.equal(result.errors[0].index, 0);
});

test('parsePageRanges: 記号のみはエラー（位置つき）', () => {
	const result = parsePageRanges('1-3,abc', 10);
	assert.ok(!result.ok);
	assert.equal(result.errors.length, 1);
	assert.equal(result.errors[0].token, 'abc');
	assert.equal(result.errors[0].index, 4);
});

test('parsePageRanges: 終了 < 開始 はエラー', () => {
	const result = parsePageRanges('5-2', 10);
	assert.ok(!result.ok);
	assert.match(result.errors[0].message, /終了は開始以上/);
});

// ---------------------------------------------------------------------------
// splitPdf / singlePageRanges / splitFileName
// ---------------------------------------------------------------------------

test('splitPdf: 範囲ごとのページ数とファイル名が一致する', async () => {
	const bytes = await makePdf(5);
	const results = await splitPdf(
		bytes,
		[
			[1, 2],
			[4, 5],
		],
		'sample',
	);
	assert.equal(results.length, 2);
	assert.equal(results[0].fileName, 'sample_p1-2.pdf');
	assert.equal(results[1].fileName, 'sample_p4-5.pdf');
	assert.equal(await pageCountOf(results[0].bytes), 2);
	assert.equal(await pageCountOf(results[1].bytes), 2);
	assert.ok(hasPdfSignature(results[0].bytes));
});

test('splitPdf: 非連続ページの抽出は1ファイルにまとまる', async () => {
	const bytes = await makePdf(5);
	const results = await splitPdf(bytes, [[2, 4]], 'sample');
	assert.equal(results.length, 1);
	assert.equal(await pageCountOf(results[0].bytes), 2);
	assert.equal(results[0].fileName, 'sample_extract.pdf');
	assert.deepEqual(results[0].pageNumbers, [2, 4]);
});

test('splitPdf: 範囲外ページはエラー', async () => {
	const bytes = await makePdf(3);
	await assert.rejects(splitPdf(bytes, [[1, 4]]), /範囲外/);
});

test('splitPdf: 暗号化PDFはエラー', async () => {
	const bytes = new Uint8Array(fs.readFileSync(ENCRYPTED_PDF));
	await assert.rejects(splitPdf(bytes, [[1]]));
});

test('singlePageRanges: 全ページを1ページずつに展開する', () => {
	assert.deepEqual(singlePageRanges(3), [[1], [2], [3]]);
});

test('splitFileName: 単一ページは p{n}、連続範囲は p{start}-{end}', () => {
	assert.equal(splitFileName('doc', [7]), 'doc_p7.pdf');
	assert.equal(splitFileName('doc', [2, 3, 4]), 'doc_p2-4.pdf');
	assert.equal(splitFileName('doc', [1, 3]), 'doc_extract.pdf');
});

// ---------------------------------------------------------------------------
// バリデーション
// ---------------------------------------------------------------------------

test('validateMergeFileCount: 上限超過はエラー', () => {
	assert.ok(validateMergeFileCount(MAX_MERGE_FILES).ok);
	const result = validateMergeFileCount(MAX_MERGE_FILES + 1);
	assert.ok(!result.ok);
	assert.equal(result.reason, 'too-many-files');
});

test('validateTotalInputSize: 300MB超過はエラー', () => {
	assert.ok(validateTotalInputSize(300 * 1024 * 1024).ok);
	const result = validateTotalInputSize(300 * 1024 * 1024 + 1);
	assert.ok(!result.ok);
	assert.equal(result.reason, 'total-size-exceeded');
});

test('hasPdfSignature: %PDF- で始まらないバイト列は false', () => {
	assert.ok(!hasPdfSignature(new Uint8Array([0x50, 0x4b, 0x03, 0x04])));
	assert.ok(!hasPdfSignature(new Uint8Array([])));
});
