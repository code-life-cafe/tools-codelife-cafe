// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/yaml-json-toml.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	type ConvertOptions,
	type ConvertResult,
	convertFormats,
	sortKeysDeep,
} from '../../src/lib/tools/yaml-json-toml.ts';

const DEFAULT_OPTS: ConvertOptions = { indent: 2, sortKeys: false };

function expectOk(result: ConvertResult): { output: string; note?: string } {
	assert.ok(result.ok, `ok を期待: ${JSON.stringify(result)}`);
	return result;
}

function expectError(result: ConvertResult): {
	error: string;
	row?: number;
	col?: number;
} {
	assert.ok(!result.ok, `エラーを期待: ${JSON.stringify(result)}`);
	return result;
}

// ---------------------------------------------------------------------------
// 6方向ハッピーパス（ラウンドトリップの構造一致）
// ---------------------------------------------------------------------------

const NESTED_OBJECT = {
	name: '山田太郎',
	age: 30,
	tags: ['営業', 'リーダー'],
	address: { city: '東京', zip: '100-0001' },
};

test('convertFormats: JSON → YAML → JSON で構造が一致する', () => {
	const json = JSON.stringify(NESTED_OBJECT);
	const toYaml = expectOk(convertFormats('json', 'yaml', json, DEFAULT_OPTS));
	const backToJson = expectOk(
		convertFormats('yaml', 'json', toYaml.output, DEFAULT_OPTS),
	);
	assert.deepEqual(JSON.parse(backToJson.output), NESTED_OBJECT);
});

test('convertFormats: YAML → JSON → YAML で構造が一致する', () => {
	const yamlText = 'name: 山田太郎\nage: 30\ntags:\n  - 営業\n  - リーダー\n';
	const toJson = expectOk(
		convertFormats('yaml', 'json', yamlText, DEFAULT_OPTS),
	);
	assert.deepEqual(JSON.parse(toJson.output), {
		name: '山田太郎',
		age: 30,
		tags: ['営業', 'リーダー'],
	});
	const backToYaml = expectOk(
		convertFormats('json', 'yaml', toJson.output, DEFAULT_OPTS),
	);
	const reparsed = expectOk(
		convertFormats('yaml', 'json', backToYaml.output, DEFAULT_OPTS),
	);
	assert.deepEqual(JSON.parse(reparsed.output), {
		name: '山田太郎',
		age: 30,
		tags: ['営業', 'リーダー'],
	});
});

test('convertFormats: JSON → TOML → JSON で構造が一致する（null無し・ルートオブジェクト）', () => {
	const json = JSON.stringify(NESTED_OBJECT);
	const toToml = expectOk(convertFormats('json', 'toml', json, DEFAULT_OPTS));
	const backToJson = expectOk(
		convertFormats('toml', 'json', toToml.output, DEFAULT_OPTS),
	);
	assert.deepEqual(JSON.parse(backToJson.output), NESTED_OBJECT);
});

test('convertFormats: TOML → JSON → TOML で構造が一致する', () => {
	const tomlText = 'name = "太郎"\nage = 30\n\n[address]\ncity = "東京"\n';
	const toJson = expectOk(
		convertFormats('toml', 'json', tomlText, DEFAULT_OPTS),
	);
	assert.deepEqual(JSON.parse(toJson.output), {
		name: '太郎',
		age: 30,
		address: { city: '東京' },
	});
	const backToToml = expectOk(
		convertFormats('json', 'toml', toJson.output, DEFAULT_OPTS),
	);
	const reparsed = expectOk(
		convertFormats('toml', 'json', backToToml.output, DEFAULT_OPTS),
	);
	assert.deepEqual(JSON.parse(reparsed.output), {
		name: '太郎',
		age: 30,
		address: { city: '東京' },
	});
});

test('convertFormats: YAML → TOML → YAML で構造が一致する', () => {
	const yamlText = 'name: 太郎\nage: 30\naddress:\n  city: 東京\n';
	const toToml = expectOk(
		convertFormats('yaml', 'toml', yamlText, DEFAULT_OPTS),
	);
	const backToYaml = expectOk(
		convertFormats('toml', 'yaml', toToml.output, DEFAULT_OPTS),
	);
	const reparsed = expectOk(
		convertFormats('yaml', 'json', backToYaml.output, DEFAULT_OPTS),
	);
	assert.deepEqual(JSON.parse(reparsed.output), {
		name: '太郎',
		age: 30,
		address: { city: '東京' },
	});
});

