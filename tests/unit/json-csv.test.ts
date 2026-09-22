// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/json-csv.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildCsvBlob,
	type CsvToJsonOptions,
	csvToJson,
	detectDelimiter,
	flattenObject,
	inferCellValue,
	type JsonToCsvOptions,
	jsonToCsv,
	stripBom,
	unflattenObject,
} from '../../src/lib/tools/json-csv.ts';

const JSON_OPTS: JsonToCsvOptions = {
	delimiter: ',',
	includeHeader: true,
	flattenNested: true,
	newline: '\r\n',
};

const CSV_OPTS: CsvToJsonOptions = {
	delimiter: 'auto',
	hasHeader: true,
	inferTypes: true,
	unflattenDotKeys: false,
};

function expectOk(result: ReturnType<typeof jsonToCsv>): {
	output: string;
	rowCount: number;
} {
	assert.ok(result.ok, `ok を期待: ${JSON.stringify(result)}`);
	return result;
}

function expectError(result: ReturnType<typeof jsonToCsv>): {
	error: string;
	line?: number;
} {
	assert.ok(!result.ok, `エラーを期待: ${JSON.stringify(result)}`);
	return result;
}

// ---------------------------------------------------------------------------
// jsonToCsv
// ---------------------------------------------------------------------------

test('jsonToCsv: オブジェクト配列の基本変換とRFC4180クォート', () => {
	const input = JSON.stringify([
		{ name: 'カンマ,入り', note: '改行\n入り', quote: 'ダブル"クォート' },
		{ name: 'plain', note: 'b', quote: 'c' },
	]);
	const result = expectOk(jsonToCsv(input, JSON_OPTS));
	assert.equal(result.rowCount, 2);
	const lines = result.output.split('\r\n');
	assert.equal(lines[0], 'name,note,quote');
	assert.ok(result.output.includes('"カンマ,入り"'));
	assert.ok(result.output.includes('"改行\n入り"'));
	assert.ok(result.output.includes('"ダブル""クォート"'));
});

test('jsonToCsv: 単一オブジェクトは1行として扱う', () => {
	const result = expectOk(jsonToCsv('{"a":1,"b":"x"}', JSON_OPTS));
	assert.equal(result.rowCount, 1);
	assert.equal(result.output, 'a,b\r\n1,x');
});

test('jsonToCsv: ヘッダーは全行キーの和集合（出現順）・欠損は空文字', () => {
	const input = JSON.stringify([
		{ a: 1, b: 2 },
		{ b: 3, c: 4 },
	]);
	const result = expectOk(jsonToCsv(input, JSON_OPTS));
	assert.equal(result.output, 'a,b,c\r\n1,2,\r\n,3,4');
});

test('jsonToCsv: flattenNested ON でドット記法・配列インデックス', () => {
	const input = JSON.stringify([
		{ user: { name: '太郎', age: 30 }, items: ['a', 'b'] },
	]);
	const result = expectOk(jsonToCsv(input, JSON_OPTS));
	assert.equal(
		result.output,
		'user.name,user.age,items.0,items.1\r\n太郎,30,a,b',
	);
});

test('jsonToCsv: flattenNested OFF はネスト値をJSON文字列セルにする', () => {
	const input = JSON.stringify([{ user: { name: 'x' } }]);
	const result = expectOk(
		jsonToCsv(input, { ...JSON_OPTS, flattenNested: false }),
	);
	assert.equal(result.output, 'user\r\n"{""name"":""x""}"');
});

test('jsonToCsv: トップレベル不正は日本語エラー', () => {
	for (const input of ['123', '"text"', 'null', '[1,2,3]', '["a",{"b":1}]']) {
		const result = expectError(jsonToCsv(input, JSON_OPTS));
		assert.match(result.error, /変換できる/, `input=${input}`);
	}
});

test('jsonToCsv: 不正JSONは日本語エラー（位置情報があれば行番号付き）', () => {
	const result = expectError(jsonToCsv('[\n{"a":1},\n{"b":}\n]', JSON_OPTS));
	assert.match(result.error, /JSONの構文エラー/);
	// 後続データありの構文エラーは V8 が position を返すため行番号が取れる
	const trailing = expectError(jsonToCsv('[{"a":1}]\nxxx', JSON_OPTS));
	assert.match(trailing.error, /JSONの構文エラー/);
	assert.equal(trailing.line, 2);
});

