import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
	cellRefToCoords,
	excelSerialToDate,
	isDecompressionStreamSupported,
	MAX_ENTRY_DECOMPRESSED_BYTES,
	MAX_TOTAL_DECOMPRESSED_BYTES,
	parseXlsx,
	parseXmlString,
} from '../../src/lib/tools/xlsx-reader.ts';

/** テスト用の最小ZIP（deflate、CRCは検証されないため0）を組み立てる */
function buildZip(files: { name: string; data: Uint8Array }[]): ArrayBuffer {
	const encoder = new TextEncoder();
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;
	for (const file of files) {
		const name = encoder.encode(file.name);
		const comp = deflateRawSync(file.data);
		const local = new Uint8Array(30 + name.length + comp.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(8, 8, true);
		lv.setUint32(18, comp.length, true);
		lv.setUint32(22, file.data.length, true);
		lv.setUint16(26, name.length, true);
		local.set(name, 30);
		local.set(comp, 30 + name.length);

		const central = new Uint8Array(46 + name.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(4, 20, true);
		cv.setUint16(6, 20, true);
		cv.setUint16(10, 8, true);
		cv.setUint32(20, comp.length, true);
		cv.setUint32(24, file.data.length, true);
		cv.setUint16(28, name.length, true);
		cv.setUint32(42, offset, true);
		central.set(name, 46);

		locals.push(local);
		centrals.push(central);
		offset += local.length;
	}
	const cdSize = centrals.reduce((sum, c) => sum + c.length, 0);
	const eocd = new Uint8Array(22);
	const ev = new DataView(eocd.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, files.length, true);
	ev.setUint16(10, files.length, true);
	ev.setUint32(12, cdSize, true);
	ev.setUint32(16, offset, true);

	const out = new Uint8Array(offset + cdSize + 22);
	let pos = 0;
	for (const part of [...locals, ...centrals, eocd]) {
		out.set(part, pos);
		pos += part.length;
	}
	return out.buffer;
}

/** 指定セル参照だけを持つ1シートのブックを作る */
function buildWorkbook(
	cellRefs: string[],
	extra: { name: string; data: Uint8Array }[] = [],
): ArrayBuffer {
	const encoder = new TextEncoder();
	const cells = cellRefs.map((r) => `<c r="${r}"><v>1</v></c>`).join('');
	return buildZip([
		{
			name: 'xl/workbook.xml',
			data: encoder.encode(
				'<workbook><sheets><sheet name="Sheet1" sheetId="1"/></sheets></workbook>',
			),
		},
		{
			name: 'xl/worksheets/sheet1.xml',
			data: encoder.encode(
				`<worksheet><sheetData><row>${cells}</row></sheetData></worksheet>`,
			),
		},
		...extra,
	]);
}

test('isDecompressionStreamSupported - 環境チェック', () => {
	const supported = isDecompressionStreamSupported();
	assert.equal(typeof supported, 'boolean');
});

test('excelSerialToDate - 日付シリアル値変換 (1900日付系)', () => {
	const d1 = excelSerialToDate(1, false);
	assert.equal(d1.getUTCFullYear(), 1900);
	assert.equal(d1.getUTCMonth(), 0);
	assert.equal(d1.getUTCDate(), 1);

	const d2 = excelSerialToDate(46201, false);
	assert.equal(d2.getUTCFullYear(), 2026);
	assert.equal(d2.getUTCMonth(), 5);
	assert.equal(d2.getUTCDate(), 28);
});

test('excelSerialToDate - 日付シリアル値変換 (1904日付系)', () => {
	const d1 = excelSerialToDate(0, true);
	assert.equal(d1.getUTCFullYear(), 1904);
	assert.equal(d1.getUTCMonth(), 0);
	assert.equal(d1.getUTCDate(), 1);
});

test('cellRefToCoords - 座標変換', () => {
	assert.deepEqual(cellRefToCoords('A1'), { row: 0, col: 0 });
	assert.deepEqual(cellRefToCoords('B3'), { row: 2, col: 1 });
	assert.deepEqual(cellRefToCoords('Z10'), { row: 9, col: 25 });
	assert.deepEqual(cellRefToCoords('AA1'), { row: 0, col: 26 });
});

test('parseXmlString - XML解析ヘルパーおよびinlineStr / cellXfs構造', () => {
	const xml = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><r><t>山</t></r><r><t>田</t></r></is></c></row></sheetData></worksheet>`;
	const doc = parseXmlString(xml);
	assert.ok(doc);
	const cNode = doc.querySelector('c');
	assert.ok(cNode);
	const tNodes = cNode.querySelectorAll('t');
	const text = tNodes.map((t) => t.textContent).join('');
	assert.equal(text, '山田');
});

test('parseXmlString - 特殊文字を含む属性やセレクタでも安全に解析できる (escapeRegExp)', () => {
	const xml = `<worksheet><custom[tag] attr(1)="value[test]">hello</custom[tag]></worksheet>`;
	const doc = parseXmlString(xml);
	assert.ok(doc);
	const node = doc.querySelector('custom[tag]');
	assert.ok(node, 'custom[tag] が見つかること');
	assert.equal(node.getAttribute('attr(1)'), 'value[test]');
});

test('parseXlsx - 最小ブックを解析できる（テスト用ZIPの健全性確認）', async () => {
	const result = await parseXlsx(buildWorkbook(['A1', 'B2']));
	assert.equal(result.sheets.length, 1);
	assert.deepEqual(result.sheets[0].rows, [
		['1', ''],
		['', '1'],
	]);
});

test('parseXlsx - 行数上限: 100,000行目は許可し100,001行目は拒否する', async () => {
	const ok = await parseXlsx(buildWorkbook(['A100000']));
	assert.equal(ok.sheets[0].rows.length, 100_000);
	await assert.rejects(
		parseXlsx(buildWorkbook(['A100001'])),
		/最大100,000行・1,000列/,
	);
});

test('parseXlsx - 列数上限: 1,000列目(ALL)は許可し1,001列目(ALM)は拒否する', async () => {
	const ok = await parseXlsx(buildWorkbook(['ALL1']));
	assert.equal(ok.sheets[0].rows[0].length, 1_000);
	await assert.rejects(
		parseXlsx(buildWorkbook(['ALM1'])),
		/最大100,000行・1,000列/,
	);
});

test('parseXlsx - 総セル数上限: 2,000,000セルは許可し超過は拒否する', async () => {
	// ALL2000 → 2,000行 × 1,000列 = 2,000,000セル
	const ok = await parseXlsx(buildWorkbook(['A1', 'ALL2000']));
	assert.equal(ok.sheets[0].rows.length, 2_000);
	await assert.rejects(
		parseXlsx(buildWorkbook(['A1', 'ALL2001'])),
		/最大2,000,000セル/,
	);
});

test('parseXlsx - 展開後1エントリ上限: 20MBちょうどは許可し超過は拒否する', async () => {
	const ok = await parseXlsx(
		buildWorkbook(
			['A1'],
			[
				{
					name: 'xl/media/image1.bin',
					data: new Uint8Array(MAX_ENTRY_DECOMPRESSED_BYTES),
				},
			],
		),
	);
	assert.equal(ok.sheets.length, 1);
	await assert.rejects(
		parseXlsx(
			buildWorkbook(
				['A1'],
				[
					{
						name: 'xl/media/image1.bin',
						data: new Uint8Array(MAX_ENTRY_DECOMPRESSED_BYTES + 1),
					},
				],
			),
		),
		/展開後サイズが安全上限を超えています/,
	);
});

test('parseXlsx - 展開後合計上限: 合計60MB超過は拒否する', async () => {
	const chunk = MAX_TOTAL_DECOMPRESSED_BYTES / 4;
	const extra = [1, 2, 3, 4].map((n) => ({
		name: `xl/media/image${n}.bin`,
		data: new Uint8Array(chunk),
	}));
	// 1エントリ15MBは単体上限内だが、ブック本体と合わせて60MBを超える
	await assert.rejects(
		parseXlsx(buildWorkbook(['A1'], extra)),
		/展開後サイズが安全上限を超えています/,
	);
});

test('parseXlsx - 展開対象外のエントリは上限を超えていても展開しない', async () => {
	const result = await parseXlsx(
		buildWorkbook(
			['A1'],
			[
				{
					name: 'docProps/huge.bin',
					data: new Uint8Array(MAX_ENTRY_DECOMPRESSED_BYTES + 1),
				},
			],
		),
	);
	assert.deepEqual(result.sheets[0].rows, [['1']]);
});