test('convertFormats: TOML → YAML → TOML で構造が一致する', () => {
	const tomlText = 'name = "太郎"\nage = 30\n';
	const toYaml = expectOk(
		convertFormats('toml', 'yaml', tomlText, DEFAULT_OPTS),
	);
	const backToToml = expectOk(
		convertFormats('yaml', 'toml', toYaml.output, DEFAULT_OPTS),
	);
	const reparsed = expectOk(
		convertFormats('toml', 'json', backToToml.output, DEFAULT_OPTS),
	);
	assert.deepEqual(JSON.parse(reparsed.output), { name: '太郎', age: 30 });
});

// ---------------------------------------------------------------------------
// From === To（整形のみ）
// ---------------------------------------------------------------------------

test('convertFormats: From===To はparse→serializeのみの整形になる（JSON）', () => {
	const result = expectOk(
		convertFormats('json', 'json', '{"b":2,"a":1}', {
			indent: 2,
			sortKeys: false,
		}),
	);
	assert.equal(result.output, '{\n  "b": 2,\n  "a": 1\n}');
});

test('convertFormats: From===To + sortKeys でキー順が整列される（YAML）', () => {
	const result = expectOk(
		convertFormats('yaml', 'yaml', 'b: 2\na: 1\n', {
			indent: 2,
			sortKeys: true,
		}),
	);
	assert.equal(result.output.indexOf('a:'), 0);
	assert.ok(result.output.indexOf('a:') < result.output.indexOf('b:'));
});

// ---------------------------------------------------------------------------
// キーソート on/off
// ---------------------------------------------------------------------------

test('sortKeysDeep: オブジェクトキーを再帰的に辞書順ソートし配列順序は維持する', () => {
	const input = { b: 2, a: { d: 4, c: 3 }, arr: [{ y: 1, x: 2 }, 'z', 'a'] };
	assert.deepEqual(sortKeysDeep(input), {
		a: { c: 3, d: 4 },
		arr: [{ x: 2, y: 1 }, 'z', 'a'],
		b: 2,
	});
});

test('convertFormats: sortKeys=falseではキー順が保持される', () => {
	const result = expectOk(
		convertFormats('json', 'json', '{"b":2,"a":1}', {
			indent: 2,
			sortKeys: false,
		}),
	);
	assert.ok(result.output.indexOf('"b"') < result.output.indexOf('"a"'));
});

test('convertFormats: sortKeys=trueでキー順がソートされる', () => {
	const result = expectOk(
		convertFormats('json', 'json', '{"b":2,"a":1}', {
			indent: 2,
			sortKeys: true,
		}),
	);
	assert.ok(result.output.indexOf('"a"') < result.output.indexOf('"b"'));
});

// ---------------------------------------------------------------------------
// indent 2 / 4 / 0
// ---------------------------------------------------------------------------

test('convertFormats: JSON indent=4', () => {
	const result = expectOk(
		convertFormats('json', 'json', '{"a":1}', { indent: 4, sortKeys: false }),
	);
	assert.equal(result.output, '{\n    "a": 1\n}');
});

test('convertFormats: JSON indent=0（1行）', () => {
	const result = expectOk(
		convertFormats('json', 'json', '{"a": 1, "b": 2}', {
			indent: 0,
			sortKeys: false,
		}),
	);
	assert.equal(result.output, '{"a":1,"b":2}');
});

test('convertFormats: YAML indent=0（flowスタイルでコンパクト表示）', () => {
	const result = expectOk(
		convertFormats('json', 'yaml', '{"a":1,"b":{"c":2}}', {
			indent: 0,
			sortKeys: false,
		}),
	);
	assert.equal(result.output.trim(), '{a: 1, b: {c: 2}}');
});