test('jsonToCsv: includeHeader OFF / 区切り文字 / 改行コード', () => {
	const input = JSON.stringify([{ a: 1, b: 2 }]);
	const noHeader = expectOk(
		jsonToCsv(input, { ...JSON_OPTS, includeHeader: false }),
	);
	assert.equal(noHeader.output, '1,2');
	const tab = expectOk(jsonToCsv(input, { ...JSON_OPTS, delimiter: '\t' }));
	assert.equal(tab.output, 'a\tb\r\n1\t2');
	const semi = expectOk(jsonToCsv(input, { ...JSON_OPTS, delimiter: ';' }));
	assert.equal(semi.output, 'a;b\r\n1;2');
	const lf = expectOk(jsonToCsv(input, { ...JSON_OPTS, newline: '\n' }));
	assert.equal(lf.output, 'a,b\n1,2');
});

test('jsonToCsv: 入力先頭のBOMを自動除去する', () => {
	const result = expectOk(jsonToCsv('\u{FEFF}[{"a":1}]', JSON_OPTS));
	assert.equal(result.output, 'a\r\n1');
});

test('jsonToCsv: 安全整数範囲外の整数は桁落ちさせず文字列として出力する', () => {
	const result = expectOk(
		jsonToCsv('[{"id":9007199254740993,"code":"00123"}]', JSON_OPTS),
	);
	assert.equal(result.output, 'id,code\r\n9007199254740993,00123');
});

test('jsonToCsv: 安全整数境界の前後・正負・ネストで桁を保持する', () => {
	// 9007199254740993 等はJSソースの数値リテラルとして書くと解析時点で丸められるため、
	// 生のJSONテキストとして与える（JSON.stringifyを経由しない）。
	const input =
		'[{"maxSafe":9007199254740991,"overMaxSafe":9007199254740992,' +
		'"minSafe":-9007199254740991,"underMinSafe":-9007199254740992,' +
		'"normal":42,"nested":{"big":9007199254740993}}]';
	const result = expectOk(jsonToCsv(input, JSON_OPTS));
	const lines = result.output.split('\r\n');
	assert.equal(
		lines[0],
		'maxSafe,overMaxSafe,minSafe,underMinSafe,normal,nested.big',
	);
	assert.equal(
		lines[1],
		'9007199254740991,9007199254740992,-9007199254740991,-9007199254740992,42,9007199254740993',
	);
});

test('jsonToCsv: flattenNested OFF でも大整数の桁を保持する', () => {
	const result = expectOk(
		jsonToCsv('[{"id":9007199254740993}]', {
			...JSON_OPTS,
			flattenNested: false,
		}),
	);
	assert.equal(result.output, 'id\r\n9007199254740993');
});

test('jsonToCsv: 小数・指数表記の数値は従来どおりNumber変換する（桁保持対象外）', () => {
	const result = expectOk(jsonToCsv('[{"a":1.5,"b":1e21,"c":-0}]', JSON_OPTS));
	assert.equal(result.output, 'a,b,c\r\n1.5,1e+21,0');
});

test('jsonToCsv: flattenNested OFF でネスト内の大整数もJSON文字列セル内で桁を保持する', () => {
	const result = expectOk(
		jsonToCsv('[{"nested":{"id":9007199254740993}}]', {
			...JSON_OPTS,
			flattenNested: false,
		}),
	);
	assert.equal(result.output, 'nested\r\n"{""id"":9007199254740993}"');
});

test('jsonToCsv: 配列内・複数ネストレベルの大整数もJSON文字列セルで桁を保持する', () => {
	const result = expectOk(
		jsonToCsv(
			'[{"items":[{"id":9007199254740993},{"id":42}],"deep":{"a":{"id":-9007199254740993}}}]',
			{ ...JSON_OPTS, flattenNested: false },
		),
	);
	const parsedCells = result.output.split('\r\n')[1];
	assert.ok(parsedCells.includes('9007199254740993'));
	assert.ok(!parsedCells.includes('9007199254740992'));
	assert.ok(parsedCells.includes('-9007199254740993'));
});

