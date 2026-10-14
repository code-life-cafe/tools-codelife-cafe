import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	csvToJsonMcpTool,
	jsonToCsvMcpTool,
} from '../../src/lib/tools/json-csv.mcp.ts';
import { csvToJson, jsonToCsv } from '../../src/lib/tools/json-csv.ts';
import { generateWebMcpDescriptor } from '../../src/lib/webmcp/descriptor-generator.ts';
import { mcpToolDefinitions } from '../../src/lib/webmcp/registry.ts';

const toCsv = generateWebMcpDescriptor(jsonToCsvMcpTool);
const toJson = generateWebMcpDescriptor(csvToJsonMcpTool);

const MAX_OUTPUT_BYTES = 1024 * 1024;
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

async function okValue(
	tool: typeof toCsv | typeof toJson,
	input: unknown,
): Promise<{ output: string; rowCount: number }> {
	const result = await tool.run(input);
	assert.ok(result.ok, result.ok ? '' : result.error);
	return result.value as { output: string; rowCount: number };
}

async function errorOf(
	tool: typeof toCsv | typeof toJson,
	input: unknown,
): Promise<string> {
	const result = await tool.run(input);
	assert.equal(result.ok, false);
	return result.ok ? '' : result.error;
}

function nestedArrays(depth: number): string {
	return `${'['.repeat(depth)}${']'.repeat(depth)}`;
}

function nestedObjects(depth: number): string {
	return `${'{"a":'.repeat(depth - 1)}{"a":1}${'}'.repeat(depth - 1)}`;
}

// ---------------------------------------------------------------------------
// schema / registry 整合
// ---------------------------------------------------------------------------

test('registry: json_to_csv / csv_to_json が登録されている', () => {
	const names = mcpToolDefinitions.map((def) => def.name);
	assert.ok(names.includes('json_to_csv'));
	assert.ok(names.includes('csv_to_json'));
});

test('schema: json_to_csv の入力・出力スキーマが計画どおり', () => {
	const input = toCsv.inputSchema as {
		properties: Record<string, Record<string, unknown>>;
		required: string[];
	};
	assert.deepEqual(input.required, ['text']);
	assert.equal(input.properties.text.maxLength, 100_000);
	assert.deepEqual(input.properties.delimiter.enum, [
		'comma',
		'tab',
		'semicolon',
	]);
	assert.equal(input.properties.delimiter.default, 'comma');
	assert.equal(input.properties.includeHeader.default, true);
	assert.equal(input.properties.flattenNested.default, false);
	assert.deepEqual(input.properties.newline.enum, ['crlf', 'lf']);
	assert.equal(input.properties.newline.default, 'crlf');
	const output = toCsv.outputSchema as {
		properties: Record<string, { type: string }>;
		required: string[];
	};
	assert.deepEqual(output.required, ['output', 'rowCount']);
	assert.equal(output.properties.output.type, 'string');
	assert.equal(output.properties.rowCount.type, 'number');
	assert.equal(toCsv.annotations?.readOnlyHint, true);
});

test('schema: csv_to_json の入力・出力スキーマが計画どおり', () => {
	const input = toJson.inputSchema as {
		properties: Record<string, Record<string, unknown>>;
		required: string[];
	};
	assert.deepEqual(input.required, ['text']);
	assert.equal(input.properties.text.maxLength, 100_000);
	assert.deepEqual(input.properties.delimiter.enum, [
		'auto',
		'comma',
		'tab',
		'semicolon',
	]);
	assert.equal(input.properties.delimiter.default, 'auto');
	assert.equal(input.properties.hasHeader.default, true);
	assert.equal(input.properties.inferTypes.default, false);
	assert.equal(input.properties.unflattenDotKeys.default, false);
	const output = toJson.outputSchema as { required: string[] };
	assert.deepEqual(output.required, ['output', 'rowCount']);
});