test('convertFormats: TOMLはindent=0でもコンパクト非対応でnoteが付く', () => {
	const result = expectOk(
		convertFormats('json', 'toml', '{"a":1}', { indent: 0, sortKeys: false }),
	);
	assert.equal(result.output, 'a = 1\n');
	assert.ok(result.note?.includes('コンパクト表示'));
});

// ---------------------------------------------------------------------------
// 不正入力 → エラーオブジェクト
// ---------------------------------------------------------------------------

test('convertFormats: 不正なJSONはrow/colを含むエラーになる', () => {
	const result = expectError(
		convertFormats('json', 'yaml', '{"a": 1,}', DEFAULT_OPTS),
	);
	assert.ok(result.error.includes('JSON'));
	assert.equal(result.row, 1);
});

test('convertFormats: 不正なYAMLはrow/colを含むエラーになる', () => {
	const result = expectError(
		convertFormats('yaml', 'json', 'a: [1, 2\nb: 3', DEFAULT_OPTS),
	);
	assert.ok(result.error.includes('YAML'));
	assert.equal(result.row, 2);
});

test('convertFormats: 不正なTOMLはrow/colを含むエラーになる', () => {
	const result = expectError(
		convertFormats('toml', 'json', 'a = [1, 2\nb = 3', DEFAULT_OPTS),
	);
	assert.ok(result.error.includes('TOML'));
	// smol-toml 1.9以降は閉じ括弧が無い配列のエラーを、不正トークンのある行（2行目）に報告する
	assert.equal(result.row, 2);
});

test('convertFormats: TOML入力（nullプロトタイプのパース結果）でもキーソートとTOML出力が動く', () => {
	const sorted = convertFormats('toml', 'json', 'b = 2\na = "x"', {
		...DEFAULT_OPTS,
		sortKeys: true,
	});
	assert.equal(sorted.ok, true);
	if (sorted.ok)
		assert.equal(sorted.output.replace(/\s/g, ''), '{"a":"x","b":2}');
	const same = convertFormats('toml', 'toml', 'b = 2\na = "x"', DEFAULT_OPTS);
	assert.equal(same.ok, true);
});

test('convertFormats: 空入力はエラーになる', () => {
	const result = expectError(
		convertFormats('json', 'yaml', '   ', DEFAULT_OPTS),
	);
	assert.ok(result.error.includes('入力してください'));
});

// ---------------------------------------------------------------------------
// TOML変換ポリシー: ルート配列 / null
// ---------------------------------------------------------------------------

test('convertFormats: JSONルート配列 → TOML は明示エラー（自動ラップしない）', () => {
	const result = expectError(
		convertFormats('json', 'toml', '[1, 2, 3]', DEFAULT_OPTS),
	);
	assert.ok(result.error.includes('TOML'));
	assert.ok(result.error.includes('配列'));
});

test('convertFormats: null含有 → TOML はキー単位パス付きの明示エラー', () => {
	const result = expectError(
		convertFormats(
			'json',
			'toml',
			'{"settings":{"apiKey":null},"items":[{"name":"a"},{"name":null}]}',
			DEFAULT_OPTS,
		),
	);
	assert.ok(result.error.includes('settings.apiKey'));
	assert.ok(result.error.includes('items[1].name'));
});

test('convertFormats: null無しならTOMLへ変換できる', () => {
	const result = expectOk(
		convertFormats('json', 'toml', '{"a":1,"b":2}', {
			indent: 2,
			sortKeys: false,
		}),
	);
	assert.equal(result.output, 'a = 1\nb = 2\n');
});

// ---------------------------------------------------------------------------
// マルチドキュメントYAML
// ---------------------------------------------------------------------------

test('convertFormats: マルチドキュメントYAML（--- 区切り）は明示エラー', () => {
	const result = expectError(
		convertFormats('yaml', 'json', 'a: 1\n---\nb: 2\n', DEFAULT_OPTS),
	);
	assert.ok(result.error.includes('複数のYAMLドキュメント'));
});

// ---------------------------------------------------------------------------
// キーソート後もスカラー→テーブル順で有効なTOMLになること
// ---------------------------------------------------------------------------