test('jsonToCsv: オブジェクトの数値様キーの列挙順に依存せず、各値の桁を正しく紐づける', () => {
	// ネイティブJSON.parseのreviverは数値様キー（"1"・"2"等）をソース出現順ではなく
	// 昇順で走査する（＝ヘッダーも "1,2" の昇順になるのはJSの仕様どおりで正しい）。
	// 外部で走査した数値リテラルの出現順と突き合わせる実装だと、この列挙順のズレで
	// キー"2"の値とキー"1"の値を取り違える回帰がある。専用パーサーは値の構築と同時に
	// 桁を紐づけるため、列挙順が入れ替わっても各キーは元の値を保つ。
	const result = expectOk(
		jsonToCsv('[{"2":9007199254740993,"1":9007199254740995}]', JSON_OPTS),
	);
	const lines = result.output.split('\r\n');
	assert.equal(lines[0], '1,2');
	assert.equal(lines[1], '9007199254740995,9007199254740993');
});

// ---------------------------------------------------------------------------
// csvToJson
// ---------------------------------------------------------------------------

test('csvToJson: 基本変換（hasHeader ON）と rowCount', () => {
	const result = expectOk(
		csvToJson('name,age\r\n太郎,30\r\n花子,25', CSV_OPTS),
	);
	assert.equal(result.rowCount, 2);
	assert.deepEqual(JSON.parse(result.output), [
		{ name: '太郎', age: 30 },
		{ name: '花子', age: 25 },
	]);
});

test('csvToJson: hasHeader OFF は column_N キー', () => {
	const result = expectOk(
		csvToJson('a,b\r\nc,d', { ...CSV_OPTS, hasHeader: false }),
	);
	assert.deepEqual(JSON.parse(result.output), [
		{ column_1: 'a', column_2: 'b' },
		{ column_1: 'c', column_2: 'd' },
	]);
});

test('csvToJson: 重複ヘッダーは一意化して値を保持する', () => {
	const result = expectOk(csvToJson('a,a,a_2\r\n1,2,3', CSV_OPTS));
	assert.deepEqual(JSON.parse(result.output), [{ a: 1, a_2: 2, a_2_2: 3 }]);
});

test('csvToJson: __proto__ ヘッダーを通常列として保持する', () => {
	const result = expectOk(
		csvToJson('__proto__,constructor,prototype,x\r\np,c,t,1', {
			...CSV_OPTS,
			inferTypes: false,
		}),
	);
	assert.equal(
		result.output,
		[
			'[',
			'  {',
			'    "__proto__": "p",',
			'    "constructor": "c",',
			'    "prototype": "t",',
			'    "x": "1"',
			'  }',
			']',
		].join('\n'),
	);
});

test('csvToJson: BOM付き入力の自動除去', () => {
	const result = expectOk(csvToJson('\u{FEFF}a\r\n1', CSV_OPTS));
	assert.deepEqual(JSON.parse(result.output), [{ a: 1 }]);
});

test('csvToJson: 空行は無視する', () => {
	const result = expectOk(
		csvToJson('a,b\r\n\r\n1,2\r\n\r\n3,4\r\n\r\n', CSV_OPTS),
	);
	assert.equal(result.rowCount, 2);
});

test('csvToJson: 列数不足は空文字（型推論でnull）・超過は extra_N', () => {
	const result = expectOk(csvToJson('a,b\r\n1\r\n1,2,3,4', CSV_OPTS));
	assert.deepEqual(JSON.parse(result.output), [
		{ a: 1, b: null },
		{ a: 1, b: 2, extra_1: 3, extra_2: 4 },
	]);
	// inferTypes OFF では不足セルは空文字
	const noInfer = expectOk(
		csvToJson('a,b\r\n1', { ...CSV_OPTS, inferTypes: false }),
	);
	assert.deepEqual(JSON.parse(noInfer.output), [{ a: '1', b: '' }]);
});

test('csvToJson: クォート未閉じは行番号付き日本語エラー', () => {
	const result = expectError(csvToJson('a,b\r\n1,"未閉じ\r\n2,3', CSV_OPTS));
	assert.match(result.error, /引用符/);
	assert.match(result.error, /行目/);
	assert.ok(result.line != null);
});

