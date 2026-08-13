// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/csv-fixer.test.ts
//
// csv-fixer のエンコーディング検出・変換・CSVプレビュー・ファイル検証ロジックを対象とする。
// ファイル選択UI（FileDropZone等）はブラウザ専用のため E2E で検証する。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePreview } from '../../src/lib/csv/preview.ts';
import { convertEncoding } from '../../src/lib/encoding/convert.ts';
import { detectEncoding } from '../../src/lib/encoding/detect.ts';
import { detectLineEnding } from '../../src/lib/encoding/lineEndings.ts';
import {
	getMaxFileSize,
	validateFile,
} from '../../src/lib/validation/fileValidator.ts';

function toBuffer(str: string): ArrayBuffer {
	return new TextEncoder().encode(str).buffer as ArrayBuffer;
}

function fakeFile(name: string, size: number): File {
	return { name, size } as unknown as File;
}

// ============================================================
// detectEncoding
// ============================================================

test('detectEncoding: 100バイト未満のファイルは confidence: low', () => {
	const result = detectEncoding(toBuffer('short utf8 text'));
	assert.equal(result.confidence, 'low');
});

test('detectEncoding: ASCIIのみのテキストは confidence: low', () => {
	const result = detectEncoding(toBuffer('a'.repeat(200)));
	assert.equal(result.confidence, 'low');
});

test('detectEncoding: ある程度長い日本語UTF-8テキストは UTF8 として検出される', () => {
	const text = 'こんにちは、世界。'.repeat(20);
	const result = detectEncoding(toBuffer(text));
	assert.equal(result.encoding, 'UTF8');
});

test('detectEncoding: 空バッファは低信頼度のフォールバックを返す', () => {
	const result = detectEncoding(new ArrayBuffer(0));
	assert.equal(result.confidence, 'low');
	assert.ok(typeof result.encoding === 'string');
});

// ============================================================
// detectLineEnding
// ============================================================

test('detectLineEnding: CRLFのみ -> CRLF', () => {
	assert.equal(detectLineEnding('a\r\nb\r\nc'), 'CRLF');
});

test('detectLineEnding: LFのみ -> LF', () => {
	assert.equal(detectLineEnding('a\nb\nc'), 'LF');
});

test('detectLineEnding: CRのみ -> CR', () => {
	assert.equal(detectLineEnding('a\rb\rc'), 'CR');
});

test('detectLineEnding: 改行なし -> NONE', () => {
	assert.equal(detectLineEnding('abc'), 'NONE');
});

test('detectLineEnding: CRLFとLFが混在 -> MIXED', () => {
	assert.equal(detectLineEnding('a\r\nb\nc'), 'MIXED');
});

// ============================================================
// parsePreview
// ============================================================

test('parsePreview: 非数値の先頭行はヘッダーとして扱われる', () => {
	const result = parsePreview('name,age\nAlice,30\nBob,25', 10);
	assert.deepEqual(result.headers, ['name', 'age']);
	assert.equal(result.rows.length, 2);
	assert.equal(result.delimiter, ',');
});

test('parsePreview: 数値のみの先頭行はヘッダーとして扱われない', () => {
	const result = parsePreview('1,2\n3,4', 10);
	assert.equal(result.headers, null);
	assert.equal(result.rows.length, 2);
});

test('parsePreview: totalRowEstimate は全体の改行数から見積もる', () => {
	const result = parsePreview('a,b\nc,d\ne,f\ng,h', 2);
	assert.equal(result.totalRowEstimate, 4);
	// preview: maxRows=2 のためプレビュー行数はそれ以下
	assert.ok(result.rows.length <= 2);
});

test('parsePreview: タブ区切りの delimiter を検出する', () => {
	const result = parsePreview('a\tb\nc\td', 10);
	assert.equal(result.delimiter, '\t');
});

test('parsePreview: 空文字列は1行の見積もりを返す', () => {
	const result = parsePreview('', 10);
	assert.equal(result.totalRowEstimate, 1);
});

// ============================================================
// convertEncoding
// ============================================================

test('convertEncoding: UTF-8 BOMを剥がしてから変換する', () => {
	const withBom = new Uint8Array([
		0xef,
		0xbb,
		0xbf,
		...new TextEncoder().encode('abc'),
	]);
	const result = convertEncoding(
		withBom.buffer as ArrayBuffer,
		'UTF8',
		{ outputEncoding: 'UTF8', lineEnding: 'LF', addBom: false },
		'sample.csv',
	);
	assert.equal(result.blob.type, 'text/csv; charset=utf-8');
	assert.equal(result.fileName, 'sample_converted.csv');
	assert.equal(result.outputEncoding, 'UTF8');
});

test('convertEncoding: addBom: true で UTF-8 BOMが付与される', async () => {
	const result = convertEncoding(
		toBuffer('a,b\nc,d'),
		'UTF8',
		{ outputEncoding: 'UTF8', lineEnding: 'LF', addBom: true },
		'data.csv',
	);
	const bytes = new Uint8Array(await result.blob.arrayBuffer());
	assert.equal(bytes[0], 0xef);
	assert.equal(bytes[1], 0xbb);
	assert.equal(bytes[2], 0xbf);
});

test('convertEncoding: 改行コードを CRLF に統一する', async () => {
	const result = convertEncoding(
		toBuffer('a\nb\rc\r\nd'),
		'UTF8',
		{ outputEncoding: 'UTF8', lineEnding: 'CRLF', addBom: false },
		'x.csv',
	);
	const text = await result.blob.text();
	assert.equal(text, 'a\r\nb\r\nc\r\nd');
	assert.equal(result.lineCount, 4);
});

test('convertEncoding: 出力ファイル名は拡張子を除いた basename + _converted.csv', () => {
	const result = convertEncoding(
		toBuffer('a'),
		'UTF8',
		{ outputEncoding: 'UTF8', lineEnding: 'LF', addBom: false },
		'archive.tar.csv',
	);
	assert.equal(result.fileName, 'archive.tar_converted.csv');
});

// ============================================================
// fileValidator
// ============================================================

test('validateFile: 空ファイルは EMPTY_FILE', () => {
	const result = validateFile(fakeFile('data.csv', 0));
	assert.equal(result.valid, false);
	assert.equal(result.error, 'EMPTY_FILE');
});

test('validateFile: 非対応拡張子は INVALID_EXTENSION', () => {
	const result = validateFile(fakeFile('data.xlsx', 100));
	assert.equal(result.valid, false);
	assert.equal(result.error, 'INVALID_EXTENSION');
});

test('validateFile: 上限を超えるサイズは FILE_TOO_LARGE', () => {
	const result = validateFile(fakeFile('data.csv', getMaxFileSize() + 1));
	assert.equal(result.valid, false);
	assert.equal(result.error, 'FILE_TOO_LARGE');
});

test('validateFile: 対応拡張子かつサイズ内は valid: true', () => {
	for (const name of ['data.csv', 'data.tsv', 'data.txt', 'DATA.CSV']) {
		const result = validateFile(fakeFile(name, 100));
		assert.equal(result.valid, true, `${name} は valid`);
	}
});

test('getMaxFileSize: 正の数を返す', () => {
	assert.ok(getMaxFileSize() > 0);
});