test('convertFormats: スカラー/ネスト混在オブジェクトはキーソート後も有効なTOMLになる', () => {
	const input = JSON.stringify({ apple: { nested: 1 }, zebra: 'x' });
	const toToml = expectOk(
		convertFormats('json', 'toml', input, { indent: 2, sortKeys: true }),
	);
	const reparsed = expectOk(
		convertFormats('toml', 'json', toToml.output, DEFAULT_OPTS),
	);
	assert.deepEqual(JSON.parse(reparsed.output), {
		apple: { nested: 1 },
		zebra: 'x',
	});
});

// ---------------------------------------------------------------------------
// YAML anchors/aliases は展開される
// ---------------------------------------------------------------------------

test('convertFormats: YAML anchors/aliasesは具象値に展開される（アンカー再生成しない）', () => {
	const yamlText = 'base: &base\n  a: 1\nchild:\n  b: 2\nother: *base\n';
	const result = expectOk(
		convertFormats('yaml', 'json', yamlText, DEFAULT_OPTS),
	);
	assert.deepEqual(JSON.parse(result.output), {
		base: { a: 1 },
		child: { b: 2 },
		other: { a: 1 },
	});
});

// ---------------------------------------------------------------------------
// TOML datetime はJSON/YAMLでISO文字列化される
// ---------------------------------------------------------------------------

test('convertFormats: TOML datetimeはJSON/YAMLでISO文字列になる', () => {
	const tomlText = [
		'odt = 1979-05-27T07:32:00Z',
		'ldt = 1979-05-27T07:32:00',
		'ld = 1979-05-27',
		'lt = 07:32:00',
	].join('\n');
	const result = expectOk(
		convertFormats('toml', 'json', tomlText, DEFAULT_OPTS),
	);
	const parsed = JSON.parse(result.output);
	assert.equal(parsed.odt, '1979-05-27T07:32:00.000Z');
	assert.equal(parsed.ldt, '1979-05-27T07:32:00.000');
	assert.equal(parsed.ld, '1979-05-27');
	assert.equal(parsed.lt, '07:32:00.000');
});

test('safeMode: WebMCPのみaliasを拒否し、通常の変換は従来どおり許可する', () => {
	const text = 'a: &a [1, 2]\nb: *a';
	const normal = convertFormats('yaml', 'json', text, DEFAULT_OPTS);
	assert.ok(normal.ok);
	assert.deepEqual(JSON.parse(normal.output), { a: [1, 2], b: [1, 2] });
	const safe = convertFormats('yaml', 'json', text, {
		...DEFAULT_OPTS,
		safeMode: true,
	});
	assert.equal(safe.ok, false);
});

test('通常UIモード: YAML Alias Bomb または過剰なエイリアス展開は安全に拒否される', () => {
	// 多段エイリアスによる指数関数的爆発
	const bomb = `
a: &a ["lol","lol","lol","lol","lol","lol","lol","lol","lol","lol"]
b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]
c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]
d: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]
e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]
root: *e
`;
	const result = convertFormats('yaml', 'json', bomb, DEFAULT_OPTS);
	assert.equal(result.ok, false);
});

test('YAMLの安全整数範囲外の整数は黙って丸めず、パス付きエラーにする（#567）', () => {
	for (const to of ['json', 'yaml', 'toml'] as const) {
		const result = convertFormats(
			'yaml',
			to,
			'id: 9007199254740993\n',
			DEFAULT_OPTS,
		);
		assert.equal(result.ok, false, to);
		if (!result.ok) {
			assert.match(result.error, /id/);
			assert.match(result.error, /引用符/);
		}
	}
	const nested = convertFormats(
		'yaml',
		'json',
		'a:\n  list: [12, -9007199254740993]\n',
		DEFAULT_OPTS,
	);
	assert.equal(nested.ok, false);
	if (!nested.ok) assert.match(nested.error, /a\.list\[1\]/);
});

