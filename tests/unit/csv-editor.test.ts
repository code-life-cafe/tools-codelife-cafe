import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	decodeCsvBytes,
	exportCsv,
	exportCsvJson,
	getColumnLabel,
	parseCsv,
} from '../../src/lib/tools/csv-editor.ts';

test('decodeCsvBytes: Shift-JISの再現バイト列を文字化けせず読み込む（#615）', () => {
	const bytes = Uint8Array.from([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x82, 0xa0]);
	assert.equal(decodeCsvBytes(bytes), 'name\nあ');
});

test('decodeCsvBytes: BOMなしUTF-8の日本語CSVをUTF-8として自動判別する（F1）', () => {
	const text = '名前,年齢\n田中,30';
	assert.equal(decodeCsvBytes(new TextEncoder().encode(text)), text);
});

test('decodeCsvBytes: BOMなしUTF-8の「あい」をUTF-8として自動判別する（F1）', () => {
	assert.equal(decodeCsvBytes(new TextEncoder().encode('あい')), 'あい');
});

test('decodeCsvBytes: UTF-8として不正なShift-JISの日本語CSVを自動判別する（F1）', () => {
	// Shift-JISでエンコードした「名前,年齢\n田中,30」。
	const bytes = Uint8Array.from([
		0x96, 0xbc, 0x91, 0x4f, 0x2c, 0x94, 0x4e, 0x97, 0xee, 0x0a, 0x93, 0x63,
		0x92, 0x86, 0x2c, 0x33, 0x30,
	]);
	assert.throws(() => decodeCsvBytes(bytes, 'utf-8'), /文字コード/);
	assert.equal(decodeCsvBytes(bytes), '名前,年齢\n田中,30');
});

test('decodeCsvBytes: UTF-8・ASCII・空入力・BOM付きUTF-8/UTF-16を保持する', () => {
	for (const text of ['', 'name\nAlice', 'name\nあ', '\uFEFFname\nあ']) {
		assert.equal(
			decodeCsvBytes(new TextEncoder().encode(text)),
			text.replace(/^\uFEFF/, ''),
		);
	}
	assert.equal(decodeCsvBytes(Uint8Array.from([0xff, 0xfe, 0x42, 0x30])), 'あ');
	assert.equal(decodeCsvBytes(Uint8Array.from([0xfe, 0xff, 0x30, 0x42])), 'あ');
});

test('decodeCsvBytes: 両方で有効なバイト列はUTF-8を優先し、明示指定も保持する（F1）', () => {
	const ambiguous = Uint8Array.from([0xc2, 0xa9]);
	// 両方でデコード可能でも、厳密UTF-8が成功した場合は選択を要求しない。
	assert.equal(decodeCsvBytes(ambiguous), '©');
	assert.equal(decodeCsvBytes(ambiguous, 'utf-8'), '©');
	assert.equal(decodeCsvBytes(ambiguous, 'shift-jis'), 'ﾂｩ');
});

test('decodeCsvBytes: 両方で不正なバイト列は保留し、明示指定ではエラーにする（#615）', () => {
	const invalid = Uint8Array.from([0x82]);
	assert.equal(decodeCsvBytes(invalid), null);
	assert.throws(() => decodeCsvBytes(invalid, 'utf-8'), /文字コード/);
	assert.throws(() => decodeCsvBytes(invalid, 'shift-jis'), /文字コード/);
	assert.throws(
		() => decodeCsvBytes(Uint8Array.from([0xef, 0xbb, 0xbf, 0x82])),
		/文字コード/,
	);
});

test('exportCsvJson: __proto__等の特殊キーも全列保持する（#616）', () => {
	const { data } = parseCsv('__proto__,name,constructor,toString\nx,y,z,w');
	const output = JSON.parse(exportCsvJson(data, true));
	assert.deepEqual(Object.keys(output[0]), [
		'__proto__',
		'name',
		'constructor',
		'toString',
	]);
	assert.equal(
		Object.getOwnPropertyDescriptor(output[0], '__proto__')?.value,
		'x',
	);
	assert.equal(output[0].name, 'y');
	assert.equal(output[0].constructor, 'z');
	assert.equal(output[0].toString, 'w');
});

test('exportCsvJson: 重複ヘッダーと空ヘッダーの補完名衝突を拒否する（#616）', () => {
	for (const input of [
		'name,name\na,b',
		',Column1\na,b',
		'__proto__,__proto__\na,b',
	]) {
		const { data } = parseCsv(input);
		assert.throws(() => exportCsvJson(data, true), /ヘッダー.*重複/);
	}
});

test('exportCsvJson: 通常・ヘッダーなし・空・ヘッダーのみ・不揃い行の出力を維持する', () => {
	for (const [input, hasHeader, expected] of [
		[
			'名前,備考\n田中,"一行目\n二行目"',
			true,
			[{ 名前: '田中', 備考: '一行目\n二行目' }],
		],
		[
			'name,name\na,b',
			false,
			[
				['name', 'name'],
				['a', 'b'],
			],
		],
		['', true, []],
		['名前,備考', true, [['名前', '備考']]],
		[',名前\nx', true, [{ Column1: 'x', 名前: '' }]],
	] as const) {
		assert.deepEqual(
			JSON.parse(exportCsvJson(parseCsv(input).data, hasHeader)),
			expected,
		);
	}
});

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