test('csvToJson: quoted cell 後の不正文字は行番号付きエラー', () => {
	const result = expectError(csvToJson('a,b\r\n"x"y,2', CSV_OPTS));
	assert.match(result.error, /引用符/);
	assert.match(result.error, /行目/);
});

test('csvToJson: クォート内の改行・区切り文字・エスケープを保持', () => {
	const result = expectOk(
		csvToJson('a,b\r\n"改行\nあり","カンマ,と""引用"""', CSV_OPTS),
	);
	assert.deepEqual(JSON.parse(result.output), [
		{ a: '改行\nあり', b: 'カンマ,と"引用"' },
	]);
});

test('csvToJson: クォート内のCRLFをLFへ正規化せず保持する', () => {
	const result = expectOk(csvToJson('a,b\r\n"改行\r\nあり",x', CSV_OPTS));
	assert.deepEqual(JSON.parse(result.output), [{ a: '改行\r\nあり', b: 'x' }]);
});

test('csvToJson: \\r\\n と \\n の混在を読み取れる', () => {
	const result = expectOk(csvToJson('a,b\n1,2\r\n3,4', CSV_OPTS));
	assert.deepEqual(JSON.parse(result.output), [
		{ a: 1, b: 2 },
		{ a: 3, b: 4 },
	]);
});

test('csvToJson: unflattenDotKeys ON でネスト復元', () => {
	const result = expectOk(
		csvToJson('user.name,user.age,items.0,items.1\r\n太郎,30,a,b', {
			...CSV_OPTS,
			unflattenDotKeys: true,
		}),
	);
	assert.deepEqual(JSON.parse(result.output), [
		{ user: { name: '太郎', age: 30 }, items: ['a', 'b'] },
	]);
});

test('csvToJson: unflattenDotKeys ON でも prototype pollution しない', () => {
	const result = expectOk(
		csvToJson('__proto__.polluted,constructor.prototype.x\r\nyes,no', {
			...CSV_OPTS,
			inferTypes: false,
			unflattenDotKeys: true,
		}),
	);
	assert.equal(({} as Record<string, unknown>).polluted, undefined);
	assert.equal(({} as Record<string, unknown>).x, undefined);
	assert.deepEqual(JSON.parse(result.output), [
		JSON.parse(
			'{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"x":"no"}}}',
		),
	]);
});

test('csvToJson: データ行なしはエラー', () => {
	const result = expectError(csvToJson('a,b', CSV_OPTS));
	assert.match(result.error, /データ行/);
});

// ---------------------------------------------------------------------------
// detectDelimiter / inferCellValue / flatten / unflatten / buildCsvBlob
// ---------------------------------------------------------------------------

test('detectDelimiter: 出現数による判定・同数はカンマ優先・クォート内は数えない', () => {
	assert.equal(detectDelimiter('a,b,c'), ',');
	assert.equal(detectDelimiter('a\tb\tc'), '\t');
	assert.equal(detectDelimiter('a;b;c'), ';');
	assert.equal(detectDelimiter('a,b;c'), ',', '同数はカンマ優先');
	assert.equal(
		detectDelimiter('a\tb;c'),
		'\t',
		'タブとセミコロン同数はタブ優先',
	);
	assert.equal(detectDelimiter('"a,b,c"\tx\ty'), '\t', 'クォート内は数えない');
	assert.equal(detectDelimiter('"x\ty";a;b'), ';');
	assert.equal(detectDelimiter('plain'), ',', '候補なしはカンマ');
	assert.equal(detectDelimiter('a;b\nc,d,e,f'), ';', '1行目のみで判定');
});

test('inferCellValue: 型推論の規則', () => {
	assert.equal(inferCellValue('123'), 123);
	assert.equal(inferCellValue('0'), 0);
	assert.equal(inferCellValue('0.5'), 0.5);
	assert.equal(inferCellValue('-12'), -12);
	assert.equal(inferCellValue('007'), '007', '先頭ゼロは文字列保持');
	assert.equal(inferCellValue('001.23'), '001.23');
	assert.equal(inferCellValue('true'), true);
	assert.equal(inferCellValue('false'), false);
	assert.equal(inferCellValue('TRUE'), 'TRUE', '完全小文字のみboolean');
	assert.equal(inferCellValue('True'), 'True');
	assert.equal(inferCellValue(''), null, '空セルのみnull');
	assert.equal(inferCellValue('null'), 'null', '"null"は文字列のまま');
	assert.equal(
		inferCellValue('2026-06-11'),
		'2026-06-11',
		'日付は文字列のまま',
	);
});