test('YAMLの整数: 境界値・引用済み文字列・浮動小数点表記は従来どおり変換する（#567）', () => {
	const cases: [string, string][] = [
		['id: 9007199254740991\n', '{"id":9007199254740991}'],
		['id: -9007199254740991\n', '{"id":-9007199254740991}'],
		// 2^53 は丸めが起きないため変換する
		['id: 9007199254740992\n', '{"id":9007199254740992}'],
		['id: "9007199254740993"\n', '{"id":"9007199254740993"}'],
		['id: 1.0e+20\n', '{"id":100000000000000000000}'],
	];
	for (const [input, expected] of cases) {
		const result = convertFormats('yaml', 'json', input, {
			indent: 0,
			sortKeys: false,
		});
		assert.equal(result.ok, true, input);
		if (result.ok) assert.equal(result.output, expected, input);
	}
});

test('YAMLの整数: 数値にすると無限大になる桁数でも例外を出さず、値を変えずに変換する（#567）', () => {
	const digits = '9'.repeat(400);
	const result = convertFormats('yaml', 'json', `big: ${digits}\n`, {
		indent: 0,
		sortKeys: false,
	});
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.output, `{"big":"${digits}"}`);
});

test('YAMLの整数: 引用符の文字列・コメント内の長い数字では誤検出しない（#567）', () => {
	const cases: [string, string][] = [
		[
			'a: "9007199254740993"\nb: 9007199254740992\n',
			'{"a":"9007199254740993","b":9007199254740992}',
		],
		[
			"a: 'x 9007199254740993'\nb: 9007199254740992\n",
			'{"a":"x 9007199254740993","b":9007199254740992}',
		],
		['b: 9007199254740992 # 9007199254740993\n', '{"b":9007199254740992}'],
	];
	for (const [input, expected] of cases) {
		const result = convertFormats('yaml', 'json', input, {
			indent: 0,
			sortKeys: false,
		});
		assert.equal(result.ok, true, input);
		if (result.ok) assert.equal(result.output, expected, input);
	}
});

test('YAMLの整数: 非数値スカラー内の数字を別の値のエラーにしない（#595）', () => {
	for (const text of [
		'description: 番号 9007199254740993\nexact: 9007199254740992',
		'description: |\n  9007199254740993\nexact: 9007199254740992',
		'description: >\n  番号 9007199254740993\nexact: 9007199254740992',
		'description: !!str 9007199254740993\nexact: 9007199254740992',
	]) {
		const result = expectOk(convertFormats('yaml', 'json', text, DEFAULT_OPTS));
		assert.equal(JSON.parse(result.output).exact, 9007199254740992);
	}
});

test('YAMLの整数: 丸め後に同じ数値になる別のキーをエラーパスに含めない（#595）', () => {
	for (const to of ['json', 'yaml', 'toml'] as const) {
		for (const sortKeys of [false, true]) {
			const result = expectError(
				convertFormats(
					'yaml',
					to,
					'exact: 9007199254740992\nitems: [{id: 9007199254740993}]',
					{ ...DEFAULT_OPTS, sortKeys },
				),
			);
			assert.match(result.error, /items\[0\]\.id/);
			assert.doesNotMatch(result.error, /exact/);
		}
	}
});

test('YAMLの整数: 明示的な整数タグの引用値でも正しいパスを報告する（#595）', () => {
	for (const token of ['!!int "9007199254740993"', '!!int 0x20000000000001']) {
		const result = expectError(
			convertFormats('yaml', 'json', `items: [{id: ${token}}]`, DEFAULT_OPTS),
		);
		assert.match(result.error, /items\[0\]\.id/);
	}
});

test('YAMLの整数キー: 丸めず正確な文字列キーとして全形式に保持する（#595）', () => {
	const text = [
		'outer:',
		'  9007199254740992: 境界',
		'  9007199254740993: 正の整数',
		'  -9007199254740993: 負の整数',
		'  0x20000000000003: 十六進数',
	].join('\n');
	const expected = {
		outer: {
			'9007199254740992': '境界',
			'9007199254740993': '正の整数',
			'-9007199254740993': '負の整数',
			'9007199254740995': '十六進数',
		},
	};
	for (const to of ['json', 'yaml', 'toml'] as const) {
		for (const sortKeys of [false, true]) {
			const converted = expectOk(
				convertFormats('yaml', to, text, { ...DEFAULT_OPTS, sortKeys }),
			);
			const back = expectOk(
				convertFormats(to, 'json', converted.output, DEFAULT_OPTS),
			);
			assert.deepEqual(JSON.parse(back.output), expected);
		}
	}
});