test('schema: 実行時の検証がschemaと一致する（型・enum・必須）', async () => {
	assert.match(await errorOf(toCsv, {}), /text/);
	assert.match(await errorOf(toCsv, { text: 1 }), /text/);
	assert.match(
		await errorOf(toCsv, { text: '[]', delimiter: 'pipe' }),
		/delimiter/,
	);
	assert.match(await errorOf(toCsv, { text: '[]', newline: 'cr' }), /newline/);
	assert.match(
		await errorOf(toCsv, { text: '[]', includeHeader: 'yes' }),
		/includeHeader/,
	);
	assert.match(
		await errorOf(toCsv, { text: '[]', flattenNested: 1 }),
		/flattenNested/,
	);
	assert.match(await errorOf(toJson, {}), /text/);
	assert.match(
		await errorOf(toJson, { text: 'a', delimiter: ',' }),
		/delimiter/,
	);
	assert.match(
		await errorOf(toJson, { text: 'a', hasHeader: 'true' }),
		/hasHeader/,
	);
	assert.match(
		await errorOf(toJson, { text: 'a', inferTypes: null }),
		/inferTypes/,
	);
	assert.match(
		await errorOf(toJson, { text: 'a', unflattenDotKeys: 0 }),
		/unflattenDotKeys/,
	);
	assert.match(await errorOf(toJson, 'text'), /object|入力値/);
});

// ---------------------------------------------------------------------------
// json_to_csv 正常系・全オプション
// ---------------------------------------------------------------------------

test('json_to_csv: 既定値（comma・ヘッダーあり・展開なし・CRLF）', async () => {
	const text = '[{"名前":"山田","age":30},{"名前":"鈴木","age":25}]';
	const value = await okValue(toCsv, { text });
	assert.equal(value.output, '名前,age\r\n山田,30\r\n鈴木,25');
	assert.equal(value.rowCount, 2);
	const direct = jsonToCsv(text, {
		delimiter: ',',
		includeHeader: true,
		flattenNested: false,
		newline: '\r\n',
	});
	assert.ok(direct.ok);
	assert.equal(value.output, direct.output);
});

test('json_to_csv: delimiter 全enum', async () => {
	const text = '[{"a":1,"b":2}]';
	assert.equal(
		(await okValue(toCsv, { text, delimiter: 'comma' })).output,
		'a,b\r\n1,2',
	);
	assert.equal(
		(await okValue(toCsv, { text, delimiter: 'tab' })).output,
		'a\tb\r\n1\t2',
	);
	assert.equal(
		(await okValue(toCsv, { text, delimiter: 'semicolon' })).output,
		'a;b\r\n1;2',
	);
});

test('json_to_csv: includeHeader=false / newline=lf', async () => {
	const text = '[{"a":1,"b":2},{"a":3,"b":4}]';
	assert.equal(
		(await okValue(toCsv, { text, includeHeader: false, newline: 'lf' }))
			.output,
		'1,2\n3,4',
	);
});

test('json_to_csv: flattenNested の true/false', async () => {
	const text = '[{"u":{"n":"太郎"},"t":["a","b"]}]';
	const flat = await okValue(toCsv, { text, flattenNested: true });
	assert.equal(flat.output, 'u.n,t.0,t.1\r\n太郎,a,b');
	const raw = await okValue(toCsv, { text, flattenNested: false });
	assert.equal(raw.output, 'u,t\r\n"{""n"":""太郎""}","[""a"",""b""]"');
});

test('json_to_csv: 単一オブジェクトは1行、引用符・引用符内改行・BOM', async () => {
	const value = await okValue(toCsv, {
		text: '﻿{"a":"x,\\"y\\"","b":"l1\\nl2"}',
	});
	assert.equal(value.output, 'a,b\r\n"x,""y""","l1\nl2"');
	assert.equal(value.rowCount, 1);
});

test('json_to_csv: 安全整数外の整数は桁を保持する', async () => {
	const value = await okValue(toCsv, {
		text: '[{"id":12345678901234567890,"n":9007199254740991}]',
	});
	assert.equal(value.output, 'id,n\r\n12345678901234567890,9007199254740991');
});

