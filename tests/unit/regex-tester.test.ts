import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	execRegexSync,
	MAX_MATCHES,
	sanitizeRegexTesterSettings,
	toRegexErrorMessage,
} from '../../src/lib/tools/regex-tester.ts';

test('execRegexSync: グローバル空文字マッチ（^ や .* 等）でフリーズせず安全に停止・列挙される', () => {
	const result = execRegexSync('^', 'g', 'abc');
	assert.ok(result.matches.length > 0);
	assert.strictEqual(result.matches[0].value, '');
	assert.strictEqual(result.matches[0].index, 0);

	const emptyMatchResult = execRegexSync('a*', 'g', 'ba');
	// フリーズ・無限ループせずに完了すること
	assert.ok(Array.isArray(emptyMatchResult.matches));
});

test('execRegexSync: サロゲートペア（絵文字）を含むテキストでマッチ位置とコードポイント境界が正確に評価される', () => {
	const text = 'A🎉B';
	// u フラグありで Unicode code point マッチ
	const result = execRegexSync('.', 'gu', text);
	assert.strictEqual(result.matches.length, 3);
	assert.strictEqual(result.matches[0].value, 'A');
	assert.strictEqual(result.matches[0].index, 0);
	assert.strictEqual(result.matches[1].value, '🎉');
	assert.strictEqual(result.matches[1].index, 1);
	assert.strictEqual(result.matches[2].value, 'B');
	assert.strictEqual(result.matches[2].index, 3); // 🎉 は 2 UTF-16 code units なので 'B' の index は 3
});

const FLAG_DEFAULTS = {
	pattern: '',
	flags: 'g',
	showReplace: false,
	replacement: '',
};

test('sanitizeRegexTesterSettings: 有効な7フラグ(dgimsuy)を保持する', () => {
	const r = sanitizeRegexTesterSettings(
		{ ...FLAG_DEFAULTS, flags: 'dgimsuy' },
		FLAG_DEFAULTS,
	);
	assert.equal(r.flags, 'dgimsuy');
});

test('sanitizeRegexTesterSettings: 7フラグ(dgimsvy)のvも保持する', () => {
	const r = sanitizeRegexTesterSettings(
		{ ...FLAG_DEFAULTS, flags: 'dgimsvy' },
		FLAG_DEFAULTS,
	);
	assert.equal(r.flags, 'dgimsvy');
});

test('sanitizeRegexTesterSettings: 空・単一フラグは保持する', () => {
	assert.equal(
		sanitizeRegexTesterSettings({ ...FLAG_DEFAULTS, flags: '' }, FLAG_DEFAULTS)
			.flags,
		'',
	);
	assert.equal(
		sanitizeRegexTesterSettings({ ...FLAG_DEFAULTS, flags: 'i' }, FLAG_DEFAULTS)
			.flags,
		'i',
	);
});

test('sanitizeRegexTesterSettings: 重複・不正文字・u/v併用・非文字列はデフォルトへ', () => {
	for (const flags of [
		'gg',
		'x',
		'g i',
		'uv',
		'dgimsuvy',
		'dgimsuyg',
		1,
		null,
	]) {
		const r = sanitizeRegexTesterSettings(
			{ ...FLAG_DEFAULTS, flags, pattern: 'a' },
			FLAG_DEFAULTS,
		);
		assert.equal(r.flags, 'g', `flags=${String(flags)}`);
		assert.equal(r.pattern, 'a');
	}
});

test('execRegexSync: 一致が上限未満・ちょうど上限なら打ち切り扱いにしない（4999/5000件）', () => {
	for (const n of [MAX_MATCHES - 1, MAX_MATCHES]) {
		const result = execRegexSync('a', 'g', 'a'.repeat(n));
		assert.strictEqual(result.matches.length, n);
		assert.ok(!result.truncated);
	}
});

test('execRegexSync: 上限を1件でも超えると5000件で打ち切り truncated=true（5001/6000件）', () => {
	for (const n of [MAX_MATCHES + 1, 6000]) {
		const result = execRegexSync('a', 'g', 'a'.repeat(n));
		assert.strictEqual(result.matches.length, MAX_MATCHES);
		assert.strictEqual(result.truncated, true);
	}
});

test('execRegexSync: 置換は表示上限に関係なく全一致が対象（6000件）', () => {
	const result = execRegexSync('a', 'g', 'a'.repeat(6000), 'b');
	assert.strictEqual(result.replacedText, 'b'.repeat(6000));
	assert.strictEqual(result.matches.length, MAX_MATCHES);
	assert.strictEqual(result.truncated, true);
});

test('execRegexSync: 非グローバルは常に最大1件で truncated にならない', () => {
	const result = execRegexSync('a', '', 'a'.repeat(6000));
	assert.strictEqual(result.matches.length, 1);
	assert.ok(!result.truncated);
});

const JA_ERROR = /[\u3040-\u30ff\u4e00-\u9fff]/;

test('execRegexSync: 不正パターン（[）は日本語の安全な通知になり英語例外・入力原文を含まない', () => {
	for (const pattern of ['[', '(secret', 'a{2,1}']) {
		const result = execRegexSync(pattern, 'g', 'abc');
		assert.deepStrictEqual(result.matches, []);
		assert.ok(result.error, pattern);
		assert.match(result.error, JA_ERROR);
		assert.doesNotMatch(
			result.error,
			/Invalid|Unterminated|regular expression/i,
		);
		assert.ok(!result.error.includes('secret'));
	}
});

test('execRegexSync: 不正フラグ（重複・未対応・u/v併用）は日本語通知になり、構文エラーとは別の文言', () => {
	const syntaxError = execRegexSync('(', 'g', 'abc').error;
	for (const flags of ['gg', 'x', 'uv']) {
		const result = execRegexSync('a', flags, 'abc');
		assert.deepStrictEqual(result.matches, []);
		assert.ok(result.error, flags);
		assert.match(result.error, JA_ERROR);
		assert.doesNotMatch(result.error, /Invalid|flags supplied|RegExp/i);
		assert.ok(!result.error.includes(flags) || flags.length === 0);
		assert.notStrictEqual(result.error, syntaxError);
	}
});

test('execRegexSync: 不正パターンの後に有効パターンへ戻すとエラーが消えマッチが復帰する', () => {
	assert.ok(execRegexSync('[', 'g', 'a[b').error);
	const recovered = execRegexSync('\\[', 'g', 'a[b');
	assert.strictEqual(recovered.error, undefined);
	assert.strictEqual(recovered.matches.length, 1);
	assert.strictEqual(recovered.matches[0].value, '[');
});

test('toRegexErrorMessage: SyntaxError以外の予期しない例外も日本語の一般メッセージにフォールバックする', () => {
	for (const err of [new Error('boom: secret input'), 'str', null, undefined]) {
		const message = toRegexErrorMessage(err);
		assert.match(message, JA_ERROR);
		assert.doesNotMatch(message, /boom|secret|str\b/);
	}
});