test('YAMLの整数キー: キーの元の整数をエラーのパスにも保持する（#595）', () => {
	const result = expectError(
		convertFormats(
			'yaml',
			'json',
			'outer: {9007199254740993: {id: 9007199254740995}}',
			DEFAULT_OPTS,
		),
	);
	assert.match(result.error, /outer\.9007199254740993\.id/);
});

test('YAMLのマージ: 単一アンカーを展開し、明示キーを記述順によらず優先する（#575）', () => {
	for (const entries of [
		'<<: *base, port: 8080, nested: {local: true}',
		'port: 8080, nested: {local: true}, <<: *base',
	]) {
		const text = [
			'base: &base {host: localhost, port: 80, nested: {shared: true}}',
			`app: {${entries}}`,
		].join('\n');
		for (const to of ['json', 'yaml', 'toml'] as const) {
			for (const sortKeys of [false, true]) {
				const converted = expectOk(
					convertFormats('yaml', to, text, { ...DEFAULT_OPTS, sortKeys }),
				);
				const back = expectOk(
					convertFormats(to, 'json', converted.output, DEFAULT_OPTS),
				);
				assert.deepEqual(JSON.parse(back.output), {
					base: { host: 'localhost', port: 80, nested: { shared: true } },
					app: { host: 'localhost', port: 8080, nested: { local: true } },
				});
				assert.equal(converted.note, undefined);
			}
		}
	}
});

test('YAMLのマージ: 配列は先頭のマップを優先し、明示キーがさらに優先する（#575）', () => {
	for (const [aliases, expectedPort] of [
		['*first, *second', 80],
		['*second, *first', 443],
	] as const) {
		for (const sortKeys of [false, true]) {
			const text = [
				'first: &first {port: 80, host: localhost}',
				'second: &second {port: 443, tls: true}',
				`merged: {<<: [${aliases}]}`,
				`overridden: {port: 8080, <<: [${aliases}]}`,
			].join('\n');
			const result = expectOk(
				convertFormats('yaml', 'json', text, { ...DEFAULT_OPTS, sortKeys }),
			);
			const parsed = JSON.parse(result.output);
			assert.deepEqual(parsed.merged, {
				port: expectedPort,
				host: 'localhost',
				tls: true,
			});
			assert.deepEqual(parsed.overridden, {
				port: 8080,
				host: 'localhost',
				tls: true,
			});
		}
	}
});

test('YAMLのマージ以外はCOREスキーマを維持し、引用した << は通常のキーにする（#575）', () => {
	const result = expectOk(
		convertFormats(
			'yaml',
			'json',
			'values: [yes, no, on, off, 2026-11-05, true, false]\n"<<": 文字列キー',
			DEFAULT_OPTS,
		),
	);
	assert.deepEqual(JSON.parse(result.output), {
		values: ['yes', 'no', 'on', 'off', '2026-11-05', true, false],
		'<<': '文字列キー',
	});
});

test('YAMLの !!binary / !!set は従来どおり構文エラーになる（#575）', () => {
	for (const text of ['a: !!binary SGVsbG8=', 'a: !!set {x: null}']) {
		for (const to of ['json', 'yaml', 'toml'] as const) {
			for (const sortKeys of [false, true]) {
				const result = expectError(
					convertFormats('yaml', to, text, { ...DEFAULT_OPTS, sortKeys }),
				);
				assert.equal(result.error, 'YAMLの構文エラーです。');
				assert.equal(result.row, 1);
				assert.equal(result.col, 4);
				assert.equal('output' in result, false);
			}
		}
	}
});

test('YAMLの .inf / .nan はJSONのnullへ変換し、日本語の警告を返す（#575）', () => {
	for (const token of ['.inf', '-.inf', '.nan']) {
		for (const sortKeys of [false, true]) {
			for (const indent of [0, 2, 4] as const) {
				for (const [text, expected] of [
					[token, null],
					[`items: [{value: ${token}}]`, { items: [{ value: null }] }],
				] as const) {
					const result = expectOk(
						convertFormats('yaml', 'json', text, { indent, sortKeys }),
					);
					assert.deepEqual(JSON.parse(result.output), expected);
					assert.match(result.note ?? '', /警告.*null.*変換/);
				}
			}
		}
	}
});

