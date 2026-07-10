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
	assert.equal(result.row, 1);
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
