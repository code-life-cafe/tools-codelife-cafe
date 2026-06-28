import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	cellRefToCoords,
	excelSerialToDate,
	isDecompressionStreamSupported,
	parseXmlString,
} from '../../src/lib/tools/xlsx-reader.ts';

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