test('inferCellValue: 安全整数範囲（±Number.MAX_SAFE_INTEGER）は文字列保持、範囲内は数値化', () => {
	assert.equal(
		inferCellValue('9007199254740993'),
		'9007199254740993',
		'安全整数上限超過は桁落ちさせず文字列保持',
	);
	assert.equal(
		inferCellValue(String(Number.MAX_SAFE_INTEGER)),
		Number.MAX_SAFE_INTEGER,
		'安全整数上限そのものは数値化',
	);
	assert.equal(
		inferCellValue(String(Number.MIN_SAFE_INTEGER)),
		Number.MIN_SAFE_INTEGER,
		'安全整数下限そのものは数値化',
	);
	assert.equal(
		inferCellValue('-9007199254740993'),
		'-9007199254740993',
		'負の安全整数下限超過も文字列保持',
	);
});

test('csvToJson: 型推論ON/OFFいずれも安全整数範囲外のIDを桁落ちさせない', () => {
	const on = expectOk(csvToJson('id,code\r\n9007199254740993,00123', CSV_OPTS));
	assert.deepEqual(JSON.parse(on.output), [
		{ id: '9007199254740993', code: '00123' },
	]);
	const off = expectOk(
		csvToJson('id,code\r\n9007199254740993,00123', {
			...CSV_OPTS,
			inferTypes: false,
		}),
	);
	assert.deepEqual(JSON.parse(off.output), [
		{ id: '9007199254740993', code: '00123' },
	]);
});

test('flattenObject / unflattenObject: ネスト+配列の往復', () => {
	const original = {
		user: { name: '太郎', address: { city: '東京' } },
		items: [{ id: 1 }, { id: 2 }],
		tags: ['a', 'b'],
		active: true,
	};
	const flat = flattenObject(original);
	assert.deepEqual(flat, {
		'user.name': '太郎',
		'user.address.city': '東京',
		'items.0.id': 1,
		'items.1.id': 2,
		'tags.0': 'a',
		'tags.1': 'b',
		active: true,
	});
	assert.deepEqual(unflattenObject(flat), original);
});

test('flattenObject / unflattenObject: __proto__ をデータキーとして扱う', () => {
	const flat = flattenObject(JSON.parse('{"__proto__":{"value":"safe"}}'));
	assert.equal(JSON.stringify(flat), '{"__proto__.value":"safe"}');

	const nested = unflattenObject({ '__proto__.polluted': 'no' });
	assert.equal(JSON.stringify(nested), '{"__proto__":{"polluted":"no"}}');
	assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('往復変換: JSON→CSV→JSON で構造が保たれる', () => {
	const original = [
		{ user: { name: '太郎', age: 30 }, tags: ['x', 'y'], active: true },
		{ user: { name: '花子', age: 25 }, tags: ['z', 'w'], active: false },
	];
	const csv = expectOk(jsonToCsv(JSON.stringify(original), JSON_OPTS));
	const back = expectOk(
		csvToJson(csv.output, { ...CSV_OPTS, unflattenDotKeys: true }),
	);
	assert.deepEqual(JSON.parse(back.output), original);
});

test('buildCsvBlob: BOM ON で先頭3バイトが EF BB BF', async () => {
	const withBom = buildCsvBlob('a,b\r\n1,2', true);
	const bytes = new Uint8Array(await withBom.arrayBuffer());
	assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
	const withoutBom = buildCsvBlob('a,b\r\n1,2', false);
	const bytes2 = new Uint8Array(await withoutBom.arrayBuffer());
	assert.notDeepEqual([...bytes2.slice(0, 3)], [0xef, 0xbb, 0xbf]);
	assert.equal(withBom.type, 'text/csv;charset=utf-8');
});

test('stripBom: 先頭BOMのみ除去', () => {
	assert.equal(stripBom('\u{FEFF}abc'), 'abc');
	assert.equal(stripBom('abc'), 'abc');
	assert.equal(stripBom(''), '');
});
