// 実行方法: npm run test:unit
// 単体実行: node --test tests/unit/checksum-list.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
	buildChecksumReport,
	type ChecksumFileState,
	checksumBaseName,
	parseChecksumList,
	requiredAlgorithmsForFile,
} from '../../src/lib/tools/checksum-list.ts';

// 期待値は実装と独立に node:crypto で求める
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');
const sha512 = (s: string) => createHash('sha512').update(s).digest('hex');

const A = sha256('a');
const B = sha256('b');

test('GNU形式（テキスト・バイナリ）を行番号付きで解析する', () => {
	const { entries, errors } = parseChecksumList(
		`${A}  a.zip\n${B} *b.tar.gz\n`,
	);
	assert.deepEqual(errors, []);
	assert.deepEqual(entries, [
		{
			lineNumber: 1,
			listedName: 'a.zip',
			baseName: 'a.zip',
			algorithm: 'sha256',
			hash: A,
		},
		{
			lineNumber: 2,
			listedName: 'b.tar.gz',
			baseName: 'b.tar.gz',
			algorithm: 'sha256',
			hash: B,
		},
	]);
});

test('ハッシュ値の長さでアルゴリズムを判定し、大文字は小文字に正規化する', () => {
	const { entries, errors } = parseChecksumList(
		[
			`${md5('x')}  m.bin`,
			`${sha1('x')}  s1.bin`,
			`${sha512('x').toUpperCase()}  s5.bin`,
			'352441c2  c.bin',
		].join('\n'),
	);
	assert.deepEqual(errors, []);
	assert.deepEqual(
		entries.map((e) => [e.algorithm, e.hash]),
		[
			['md5', md5('x')],
			['sha1', sha1('x')],
			['sha512', sha512('x')],
			['crc32', '352441c2'],
		],
	);
});

test('BSD形式（sha256sum --tag・md5・openssl dgst）を解析する', () => {
	const { entries, errors } = parseChecksumList(
		[
			`SHA256 (a.zip) = ${A}`,
			`MD5 (my file (1).txt) = ${md5('x')}`,
			`SHA2-256(c.bin)= ${B}`,
			`sha512 (d.bin) = ${sha512('d')}`,
		].join('\n'),
	);
	assert.deepEqual(errors, []);
	assert.deepEqual(
		entries.map((e) => [e.listedName, e.algorithm]),
		[
			['a.zip', 'sha256'],
			['my file (1).txt', 'md5'],
			['c.bin', 'sha256'],
			['d.bin', 'sha512'],
		],
	);
});

test('BSD形式でアルゴリズム名と長さが食い違う行、未対応の名前はエラーにする', () => {
	const { entries, errors } = parseChecksumList(
		[
			`SHA256 (a.zip) = ${md5('x')}`,
			`SHA384 (b.zip) = ${A}`,
			'SHA256 (c.zip) = abcdef',
		].join('\n'),
	);
	assert.equal(entries.length, 0);
	assert.deepEqual(
		errors.map((e) => [e.lineNumber, e.reason]),
		[
			[1, 'algorithm-mismatch'],
			[2, 'algorithm-mismatch'],
			[3, 'unknown-length'],
		],
	);
});

test('空行・# のコメント・CRLF を扱い、行番号は元の入力どおり', () => {
	const { entries, errors } = parseChecksumList(
		`# SHA256 checksums\r\n\r\n${A}  a.zip\r\n   \r\n${B}  b.zip\r\n`,
	);
	assert.deepEqual(errors, []);
	assert.deepEqual(
		entries.map((e) => [e.lineNumber, e.listedName]),
		[
			[3, 'a.zip'],
			[5, 'b.zip'],
		],
	);
});

test('解釈できない行は捨てずに理由付きで返し、正しい行は残す', () => {
	const { entries, errors } = parseChecksumList(
		[
			`${A}  ok.zip`,
			A,
			`${A} one-space.zip`,
			'abcdef12345  short.zip',
			'これはチェックサムではありません',
			'abcdef1234',
		].join('\n'),
	);
	assert.deepEqual(
		entries.map((e) => e.listedName),
		['ok.zip'],
	);
	assert.deepEqual(
		errors.map((e) => [e.lineNumber, e.reason]),
		[
			[2, 'no-file-name'],
			[3, 'invalid-line'],
			[4, 'unknown-length'],
			[5, 'invalid-line'],
			[6, 'unknown-length'],
		],
	);
	assert.equal(errors[0].line, A);
});