test('json_to_csv: __proto__ / constructor キーをプロトタイプへ作用させない', async () => {
	const value = await okValue(toCsv, {
		text: '[{"__proto__":{"polluted":true},"constructor":"c","a":1}]',
		flattenNested: true,
	});
	assert.equal(value.output, '__proto__.polluted,constructor,a\r\ntrue,c,1');
	assert.equal(({} as Record<string, unknown>).polluted, undefined);
	const raw = await okValue(toCsv, {
		text: '[{"__proto__":"x","a":1}]',
	});
	assert.equal(raw.output, '__proto__,a\r\nx,1');
	assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

// ---------------------------------------------------------------------------
// json_to_csv 異常系・境界
// ---------------------------------------------------------------------------

test('json_to_csv: 空入力・不正JSON・非対応構造は既存の日本語エラー、原文を含まない', async () => {
	assert.equal(await errorOf(toCsv, { text: '' }), 'JSONを入力してください。');
	assert.equal(
		await errorOf(toCsv, { text: '  \n' }),
		'JSONを入力してください。',
	);
	const secret = 'SECRET-TOKEN-12345';
	const syntax = await errorOf(toCsv, { text: `{"k":"${secret}"` });
	assert.match(syntax, /JSONの構文エラー/);
	assert.ok(!syntax.includes(secret));
	assert.match(await errorOf(toCsv, { text: '[]' }), /空の配列/);
	assert.match(await errorOf(toCsv, { text: '[1,2]' }), /オブジェクトの配列/);
	assert.match(await errorOf(toCsv, { text: `"${secret}"` }), /オブジェクト/);
	assert.ok(!(await errorOf(toCsv, { text: `"${secret}"` })).includes(secret));
});

test('json_to_csv: 入力は10万コードポイントちょうどまで、超過は拒否', async () => {
	// "[{"a":"…"}]" の固定部 9 文字 + 絵文字(1コードポイント=2UTF-16単位)で充填
	const fixed = '[{"a":""}]'.length;
	const filler = '😀'.repeat(100_000 - fixed);
	const atLimit = `[{"a":"${filler}"}]`;
	assert.equal([...atLimit].length, 100_000);
	assert.ok(
		atLimit.length > 100_000,
		'UTF-16長では超えるがコードポイントでは上限内',
	);
	const value = await okValue(toCsv, { text: atLimit });
	assert.equal(value.rowCount, 1);
	const over = `${atLimit} `;
	assert.equal([...over].length, 100_001);
	// schemaのmaxLength検証が先に拒否し、ハンドラ直呼びでも同じ上限で拒否する
	assert.match(await errorOf(toCsv, { text: over }), /上限を超えています/);
	await assert.rejects(
		async () =>
			jsonToCsvMcpTool.handler({
				text: over,
				delimiter: 'comma',
				includeHeader: true,
				flattenNested: false,
				newline: 'crlf',
			}),
		/入力の上限は100000文字です。/,
	);
});

test('json_to_csv: ネスト50段は許可、51段は変換前に拒否（配列・オブジェクト）', async () => {
	assert.ok((await toCsv.run({ text: nestedObjects(50) })).ok);
	assert.ok(
		(await toCsv.run({ text: `[${nestedObjects(49)}]`, flattenNested: true }))
			.ok,
	);
	const depthMessage = 'ネストの深さが上限（50段）を超えています。';
	assert.equal(await errorOf(toCsv, { text: nestedObjects(51) }), depthMessage);
	assert.equal(
		await errorOf(toCsv, { text: `[${nestedObjects(50)}]` }),
		depthMessage,
	);
	assert.equal(await errorOf(toCsv, { text: nestedArrays(51) }), depthMessage);
	assert.equal(
		await errorOf(toCsv, { text: '['.repeat(60_000) }),
		depthMessage,
	);
});

test('json_to_csv: 深さ判定は文字列内の括弦とエスケープを数えない', async () => {
	const brackets = '[{'.repeat(80);
	const text = `[{"a":"${brackets}","b":"quote\\" ${brackets}\\\\","c":{"d":1}}]`;
	const value = await okValue(toCsv, { text, flattenNested: true });
	assert.equal(value.rowCount, 1);
	// 文字列終端の直前がバックスラッシュ2個（エスケープ済み）でも文字列は閉じる
	const closed = '[{"a":"\\\\","b":[1]}]';
	assert.ok((await toCsv.run({ text: closed })).ok);
});

test('json_to_csv: 出力UTF-8 1MiBちょうどは成功、1バイト超過は拒否', async () => {
	// 疎な行 N 行（行 i は列 k_i のみ）。includeHeader=false/lf で出力長を厳密に調整する
	const n = 1000;
	const cellOverhead = (n - 1) * n + (n - 1); // 区切り + 改行（セル本体除く）
	const rows = Array.from({ length: n }, (_, i) => ({ [`k${i}`]: 'x' }));
	const baseBytes = cellOverhead + n; // 各セル 'x' 1バイト
	const pad = MAX_OUTPUT_BYTES - baseBytes;
	rows[0] = { k0: 'x'.repeat(1 + pad) };
	const exact = JSON.stringify(rows);
	assert.ok([...exact].length <= 100_000);
	const ok = await okValue(toCsv, {
		text: exact,
		includeHeader: false,
		newline: 'lf',
	});
	assert.equal(bytes(ok.output), MAX_OUTPUT_BYTES);
	rows[0] = { k0: 'x'.repeat(2 + pad) };
	const over = await errorOf(toCsv, {
		text: JSON.stringify(rows),
		includeHeader: false,
		newline: 'lf',
	});
	assert.equal(over, '変換結果が上限（UTF-8で1MiB）を超えます。');
});

test('json_to_csv: マルチバイトは文字数でなくUTF-8バイトで出力上限を判定する', async () => {
	// 3バイト文字 'あ' を 349526 個 = 1048578 バイト超だが、入力上限があるため複数セルに分けて検証
	const cell = 'あ'.repeat(30_000); // 90,000 bytes
	const text = JSON.stringify(
		Array.from({ length: 3 }, (_, i) => ({ [`c${i}`]: cell })),
	);
	assert.ok([...text].length <= 100_000);
	const wide = await okValue(toCsv, { text, includeHeader: false });
	assert.ok(bytes(wide.output) > [...wide.output].length);
});

test('json_to_csv: 行×列の爆発的な出力は生成前に拒否する', async () => {
	const rows = Array.from({ length: 1500 }, (_, i) => ({ [`k${i}`]: 1 }));
	const text = JSON.stringify(rows);
	assert.ok([...text].length <= 100_000);
	assert.equal(
		await errorOf(toCsv, { text }),
		'変換結果が上限（UTF-8で1MiB）を超えます。',
	);
	assert.equal(
		await errorOf(toCsv, { text, flattenNested: true }),
		'変換結果が上限（UTF-8で1MiB）を超えます。',
	);
});

// ---------------------------------------------------------------------------
// csv_to_json 正常系・全オプション
// ---------------------------------------------------------------------------

test('csv_to_json: 既定値は文字列と先頭ゼロを保持（型推論なし）', async () => {
	const text = 'id,code,flag,empty\n1,007,true,\n2,0,false,x';
	const value = await okValue(toJson, { text });
	assert.deepEqual(JSON.parse(value.output), [
		{ id: '1', code: '007', flag: 'true', empty: '' },
		{ id: '2', code: '0', flag: 'false', empty: 'x' },
	]);
	assert.equal(value.rowCount, 2);
	const direct = csvToJson(text, {
		delimiter: 'auto',
		hasHeader: true,
		inferTypes: false,
		unflattenDotKeys: false,
	});
	assert.ok(direct.ok);
	assert.equal(value.output, direct.output);
});

test('csv_to_json: inferTypes は先頭ゼロ・安全整数外を文字列のまま保持', async () => {
	const text = 'a,b,c,d,e,f\n1,007,12345678901234567890,true,,1.5';
	const value = await okValue(toJson, { text, inferTypes: true });
	assert.deepEqual(JSON.parse(value.output), [
		{ a: 1, b: '007', c: '12345678901234567890', d: true, e: null, f: 1.5 },
	]);
});

test('csv_to_json: delimiter 全enumとauto判定', async () => {
	const expected = [{ a: '1', b: '2' }];
	for (const [delimiter, text] of [
		['comma', 'a,b\n1,2'],
		['tab', 'a\tb\n1\t2'],
		['semicolon', 'a;b\n1;2'],
		['auto', 'a;b\n1;2'],
		['auto', 'a\tb\n1\t2'],
	] as const) {
		const value = await okValue(toJson, { text, delimiter });
		assert.deepEqual(JSON.parse(value.output), expected, `${delimiter}`);
	}
});

test('csv_to_json: hasHeader=false は column_N を採番', async () => {
	const value = await okValue(toJson, { text: 'a,b\nc,d', hasHeader: false });
	assert.deepEqual(JSON.parse(value.output), [
		{ column_1: 'a', column_2: 'b' },
		{ column_1: 'c', column_2: 'd' },
	]);
	assert.equal(value.rowCount, 2);
});

test('csv_to_json: unflattenDotKeys でネスト・配列を復元', async () => {
	const text = 'u.n,t.0,t.1\n太郎,a,b';
	const flat = await okValue(toJson, { text });
	assert.deepEqual(JSON.parse(flat.output), [
		{ 'u.n': '太郎', 't.0': 'a', 't.1': 'b' },
	]);
	const nested = await okValue(toJson, { text, unflattenDotKeys: true });
	assert.deepEqual(JSON.parse(nested.output), [
		{ u: { n: '太郎' }, t: ['a', 'b'] },
	]);
	const direct = csvToJson(text, {
		delimiter: 'auto',
		hasHeader: true,
		inferTypes: false,
		unflattenDotKeys: true,
	});
	assert.ok(direct.ok);
	assert.equal(nested.output, direct.output);
});

test('csv_to_json: BOM・引用符内の改行/区切り/二重引用符・CRLF', async () => {
	const text = '﻿name,memo\r\n"山田","a,b\r\nline2 ""q"""\r\n鈴木,x';
	const value = await okValue(toJson, { text });
	// 引用符内の改行は既存仕様どおり原文のまま保持される
	assert.deepEqual(JSON.parse(value.output), [
		{ name: '山田', memo: 'a,b\r\nline2 "q"' },
		{ name: '鈴木', memo: 'x' },
	]);
});

test('csv_to_json: __proto__ ヘッダーをプロトタイプへ作用させない', async () => {
	const flat = await okValue(toJson, { text: '__proto__,a\nx,1' });
	assert.deepEqual(Object.keys(JSON.parse(flat.output)[0]), ['__proto__', 'a']);
	const nested = await okValue(toJson, {
		text: '__proto__.polluted,constructor.prototype.p,a\n1,2,3',
		unflattenDotKeys: true,
	});
	const parsed = JSON.parse(nested.output);
	assert.equal(Object.getPrototypeOf(parsed[0]), Object.prototype);
	assert.equal(({} as Record<string, unknown>).polluted, undefined);
	assert.equal(({} as Record<string, unknown>).p, undefined);
	assert.equal(Object.hasOwn(parsed[0], '__proto__'), true);
});

// ---------------------------------------------------------------------------
// csv_to_json 異常系・境界
// ---------------------------------------------------------------------------

test('csv_to_json: 空入力・不正CSV・データ行なしは既存エラー、原文を含まない', async () => {
	assert.equal(await errorOf(toJson, { text: '' }), 'CSVを入力してください。');
	assert.equal(
		await errorOf(toJson, { text: '\n  ' }),
		'CSVを入力してください。',
	);
	const secret = 'SECRET-TOKEN-12345';
	const unclosed = await errorOf(toJson, { text: `a,b\n"${secret},2` });
	assert.match(unclosed, /引用符（"）が閉じられていません/);
	assert.ok(!unclosed.includes(secret));
	const trailing = await errorOf(toJson, { text: `a,b\n"x"${secret},2` });
	assert.match(trailing, /引用符で囲まれたセルの後に不正な文字/);
	assert.ok(!trailing.includes(secret));
	assert.equal(
		await errorOf(toJson, { text: 'a,b' }),
		'変換できるデータ行がありません。',
	);
});

test('csv_to_json: 入力は10万コードポイントちょうどまで、超過は拒否', async () => {
	const prefix = 'a\n';
	const atLimit = `${prefix}${'😀'.repeat(100_000 - prefix.length)}`;
	assert.equal([...atLimit].length, 100_000);
	const value = await okValue(toJson, { text: atLimit });
	assert.equal(value.rowCount, 1);
	assert.match(
		await errorOf(toJson, { text: `${atLimit}😀` }),
		/上限を超えています/,
	);
	await assert.rejects(
		async () =>
			csvToJsonMcpTool.handler({
				text: `${atLimit}😀`,
				delimiter: 'auto',
				hasHeader: true,
				inferTypes: false,
				unflattenDotKeys: false,
			}),
		/入力の上限は100000文字です。/,
	);
});

test('csv_to_json: unflattenDotKeys のネストは50段まで、51段は拒否', async () => {
	const key = (n: number) => Array.from({ length: n }, () => 'k').join('.');
	const ok = await okValue(toJson, {
		text: `${key(50)}\n1`,
		unflattenDotKeys: true,
	});
	let depth = 0;
	let cursor: unknown = JSON.parse(ok.output)[0];
	while (typeof cursor === 'object' && cursor !== null) {
		depth++;
		cursor = (cursor as Record<string, unknown>).k;
	}
	assert.equal(depth, 50);
	assert.equal(
		await errorOf(toJson, { text: `${key(51)}\n1`, unflattenDotKeys: true }),
		'ネストの深さが上限（50段）を超えています。',
	);
	// 展開しなければドットを含む実キーとして許容される
	assert.ok((await toJson.run({ text: `${key(51)}\n1` })).ok);
	const arrayKey = Array.from({ length: 51 }, () => '0').join('.');
	assert.equal(
		await errorOf(toJson, { text: `${arrayKey}\n1`, unflattenDotKeys: true }),
		'ネストの深さが上限（50段）を超えています。',
	);
});

const INDEX_MESSAGE =
	'ドット記法キーの配列インデックスが大きく、展開結果が上限を超えるため変換できません。';
const OUTPUT_MESSAGE = '変換結果が上限（UTF-8で1MiB）を超えます。';

// 中間オブジェクトのプロパティ生成（既存実装は setOwnValue = defineProperty で作る）回数を数える
async function countPropertyDefinitions(run: () => Promise<unknown>) {
	const original = Object.defineProperty;
	let count = 0;
	Object.defineProperty = ((...args: Parameters<typeof original>) => {
		count++;
		return original(...args);
	}) as typeof Object.defineProperty;
	try {
		await run();
	} finally {
		Object.defineProperty = original;
	}
	return count;
}

test('csv_to_json: 巨大な配列インデックスによる疎配列の膨張を拒否', async () => {
	assert.equal(
		await errorOf(toJson, { text: 'a.1000000000\n1', unflattenDotKeys: true }),
		INDEX_MESSAGE,
	);
	assert.equal(
		await errorOf(toJson, { text: 'a.4294967294\n1', unflattenDotKeys: true }),
		INDEX_MESSAGE,
	);
	// 配列の添字として実在しない値（2^32-1以上・Infinity）は要素にならず、出力は小さいまま
	for (const key of ['a.4294967295', `a.${'9'.repeat(400)}`]) {
		const hidden = await okValue(toJson, {
			text: `${key}\n1`,
			unflattenDotKeys: true,
		});
		assert.deepEqual(JSON.parse(hidden.output), [{ a: [] }]);
	}
	// 添字が小さくても行数を掛けた要素数が予算を超えれば拒否
	const manyRows = `a.100000\n${'x\n'.repeat(5)}`;
	assert.equal(
		await errorOf(toJson, { text: manyRows, unflattenDotKeys: true }),
		INDEX_MESSAGE,
	);
	// 展開しない場合は数値キーも通常のキー
	assert.ok((await toJson.run({ text: 'a.1000000000\n1' })).ok);
});

test('csv_to_json: 数値のオブジェクトキーと小型の配列添字は展開で受け入れる', async () => {
	const year = await okValue(toJson, {
		text: '2026.value\nx',
		unflattenDotKeys: true,
	});
	assert.deepEqual(JSON.parse(year.output), [{ '2026': { value: 'x' } }]);
	const direct = csvToJson('2026.value\nx', {
		delimiter: 'auto',
		hasHeader: true,
		inferTypes: false,
		unflattenDotKeys: true,
	});
	assert.ok(direct.ok);
	assert.equal(year.output, direct.output);
	const items = await okValue(toJson, {
		text: 'items.9.name,items.0.name\nz,a',
		unflattenDotKeys: true,
	});
	const list = JSON.parse(items.output)[0].items;
	assert.equal(list.length, 10);
	assert.equal(list[9].name, 'z');
	assert.equal(list[0].name, 'a');
	// 配列の中の数値セグメントは既存仕様どおり配列添字（疎配列）になるが、予算内なら受け入れる
	const nested = await okValue(toJson, {
		text: 'a.0.5,a.1.x\n1,2',
		unflattenDotKeys: true,
	});
	const a = JSON.parse(nested.output)[0].a;
	assert.equal(a[0].length, 6);
	assert.equal(a[0][5], '1');
	assert.deepEqual(a[1], { x: '2' });
});

test('csv_to_json: 巨大な行×列は中間オブジェクトを作る前に拒否（全モード）', async () => {
	const header = Array.from({ length: 300 }, (_, i) => `c${i}`).join(',');
	const body = Array.from({ length: 600 }, () => 'x').join('\n');
	const text = `${header}\n${body}`;
	assert.ok([...text].length < 5000);
	for (const options of [
		{},
		{ inferTypes: true },
		{ unflattenDotKeys: true },
		{ delimiter: 'comma' },
		{ hasHeader: false },
	]) {
		let error = '';
		const defined = await countPropertyDefinitions(async () => {
			error = await errorOf(toJson, { text, ...options });
		});
		assert.equal(error, OUTPUT_MESSAGE, JSON.stringify(options));
		assert.equal(defined, 0, '中間オブジェクトを生成しない');
	}
	// 予算内の広い表は従来どおり変換できる
	const narrow = Array.from({ length: 50 }, (_, i) => `c${i}`).join(',');
	const ok = await okValue(toJson, { text: `${narrow}\nx\nx` });
	assert.equal(ok.rowCount, 2);
});

test('csv_to_json: 長いヘッダーの反復による巨大な出力は変換前に拒否（全モード）', async () => {
	const longKey = 'k'.repeat(3000);
	const rows = 'x\n'.repeat(400);
	const text = `${longKey}\n${rows}`;
	assert.ok([...text].length < 4000);
	for (const options of [
		{},
		{ inferTypes: true },
		{ unflattenDotKeys: true },
		{ delimiter: 'comma' },
	]) {
		let error = '';
		const defined = await countPropertyDefinitions(async () => {
			error = await errorOf(toJson, { text, ...options });
		});
		assert.equal(error, OUTPUT_MESSAGE, JSON.stringify(options));
		assert.equal(defined, 0, '中間オブジェクトを生成しない');
	}
	// 10万文字未満の入力で3億バイト級になる組み合わせ
	const huge = `${'k'.repeat(30_000)}\n${'x\n'.repeat(10_000)}`;
	assert.ok([...huge].length < 100_000);
	let hugeError = '';
	const hugeDefined = await countPropertyDefinitions(async () => {
		hugeError = await errorOf(toJson, { text: huge });
	});
	assert.equal(hugeError, OUTPUT_MESSAGE);
	assert.equal(hugeDefined, 0);
	// 重複ヘッダー（_2 の別キーになる）の反復
	const duplicated = `${longKey},${longKey}\n${'x,y\n'.repeat(200)}`;
	assert.equal(await errorOf(toJson, { text: duplicated }), OUTPUT_MESSAGE);
	// マルチバイトはUTF-8バイト数で評価する
	const multibyte = `${'あ'.repeat(1000)}\n${'x\n'.repeat(400)}`;
	assert.equal(await errorOf(toJson, { text: multibyte }), OUTPUT_MESSAGE);
	// 展開時のネストしたキーの長い区間
	const nestedKey = `a.${longKey}\n${rows}`;
	assert.equal(
		await errorOf(toJson, { text: nestedKey, unflattenDotKeys: true }),
		OUTPUT_MESSAGE,
	);
	// 予算内の長めのヘッダーは変換できる
	const ok = await okValue(toJson, { text: `${'k'.repeat(500)}\nx\nx` });
	assert.equal(ok.rowCount, 2);
});

test('csv_to_json: ヘッダーより列が多い行（extra_N）は拒否せず既存結果と一致', async () => {
	const text = 'a,b\n1,2,3,4\n5';
	const value = await okValue(toJson, { text });
	const direct = csvToJson(text, {
		delimiter: 'auto',
		hasHeader: true,
		inferTypes: false,
		unflattenDotKeys: false,
	});
	assert.ok(direct.ok);
	assert.equal(value.output, direct.output);
	assert.deepEqual(Object.keys(JSON.parse(value.output)[0]), [
		'a',
		'b',
		'extra_1',
		'extra_2',
	]);
});

test('csv_to_json: 既存のobject配下の数値キーは配列添字として数えない', async () => {
	const accepted: [string, string][] = [
		['a.x,a.1000000000.b', '1,2'],
		['a.b,a.1000000000', '1,2'],
		['a.x.y,a.x.4294967295', '1,2'],
		['a.0,a.x', '1,2'],
		['2026.value,2026.100000000.v', '1,2'],
		['__proto__.a,constructor.prototype.b', '1,2'],
	];
	for (const [header, row] of accepted) {
		const text = `${header}\n${row}`;
		const value = await okValue(toJson, { text, unflattenDotKeys: true });
		const direct = csvToJson(text, {
			delimiter: 'auto',
			hasHeader: true,
			inferTypes: false,
			unflattenDotKeys: true,
		});
		assert.ok(direct.ok, header);
		assert.equal(value.output, direct.output, header);
	}
	assert.equal(({} as Record<string, unknown>).a, undefined);
	assert.equal(({} as Record<string, unknown>).b, undefined);
	// 実際に配列へ入る巨大添字は拒否（配列が先に確定する順序・配列の中のキー）
	for (const [header, row] of [
		['a.1000000000,a.b', '1,2'],
		['a.x.0,a.x.1000000000', '1,2'],
		['a.0.1000000000,a.1.x', '1,2'],
	]) {
		assert.equal(
			await errorOf(toJson, {
				text: `${header}\n${row}`,
				unflattenDotKeys: true,
			}),
			INDEX_MESSAGE,
			header,
		);
	}
});

test('csv_to_json: 展開時も既存のCSV構文エラーをそのまま返す', async () => {
	assert.match(
		await errorOf(toJson, { text: 'a.b\n"x', unflattenDotKeys: true }),
		/引用符（"）が閉じられていません/,
	);
});

test('csv_to_json: 出力UTF-8 1MiBちょうどは成功、1バイト超過は拒否', async () => {
	const header = 'a';
	const rowBytes = bytes(JSON.stringify([{ a: 'x' }], null, 2)); // 1行分 + 括弧
	const perExtraRow =
		bytes(JSON.stringify([{ a: 'x' }, { a: 'x' }], null, 2)) - rowBytes;
	let rows = Math.floor((MAX_OUTPUT_BYTES - rowBytes) / perExtraRow) + 1;
	const build = (count: number, extra: number) => {
		const data = Array.from({ length: count }, () => 'x');
		data[0] = 'x'.repeat(1 + extra);
		return `${header}\n${data.join('\n')}`;
	};
	let size = bytes(
		JSON.stringify(
			Array.from({ length: rows }, () => ({ a: 'x' })),
			null,
			2,
		),
	);
	while (size > MAX_OUTPUT_BYTES) {
		rows--;
		size -= perExtraRow;
	}
	const text = build(rows, MAX_OUTPUT_BYTES - size);
	assert.ok([...text].length <= 100_000, `入力 ${[...text].length} 文字`);
	const exact = await okValue(toJson, { text });
	assert.equal(bytes(exact.output), MAX_OUTPUT_BYTES);
	assert.equal(exact.rowCount, rows);
	assert.equal(
		await errorOf(toJson, { text: build(rows, MAX_OUTPUT_BYTES - size + 1) }),
		'変換結果が上限（UTF-8で1MiB）を超えます。',
	);
});

test('想定外の例外は入力を含まない固定文言になる', async () => {
	const original = globalThis.TextEncoder;
	const secret = 'SECRET-TOKEN-12345';
	globalThis.TextEncoder = class {
		encode(): never {
			throw new Error(`boom ${secret}`);
		}
	} as unknown as typeof TextEncoder;
	try {
		const error = await errorOf(toCsv, { text: `[{"k":"${secret}"}]` });
		assert.equal(error, '変換中に予期しないエラーが発生しました。');
		assert.ok(!error.includes(secret));
	} finally {
		globalThis.TextEncoder = original;
	}
});
