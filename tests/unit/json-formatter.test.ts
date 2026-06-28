import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	formatJson,
	minifyJson,
	validateJson,
} from '../../src/lib/tools/json-formatter.ts';

// ============================================================
// formatJson: 通常ケース
// ============================================================

test('formatJson: 空文字列は空出力を返す', () => {
	const result = formatJson('');
	assert.equal(result.success, true);
	assert.equal(result.output, '');
});

test('formatJson: 通常の数値は精度を保つ', async () => {
	const result = formatJson('{"a":1,"b":42,"c":-100}');
	assert.equal(result.success, true);
	const parsed = JSON.parse(result.output);
	assert.equal(parsed.a, 1);
	assert.equal(parsed.b, 42);
	assert.equal(parsed.c, -100);
});

test('formatJson: 小数点・指数表記はそのまま整形される', async () => {
	const result = formatJson('{"pi":3.14159,"sci":1.5e10}');
	assert.equal(result.success, true);
	const parsed = JSON.parse(result.output);
	assert.ok(Math.abs(parsed.pi - Math.PI) < 1e-5);
});

test('formatJson: 構文エラーは success=false で返す', () => {
	const result = formatJson('{bad json}');
	assert.equal(result.success, false);
	assert.ok(result.error?.includes('JSON構文エラー'));
});

test('formatJson: indent=4 で4スペース整形', () => {
	const result = formatJson('{"a":1}', '4');
	assert.equal(result.success, true);
	assert.ok(result.output.includes('    "a"'));
});

test('formatJson: indent=tab でタブ整形', () => {
	const result = formatJson('{"a":1}', 'tab');
	assert.equal(result.success, true);
	assert.ok(result.output.includes('\t"a"'));
});

// ============================================================
// formatJson: 大整数精度保持（主要テスト）
// ============================================================

test('formatJson: MAX_SAFE_INTEGER を超える大整数の精度を保持', async () => {
	const bigNum = '9007199254740993'; // 2^53 + 1 = MAX_SAFE_INTEGER + 2
	const input = `{"id":${bigNum}}`;
	const result = formatJson(input);
	assert.equal(result.success, true);
	// 出力に大整数がそのまま含まれること（丸められていないこと）
	assert.ok(
		result.output.includes(bigNum),
		`期待値: ${bigNum} を含む\n実際: ${result.output}`,
	);
});

test('formatJson: 16桁の大整数 (ツイッターID等) の精度を保持', async () => {
	const id = '1234567890123456789';
	const input = `{"tweet_id":${id},"user_id":987654321098765432}`;
	const result = formatJson(input);
	assert.equal(result.success, true);
	assert.ok(
		result.output.includes('1234567890123456789'),
		`tweet_id丸め: ${result.output}`,
	);
	assert.ok(
		result.output.includes('987654321098765432'),
		`user_id丸め: ${result.output}`,
	);
});

test('formatJson: 負の大整数の精度を保持', async () => {
	const negBig = '-9007199254740993';
	const input = `{"balance":${negBig}}`;
	const result = formatJson(input);
	assert.equal(result.success, true);
	assert.ok(
		result.output.includes(negBig),
		`期待: ${negBig}\n実際: ${result.output}`,
	);
});

test('formatJson: MAX_SAFE_INTEGER ちょうどは精度を保持（変換不要）', async () => {
	const safe = '9007199254740991';
	const input = `{"val":${safe}}`;
	const result = formatJson(input);
	assert.equal(result.success, true);
	assert.ok(
		result.output.includes(safe),
		`期待: ${safe}\n実際: ${result.output}`,
	);
});

test('formatJson: 文字列内の数字は変換されない', async () => {
	const input =
		'{"desc":"9007199254740993 is too large","num":9007199254740993}';
	const result = formatJson(input);
	assert.equal(result.success, true);
	// 文字列値はそのまま保持
	assert.ok(result.output.includes('"9007199254740993 is too large"'));
	// 数値キーは精度保持
	assert.ok(result.output.includes('9007199254740993'));
});

test('formatJson: 配列内の大整数も精度を保持', async () => {
	const input = '[9007199254740993,9007199254740994,1]';
	const result = formatJson(input);
	assert.equal(result.success, true);
	assert.ok(result.output.includes('9007199254740993'));
	assert.ok(result.output.includes('9007199254740994'));
});

// ============================================================
// minifyJson: 大整数精度保持
// ============================================================

test('minifyJson: 大整数の精度を保持', async () => {
	const id = '9007199254740993';
	const result = minifyJson(`{\n  "id": ${id}\n}`);
	assert.equal(result.success, true);
	assert.ok(result.output.includes(id), `期待: ${id}\n実際: ${result.output}`);
});

test('minifyJson: 空文字列は空出力を返す', () => {
	const result = minifyJson('');
	assert.equal(result.success, true);
	assert.equal(result.output, '');
});

// ============================================================
// validateJson: 通常動作を維持
// ============================================================

test('validateJson: 有効なJSONは success=true', () => {
	const result = validateJson('{"a":1}');
	assert.equal(result.success, true);
	assert.ok(result.output.includes('有効'));
});

test('validateJson: 無効なJSONは success=false', () => {
	const result = validateJson('{bad}');
	assert.equal(result.success, false);
});

test('validateJson: 空文字列は有効扱い', () => {
	const result = validateJson('');
	assert.equal(result.success, true);
});