test('GNUのエスケープ（行頭の \\）を戻す', () => {
	const { entries } = parseChecksumList(`\\${A}  dir\\\\a\\nb.zip`);
	assert.equal(entries[0].listedName, 'dir\\a\nb.zip');
});

test('パス付きのファイル名は末尾の名前で照合する', () => {
	assert.equal(checksumBaseName('./dist/app.zip'), 'app.zip');
	assert.equal(checksumBaseName('build\\win\\app.exe'), 'app.exe');
	assert.equal(checksumBaseName('app.zip'), 'app.zip');
	assert.equal(checksumBaseName('./app.zip'), 'app.zip');
	assert.equal(checksumBaseName('dir/'), 'dir/');
	const { entries } = parseChecksumList(`${A}  ./dist/app.zip`);
	assert.equal(entries[0].listedName, './dist/app.zip');
	assert.equal(entries[0].baseName, 'app.zip');
});

test('requiredAlgorithmsForFile: そのファイル名の行のアルゴリズムだけを重複なく返す', () => {
	const { entries } = parseChecksumList(
		[
			`${A}  a.zip`,
			`${md5('a')}  a.zip`,
			`${sha256('a')}  dist/a.zip`,
			`${B}  b.zip`,
		].join('\n'),
	);
	assert.deepEqual(requiredAlgorithmsForFile(entries, 'a.zip').sort(), [
		'md5',
		'sha256',
	]);
	assert.deepEqual(requiredAlgorithmsForFile(entries, 'b.zip'), ['sha256']);
	assert.deepEqual(requiredAlgorithmsForFile(entries, 'c.zip'), []);
});

test('buildChecksumReport: 一致・不一致・未選択・計算中・失敗・同名・記載なしを判定する', () => {
	const { entries } = parseChecksumList(
		[
			`${A.toUpperCase()}  a.zip`,
			`${sha256('wrong')}  b.zip`,
			`${A}  c.zip`,
			`${A}  d.zip`,
			`${A}  e.zip`,
			`${A}  dup.zip`,
		].join('\n'),
	);
	const states = new Map<string, ChecksumFileState>([
		['a.zip', { kind: 'done', results: { sha256: A } }],
		['b.zip', { kind: 'done', results: { sha256: B } }],
		['d.zip', { kind: 'pending' }],
		['e.zip', { kind: 'failed' }],
		['extra.txt', { kind: 'pending' }],
	]);
	const report = buildChecksumReport(
		entries,
		['a.zip', 'b.zip', 'd.zip', 'e.zip', 'dup.zip', 'dup.zip', 'extra.txt'],
		states,
	);
	assert.deepEqual(
		report.rows.map((r) => [r.listedName, r.status]),
		[
			['a.zip', 'match'],
			['b.zip', 'mismatch'],
			['c.zip', 'missing'],
			['d.zip', 'pending'],
			['e.zip', 'failed'],
			['dup.zip', 'duplicate-file'],
		],
	);
	assert.equal(report.rows[1].computed, B);
	assert.equal(report.rows[2].computed, null);
	assert.deepEqual(report.unlistedFiles, ['extra.txt']);
	assert.deepEqual(report.counts, {
		match: 1,
		mismatch: 1,
		missing: 1,
		'duplicate-file': 1,
		pending: 1,
		failed: 1,
	});
});

test('buildChecksumReport: 必要なアルゴリズムが未計算なら一致・不一致にしない', () => {
	const { entries } = parseChecksumList(`${A}  a.zip\n${md5('a')}  a.zip`);
	const report = buildChecksumReport(
		entries,
		['a.zip'],
		new Map([['a.zip', { kind: 'done', results: { sha256: A } }]]),
	);
	assert.deepEqual(
		report.rows.map((r) => r.status),
		['match', 'pending'],
	);
});

test('空の入力では行もエラーもない', () => {
	assert.deepEqual(parseChecksumList(''), { entries: [], errors: [] });
	assert.deepEqual(parseChecksumList('\n\n# comment\n'), {
		entries: [],
		errors: [],
	});
	const report = buildChecksumReport([], ['a.zip'], new Map());
	assert.deepEqual(report.rows, []);
	assert.deepEqual(report.unlistedFiles, ['a.zip']);
});