test('引用した .inf / .nan と通常値にはJSONの警告を出さない（#575）', () => {
	const result = expectOk(
		convertFormats(
			'yaml',
			'json',
			'values: [".inf", ".nan", null, 1.5, true]',
			DEFAULT_OPTS,
		),
	);
	assert.deepEqual(JSON.parse(result.output), {
		values: ['.inf', '.nan', null, 1.5, true],
	});
	assert.equal(result.note, undefined);
});

test('非有限数を保持できるYAML/TOML出力ではnullへの変換警告を出さない（#575）', () => {
	for (const to of ['yaml', 'toml'] as const) {
		const result = expectOk(
			convertFormats('yaml', to, 'values: [.inf, -.inf, .nan]', DEFAULT_OPTS),
		);
		assert.equal(result.note, undefined);
		const back = expectOk(
			convertFormats(to, 'json', result.output, DEFAULT_OPTS),
		);
		assert.deepEqual(JSON.parse(back.output), { values: [null, null, null] });
		assert.match(back.note ?? '', /警告.*null.*変換/);
	}
});

test('循環エイリアスは全出力形式・ソートON/OFFで日本語エラーになり、出力を持たない（#577）', () => {
	for (const text of ['root: &root {self: *root}', 'root: &root [*root]']) {
		for (const to of ['json', 'yaml', 'toml'] as const) {
			for (const sortKeys of [false, true]) {
				const result = expectError(
					convertFormats('yaml', to, text, { ...DEFAULT_OPTS, sortKeys }),
				);
				assert.match(result.error, /循環参照/);
				assert.equal('output' in result, false);
			}
		}
	}
});

test('正常アンカーは全出力形式・ソートON/OFFで展開され、循環エラーの後も復帰する（#577）', () => {
	for (const to of ['json', 'yaml', 'toml'] as const) {
		for (const sortKeys of [false, true]) {
			const options = { ...DEFAULT_OPTS, sortKeys };
			for (const port of [80, 8080]) {
				const result = expectOk(
					convertFormats(
						'yaml',
						to,
						`base: &base {port: ${port}, host: localhost}\ncopy: *base`,
						options,
					),
				);
				const back = expectOk(
					convertFormats(to, 'json', result.output, DEFAULT_OPTS),
				);
				assert.deepEqual(JSON.parse(back.output), {
					base: { port, host: 'localhost' },
					copy: { port, host: 'localhost' },
				});
				assert.equal(result.note, undefined);
				if (port === 80) {
					expectError(
						convertFormats('yaml', to, 'root: &root [*root]', options),
					);
				}
			}
		}
	}
});

test('シリアライズ例外は全出力形式・ソートON/OFFで捕捉し、次の変換で復帰する（#577）', (t) => {
	for (const to of ['json', 'yaml', 'toml'] as const) {
		for (const sortKeys of [false, true]) {
			const options = { ...DEFAULT_OPTS, sortKeys };
			// パーサーが未対応の値を返した場合を注入し、各実シリアライザーの例外を起こす。
			const parser = t.mock.method(JSON, 'parse', () => ({
				value: to === 'toml' ? Symbol('unsupported') : 1n,
			}));
			let result: ConvertResult;
			try {
				result = convertFormats('json', to, '{"value":1}', options);
			} finally {
				parser.mock.restore();
			}
			assert.equal(
				expectError(result).error.startsWith(
					`${to.toUpperCase()}への変換に失敗しました:`,
				),
				true,
			);
			assert.equal('output' in result, false);
			const recovered = expectOk(
				convertFormats('json', to, '{"value":2}', options),
			);
			const back = expectOk(
				convertFormats(to, 'json', recovered.output, DEFAULT_OPTS),
			);
			assert.deepEqual(JSON.parse(back.output), { value: 2 });
		}
	}
});
