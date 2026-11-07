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

test('csvToJson: 超過列の生成キーが既存の extra_1 ヘッダーと衝突しない', () => {
	const result = expectOk(
		csvToJson('extra_1,name\r\nKEEP,Alice,OVERWRITE', CSV_OPTS),
	);
	assert.deepEqual(JSON.parse(result.output), [
		{ extra_1: 'KEEP', name: 'Alice', extra_2: 'OVERWRITE' },
	]);
});

test('csvToJson: 複数の超過列でも既存ヘッダーを飛ばして一意な extra_N を採番する', () => {
	const result = expectOk(
		csvToJson('extra_1,extra_2,name\r\nA,B,C,D,E', CSV_OPTS),
	);
	assert.deepEqual(JSON.parse(result.output), [
		{ extra_1: 'A', extra_2: 'B', name: 'C', extra_3: 'D', extra_4: 'E' },
	]);
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

test('csvToJson: 巨大な配列添字はJSONのシリアライズ前に拒否する', (t) => {
	const stringify = JSON.stringify;
	let serializedArray = false;
	// 修正前にも43億要素を走査しないよう、危険なシリアライズへの到達だけを観測する。
	t.mock.method(
		JSON,
		'stringify',
		(
			value: unknown,
			replacer?: (number | string)[] | null,
			space?: number | string,
		) => {
			if (Array.isArray(value)) {
				serializedArray = true;
				return '[]';
			}
			return stringify(value, replacer, space);
		},
	);
	for (const key of [
		'a.4294967294',
		'a.4294967294.b',
		'a.0.b.4294967294',
		'a.0004294967294',
	]) {
		const result = csvToJson(`${key}\nx`, {
			...CSV_OPTS,
			unflattenDotKeys: true,
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(
				result.error,
				'復元後の配列長が上限（100000要素）を超えます。',
			);
		}
	}
	assert.equal(serializedArray, false);
});

test('csvToJson: 復元後の配列長100000を受理し100001を拒否する', () => {
	const options = { ...CSV_OPTS, unflattenDotKeys: true };
	for (const prefix of ['a', 'a.0.b']) {
		const accepted = expectOk(csvToJson(`${prefix}.99999\nx`, options));
		const [record] = JSON.parse(accepted.output);
		const array = prefix === 'a' ? record.a : record.a[0].b;
		assert.equal(array.length, 100000);
		assert.ok(array.slice(0, -1).every((value: unknown) => value === null));
		assert.equal(array[99999], 'x');
		const rejected = expectError(csvToJson(`${prefix}.100000\nx`, options));
		assert.equal(
			rejected.error,
			'復元後の配列長が上限（100000要素）を超えます。',
		);
	}
});

test('csvToJson: 多行・多列・ネストの配列スロット合計超過をシリアライズ前に拒否する', (t) => {
	// 修正前にも巨大な出力を作らず、シリアライズへの到達を検出する。
	const stringify = t.mock.method(JSON, 'stringify', () => '[]');
	const wideHeaders = Array.from({ length: 100 }, (_, i) => `a${i}.99999`);
	for (const input of [
		`a.99999\n${'x\n'.repeat(500)}`,
		`${wideHeaders.join(',')}\n${wideHeaders.map(() => 'x').join(',')}`,
		`a.99999,b.99999\n${'x,y\n'.repeat(6)}`,
		`a.0.b.99999\n${'x\n'.repeat(10)}`,
	]) {
		const result = csvToJson(input, { ...CSV_OPTS, unflattenDotKeys: true });
		assert.ok(!result.ok);
		assert.equal(
			result.error,
			'復元後の配列スロット合計が上限（1000000要素）を超えます。',
		);
	}
	assert.equal(stringify.mock.callCount(), 0);
});

test('csvToJson: 配列スロット合計1000000を受理し、行追加・1スロット超過を拒否する', () => {
	const options = { ...CSV_OPTS, unflattenDotKeys: true };
	// 同じ配列の複数列・先頭ゼロ付き添字は、最大添字+1を一度だけ数える。
	const rows = 'first,last\n'.repeat(10);
	const accepted = expectOk(csvToJson(`a.0,a.00099999\n${rows}`, options));
	assert.equal(accepted.rowCount, 10);
	for (const record of JSON.parse(accepted.output)) {
		assert.equal(record.a.length, 100000);
		assert.equal(record.a[0], 'first');
		assert.equal(record.a[99999], 'last');
	}
	const headers = Array.from({ length: 10 }, (_, i) => `a${i}.99999`);
	const values = headers.map(() => 'x');
	const wide = expectOk(
		csvToJson(`${headers.join(',')}\n${values.join(',')}`, options),
	);
	const [record] = JSON.parse(wide.output);
	assert.equal(Object.keys(record).length, 10);
	for (const array of Object.values(record) as unknown[][]) {
		assert.equal(array.length, 100000);
		assert.equal(array[99999], 'x');
	}
	for (const input of [
		`a.99999\n${'x\n'.repeat(11)}`,
		`${headers.join(',')},b.0\n${values.join(',')},y`,
	]) {
		assert.equal(
			expectError(csvToJson(input, options)).error,
			'復元後の配列スロット合計が上限（1000000要素）を超えます。',
		);
	}
});

const deepKey = (depth: number, leaf: string): string =>
	[...Array.from({ length: depth - 1 }, (_, i) => `k${i}`), leaf].join('.');

test('csvToJson: 深いネストの配列ヘッダー（#659）をシリアライズ前に拒否する', (t) => {
	// 修正前は予算内として JSON.stringify に到達し、約2億文字の出力を作ろうとしていた。
	const stringify = t.mock.method(JSON, 'stringify', () => '[]');
	const header = `a${'.0'.repeat(1000)}.99999`;
	const result = csvToJson(`${header}\nx`, {
		...CSV_OPTS,
		unflattenDotKeys: true,
	});
	assert.ok(!result.ok);
	assert.equal(
		result.error,
		'列名のドット区切りの階層が上限（64段）を超えます。',
	);
	assert.equal(stringify.mock.callCount(), 0);
});

test('csvToJson: 列名の階層64段を受理し65段を拒否する（ドット記法の復元時のみ）', () => {
	const options = { ...CSV_OPTS, unflattenDotKeys: true };
	const accepted = expectOk(csvToJson(`${deepKey(64, 'leaf')}\nx`, options));
	let node = JSON.parse(accepted.output)[0];
	for (let i = 0; i < 63; i++) node = node[`k${i}`];
	assert.deepEqual(node, { leaf: 'x' });

	const tooDeep = deepKey(65, 'leaf');
	assert.equal(
		expectError(csvToJson(`ok,${tooDeep}\nx,y`, options)).error,
		'列名のドット区切りの階層が上限（64段）を超えます。',
	);
	// 復元しない場合は列名をそのままキーにするため階層を数えない。
	const flat = expectOk(csvToJson(`${tooDeep}\nx`, CSV_OPTS));
	assert.deepEqual(JSON.parse(flat.output), [{ [tooDeep]: 'x' }]);
});

test('csvToJson: 配列要素のインデント見積もり2000万文字を受理し超過を拒否する', () => {
	const options = { ...CSV_OPTS, unflattenDotKeys: true };
	const indentError =
		'復元後の配列のネストが深く、出力のインデント見積もりが上限（20000000文字）を超えます。';
	// 深さ60の配列（要素の字下げ124文字）×1000要素 = 1行あたり124000文字。
	const deep = deepKey(61, '999');
	const accepted = expectOk(
		csvToJson(`${deep}\n${'x\n'.repeat(161)}`, options),
	);
	assert.equal(accepted.rowCount, 161);
	assert.equal(
		expectError(csvToJson(`${deep}\n${'x\n'.repeat(162)}`, options)).error,
		indentError,
	);
	// 深さ9の配列（字下げ22文字）×100000要素は、スロット合計の上限（10行）以内でも拒否する。
	const nine = deepKey(10, '99999');
	expectOk(csvToJson(`${nine}\n${'x\n'.repeat(9)}`, options));
	assert.equal(
		expectError(csvToJson(`${nine}\n${'x\n'.repeat(10)}`, options)).error,
		indentError,
	);
	// 深さ8（字下げ20文字）なら、スロット合計の上限ちょうどまで受理する（既存の上限が先に効く）。
	const eight = deepKey(9, '99999');
	expectOk(csvToJson(`${eight}\n${'x\n'.repeat(10)}`, options));
	assert.equal(
		expectError(csvToJson(`${eight}\n${'x\n'.repeat(11)}`, options)).error,
		'復元後の配列スロット合計が上限（1000000要素）を超えます。',
	);
});

test('csvToJson: 形状判定はキーの上書き・列挙順・重複ヘッダーに従う', () => {
	const options = { ...CSV_OPTS, unflattenDotKeys: true };
	for (const input of ['a.99999,a\nx,y', 'a.0.b.99999,a.0\nx,y']) {
		const rows = `${input.split('\n')[0]}\n${'x,y\n'.repeat(11)}`;
		const result = expectOk(csvToJson(rows, options));
		assert.deepEqual(
			JSON.parse(result.output),
			Array.from({ length: 11 }, () =>
				input.startsWith('a.0') ? { a: ['y'] } : { a: 'y' },
			),
		);
	}
	// 整数キー「1」は先に列挙されるため、後続のドット記法で配列が作られる。
	assert.equal(
		expectError(csvToJson(`1.a.99999,1\n${'x,y\n'.repeat(11)}`, options)).error,
		'復元後の配列スロット合計が上限（1000000要素）を超えます。',
	);
	const duplicate = expectOk(csvToJson('a.2,a.2\nx,y', options));
	assert.deepEqual(JSON.parse(duplicate.output), [{ a: [null, null, 'x'] }]);
	const nested = expectOk(csvToJson('a.2.b.3,c.1\nx,y', options));
	assert.deepEqual(JSON.parse(nested.output), [
		{ a: [null, null, { b: [null, null, null, 'x'] }], c: [null, 'y'] },
	]);
});

test('csvToJson: 複数行・複数配列の合計出力が1MiBを超えても成功する', () => {
	for (const input of [
		`a.1000\n${Array(100).fill('x').join('\n')}`,
		'a.50000,b.50000\nx,y',
	]) {
		const result = expectOk(
			csvToJson(input, { ...CSV_OPTS, unflattenDotKeys: true }),
		);
		assert.ok(Buffer.byteLength(result.output) > 1024 * 1024);
		const records = JSON.parse(result.output);
		assert.equal(result.rowCount, input.split('\n').length - 1);
		for (const record of records) {
			assert.equal(record.a.at(-1), 'x');
			assert.equal(record.a.length, record.b ? 50001 : 1001);
			if (record.b) {
				assert.equal(record.b.length, 50001);
				assert.equal(record.b.at(-1), 'y');
			}
		}
	}
});

test('csvToJson: 1万行×3列の正常なCSVは復元ONでも出力1MiB超を許容する', () => {
	const records = Array.from({ length: 10000 }, (_, id) => ({
		id,
		name: `利用者${id}`,
		note: '正常な大きいCSVの変換確認'.repeat(5),
	}));
	const rows = records
		.map(({ id, name, note }) => `${id},${name},${note}`)
		.join('\n');
	for (const headers of ['id,name,note', 'id,user.name,items.0']) {
		const result = expectOk(
			csvToJson(`${headers}\n${rows}`, {
				...CSV_OPTS,
				unflattenDotKeys: true,
			}),
		);
		assert.equal(result.rowCount, 10000);
		assert.ok(Buffer.byteLength(result.output) > 1024 * 1024);
		assert.deepEqual(
			JSON.parse(result.output),
			headers === 'id,name,note'
				? records
				: records.map(({ id, name, note }) => ({
						id,
						user: { name },
						items: [note],
					})),
		);
	}
});

test('csvToJson: CSVの実データ行数には復元配列長の上限を適用しない', () => {
	const result = expectOk(
		csvToJson(`a\n${'x\n'.repeat(100001)}`, {
			...CSV_OPTS,
			unflattenDotKeys: true,
		}),
	);
	assert.equal(result.rowCount, 100001);
	const records = JSON.parse(result.output);
	assert.equal(records.length, 100001);
	assert.deepEqual(records[0], { a: 'x' });
	assert.deepEqual(records.at(-1), { a: 'x' });
});

test('csvToJson: セル値により復元後UTF-8 1MiBを超えても成功する', () => {
	const limit = 1024 * 1024;
	const overhead = Buffer.byteLength(JSON.stringify([{ a: [''] }], null, 2));
	const value = `あ${'x'.repeat(limit - overhead - 3)}`;
	const options = { ...CSV_OPTS, unflattenDotKeys: true };
	const accepted = expectOk(csvToJson(`a.0\n${value}`, options));
	assert.equal(Buffer.byteLength(accepted.output), limit);
	const over = expectOk(csvToJson(`a.0\n${value}x`, options));
	assert.equal(Buffer.byteLength(over.output), limit + 1);
	assert.deepEqual(JSON.parse(over.output), [{ a: [`${value}x`] }]);
});

test('csvToJson: 復元OFF・オブジェクトの数値キー・小さな疎配列は維持する', () => {
	const flat = expectOk(csvToJson('a.4294967294\nx', CSV_OPTS));
	assert.deepEqual(JSON.parse(flat.output), [{ 'a.4294967294': 'x' }]);
	const object = expectOk(
		csvToJson('a.b,a.4294967294\nx,y', {
			...CSV_OPTS,
			unflattenDotKeys: true,
		}),
	);
	assert.deepEqual(JSON.parse(object.output), [
		{ a: { b: 'x', 4294967294: 'y' } },
	]);
	const sparse = expectOk(
		csvToJson('a.2\nx', {
			...CSV_OPTS,
			unflattenDotKeys: true,
		}),
	);
	assert.deepEqual(JSON.parse(sparse.output), [{ a: [null, null, 'x'] }]);
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
