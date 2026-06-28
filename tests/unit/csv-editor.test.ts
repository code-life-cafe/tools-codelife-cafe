import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	exportCsv,
	getColumnLabel,
	parseCsv,
} from '../../src/lib/tools/csv-editor';

test('parseCsv & exportCsv: 正しい行・列構造でパースおよびエクスポートされる', () => {
	const input = 'A,B,C\n1,2,3\n4,5,6';
	const parsed = parseCsv(input);
	assert.strictEqual(parsed.data.rows.length, 3);
	assert.strictEqual(parsed.data.colCount, 3);

	const output = exportCsv(parsed.data).replace(/\r\n/g, '\n');
	assert.strictEqual(output.trim(), input);
});

test('getColumnLabel: インデックスに応じたExcelスタイルの列ラベルを生成する', () => {
	assert.strictEqual(getColumnLabel(0), 'A');
	assert.strictEqual(getColumnLabel(1), 'B');
	assert.strictEqual(getColumnLabel(25), 'Z');
	assert.strictEqual(getColumnLabel(26), 'AA');
});

test('exportCsv: 列追加後のデータから列数不整合や不要な末尾カンマが出ないことを検証', () => {
	const data = {
		rows: [
			['A', 'B', 'C', 'D'],
			['1', '2', '3', ''],
		],
		colCount: 4,
	};
	const output = exportCsv(data);
	// Papa.unparse が各行を正しくクオート/カンマ出力し、不正な行数・列数にならないこと
	assert.ok(output.includes('A,B,C,D'));
	assert.ok(output.includes('1,2,3,'));
});
