import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	addRow,
	buildUrl,
	decodeQueryComponent,
	MAX_PARAMS,
	parseUrl,
	removeRow,
	updateRow,
} from '../../src/lib/tools/url-parser.ts';

function parseOk(input: string) {
	const r = parseUrl(input);
	assert.ok(r.ok, r.ok ? '' : r.error);
	return r.value;
}

test('url-parser: 構成要素を分解する', () => {
	const v = parseOk('https://example.com:8080/a/b?x=1#frag');
	assert.equal(v.protocol, 'https:');
	assert.equal(v.host, 'example.com:8080');
	assert.equal(v.pathname, '/a/b');
	assert.equal(v.hash, '#frag');
	assert.deepEqual(v.params, [{ key: 'x', value: '1' }]);
});

test('url-parser: http/https以外・相対URL・空入力はエラー', () => {
	for (const input of ['', '   ', 'ftp://example.com', '/path?a=1', 'abc']) {
		assert.equal(parseUrl(input).ok, false, input);
	}
	assert.equal(parseUrl('javascript:alert(1)').ok, false);
});

test('url-parser: 重複キー・空キー・空値・日本語を保持する', () => {
	const v = parseOk('https://e.com/?a=1&a=2&=v&k=&flag&q=%E6%9D%B1%E4%BA%AC');
	assert.deepEqual(v.params, [
		{ key: 'a', value: '1' },
		{ key: 'a', value: '2' },
		{ key: '', value: 'v' },
		{ key: 'k', value: '' },
		{ key: 'flag', value: '' },
		{ key: 'q', value: '東京' },
	]);
});

test('url-parser: +は空白、%2Bは+として一度だけデコードする', () => {
	const v = parseOk('https://e.com/?a=b+c&d=e%2Bf&g=%2541');
	assert.deepEqual(v.params, [
		{ key: 'a', value: 'b c' },
		{ key: 'd', value: 'e+f' },
		{ key: 'g', value: '%41' },
	]);
});

test('url-parser: 不正なパーセント・不正UTF-8は警告し原文を保持して再生成で壊さない', () => {
	const v = parseOk('https://e.com/p?a=%zz&b=%E3%81&c=ok');
	assert.equal(v.warnings.length, 2);
	assert.equal(v.params[0]?.value, '%zz');
	assert.equal(v.params[1]?.value, '%E3%81');
	const built = buildUrl(v.baseUrl, v.params);
	assert.ok(built.ok);
	assert.equal(built.url, 'https://e.com/p?a=%zz&b=%E3%81&c=ok');
});

test('url-parser: 不正値を編集すると原文保持を解除して新しい値をエンコードする', () => {
	const v = parseOk('https://e.com/?a=%zz');
	const rows = updateRow(v.params, 0, 'value', '100%');
	const built = buildUrl(v.baseUrl, rows);
	assert.ok(built.ok);
	assert.equal(built.url, 'https://e.com/?a=100%25');
});

test('url-parser: decodeQueryComponent は孤立%や不正UTF-8を拒否する', () => {
	assert.equal(decodeQueryComponent('100%').ok, false);
	assert.equal(decodeQueryComponent('%C0%AF').ok, false);
	assert.deepEqual(decodeQueryComponent('%E3%81%82'), { ok: true, text: 'あ' });
});

test('url-parser: パスとハッシュを保持してパラメータを追加・削除する', () => {
	const v = parseOk('https://e.com/a/b?x=1&y=2#top');
	let rows = removeRow(v.params, 0);
	rows = addRow(rows);
	rows = updateRow(rows, rows.length - 1, 'key', '検索');
	rows = updateRow(rows, rows.length - 1, 'value', 'a b&c=d+e');
	const built = buildUrl(v.baseUrl, rows);
	assert.ok(built.ok);
	assert.equal(
		built.url,
		'https://e.com/a/b?y=2&%E6%A4%9C%E7%B4%A2=a%20b%26c%3Dd%2Be#top',
	);
});

test('url-parser: キーも値も空のパラメータを順序ごと保持し、全削除でクエリが消える', () => {
	const v = parseOk('https://e.com/p?=&a=1&=#h');
	const built = buildUrl(v.baseUrl, v.params);
	assert.ok(built.ok);
	assert.equal(built.url, 'https://e.com/p?=&a=1&=#h');
	const empty = buildUrl(v.baseUrl, []);
	assert.ok(empty.ok);
	assert.equal(empty.url, 'https://e.com/p#h');
});

test('url-parser: BOM・非BMP文字・混合エンコードのクエリ値を欠落させない', () => {
	const v = parseOk(
		'https://e.com/?q=%EF%BB%BFabc&emoji=%F0%9F%98%80&mix=あ%E3%81%84',
	);
	assert.equal(v.params[0]?.value, '\uFEFFabc');
	assert.equal(v.params[1]?.value, '😀');
	assert.equal(v.params[2]?.value, 'あい');
	const built = buildUrl(v.baseUrl, v.params);
	assert.ok(built.ok);
	assert.deepEqual(parseOk(built.url).params, v.params);
});

test('url-parser: HTML風の値は文字列のまま扱う', () => {
	const v = parseOk('https://e.com/?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
	assert.equal(v.params[0]?.value, '<script>alert(1)</script>');
});

test('url-parser: 孤立サロゲートはエンコードエラーとして返す', () => {
	const built = buildUrl('https://e.com/', [{ key: 'a', value: '\ud800' }]);
	assert.equal(built.ok, false);
});

test('url-parser: パラメータ数の上限を超えるとエラー', () => {
	const query = Array.from(
		{ length: MAX_PARAMS + 1 },
		(_, i) => `k${i}=1`,
	).join('&');
	assert.equal(parseUrl(`https://e.com/?${query}`).ok, false);
	const ok = Array.from({ length: MAX_PARAMS }, (_, i) => `k${i}=1`).join('&');
	assert.equal(parseUrl(`https://e.com/?${ok}`).ok, true);
	assert.equal(
		addRow(Array.from({ length: MAX_PARAMS }, () => ({ key: 'a', value: '' })))
			.length,
		MAX_PARAMS,
	);
});

test('url-parser: 認証情報を含む場合は警告する', () => {
	const v = parseOk('https://user:pass@e.com/');
	assert.equal(v.hasCredentials, true);
	assert.equal(v.warnings.length, 1);
});
