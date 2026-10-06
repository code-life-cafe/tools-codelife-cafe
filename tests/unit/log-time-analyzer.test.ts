import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	analyzeLog,
	buildCsv,
	extractToken,
	formatMs,
	MAX_LINES,
	parseTimestamp,
	sanitizeCsvCell,
} from '../../src/lib/tools/log-time-analyzer.ts';

function analyze(text: string, format: 'iso' | 'unix-s' | 'unix-ms' = 'iso') {
	const r = analyzeLog(text, format);
	assert.ok(r.ok, r.ok ? '' : r.error);
	return r.value;
}

test('log-time: 空入力は有効行0', () => {
	const v = analyze('');
	assert.equal(v.validCount, 0);
	assert.equal(v.diffs.length, 0);
});

test('log-time: 有効行が1件だけなら差分なし', () => {
	const v = analyze('2026-01-01T00:00:00Z start');
	assert.equal(v.validCount, 1);
	assert.equal(v.diffs.length, 0);
});

test('log-time: 全行不正なら行番号と件数を返す', () => {
	const v = analyze('foo\nbar\n[oops');
	assert.equal(v.validCount, 0);
	assert.deepEqual(
		v.invalidLines.map((l) => l.line),
		[1, 2, 3],
	);
});

test('log-time: 同時刻は差分0として数える', () => {
	const v = analyze('2026-01-01T00:00:00Z a\n2026-01-01T00:00:00Z b');
	assert.equal(v.zeroCount, 1);
	assert.equal(v.top.length, 0);
	assert.equal(v.diffs[0]?.diffMs, '0');
});

test('log-time: 逆順は順序逆転として別扱い', () => {
	const v = analyze('2026-01-01T00:00:05Z a\n2026-01-01T00:00:02Z b');
	assert.equal(v.reversed.length, 1);
	assert.equal(v.reversed[0]?.diffMs, '-3000');
	assert.equal(v.top.length, 0);
});

test('log-time: オフセットを考慮して差を計算する', () => {
	const v = analyze(
		'2026-01-01T09:00:00+09:00 a\n2026-01-01T00:00:01Z b\n[2026-01-01T09:30:00.000+0900] c',
	);
	assert.deepEqual(
		v.diffs.map((d) => d.diffMs),
		['1000', '1799000'],
	);
});

test('log-time: 小数秒を正確に扱う', () => {
	const v = analyze(
		'2026-01-01T00:00:00.100Z a\n2026-01-01T00:00:00.1005Z b\n2026-01-01T00:00:01,250Z c',
	);
	assert.deepEqual(
		v.diffs.map((d) => d.diffMs),
		['0.5', '1149.5'],
	);
	assert.equal(formatMs(1n), '0.001');
	assert.equal(formatMs(-1500n), '-1.5');
});

test('log-time: UNIX秒・ミリ秒を明示形式で解析する', () => {
	const s = analyze('1700000000.5 a\n1700000002 b', 'unix-s');
	assert.equal(s.diffs[0]?.diffMs, '1500');
	const ms = analyze('1700000000000 a\n[1700000000250.5] b', 'unix-ms');
	assert.equal(ms.diffs[0]?.diffMs, '250.5');
	// 形式が違えば解析できない
	assert.equal(analyze('2026-01-01T00:00:00Z a', 'unix-s').validCount, 0);
	assert.equal(analyze('1700000000 a', 'iso').validCount, 0);
});

test('log-time: マイクロ秒より細かい桁は明示した精度で切り捨てる', () => {
	const iso = analyze(
		'2026-01-01T00:00:00.1234561Z a\n2026-01-01T00:00:00.1234579Z b',
	);
	assert.equal(iso.diffs[0]?.diffMs, '0.001');
	assert.equal(
		analyze('0.1234561 a\n0.1234579 b', 'unix-s').diffs[0]?.diffMs,
		'0.001',
	);
	assert.equal(
		analyze('0.1231 a\n0.1249 b', 'unix-ms').diffs[0]?.diffMs,
		'0.001',
	);
	assert.equal(parseTimestamp('-1', 'unix-s').ok, false);
});

test('log-time: 上位10件は降順で、同値は元の順', () => {
	const lines: string[] = [];
	let t = 0;
	const gaps = [5, 5, 9, 1, 3, 7, 2, 8, 4, 6, 10, 11, 12];
	lines.push('0 start');
	for (const g of gaps) {
		t += g;
		lines.push(`${t} x`);
	}
	const v = analyze(lines.join('\n'), 'unix-s');
	assert.equal(v.top.length, 10);
	assert.deepEqual(
		v.top.map((d) => d.diffMs),
		[12, 11, 10, 9, 8, 7, 6, 5, 5, 4].map((n) => String(n * 1000)),
	);
	// 同値(5秒)は行番号の小さい方が先
	assert.ok((v.top[7]?.toLine ?? 0) < (v.top[8]?.toLine ?? 0));
});

test('log-time: 不正行・空行を挟んだ差分に注記フラグが付く', () => {
	const v = analyze('2026-01-01T00:00:00Z a\nnotime\n\n2026-01-01T00:00:10Z b');
	assert.equal(v.diffs[0]?.skippedBetween, true);
	assert.equal(v.diffs[0]?.fromLine, 1);
	assert.equal(v.diffs[0]?.toLine, 4);
	assert.equal(v.blankLines, 1);
	assert.deepEqual(v.invalidLines, [
		{
			line: 2,
			reason: 'ISO 8601（Zまたはオフセット付き）の形式ではありません',
		},
	]);
});

test('log-time: 存在しない日時・オフセット無しは不正', () => {
	for (const t of [
		'2026-02-30T00:00:00Z',
		'2026-13-01T00:00:00Z',
		'2026-01-01T24:00:00Z',
		'2026-01-01T00:00:60Z',
		'2026-01-01T00:00:00',
		'2026-01-01 00:00:00Z',
		'2026-01-01T00:00:00+24:00',
	]) {
		assert.equal(parseTimestamp(t, 'iso').ok, false, t);
	}
	assert.equal(parseTimestamp('2024-02-29T00:00:00Z', 'iso').ok, true);
	assert.equal(parseTimestamp('2026-02-29T00:00:00Z', 'iso').ok, false);
});

test('log-time: 先頭トークンの抽出（角括弧・前置空白）', () => {
	assert.deepEqual(extractToken('  [ 2026-01-01T00:00:00Z ] msg'), {
		ok: true,
		token: '2026-01-01T00:00:00Z',
	});
	assert.equal(extractToken('[abc').ok, false);
	assert.equal(extractToken('[] x').ok, false);
});

test('log-time: 行数・サイズの上限', () => {
	const many = Array.from({ length: MAX_LINES + 1 }, () => '0 x').join('\n');
	assert.equal(analyzeLog(many, 'unix-s').ok, false);
	const atLimit = Array.from({ length: MAX_LINES }, (_, i) => `${i} x`).join(
		'\n',
	);
	assert.equal(analyzeLog(atLimit, 'unix-s').ok, true);
	assert.equal(analyzeLog('a'.repeat(1024 * 1024 + 1), 'iso').ok, false);
});

test('log-time: CRLF/CRでも行番号が正しい', () => {
	const v = analyze('0 a\r\nx\r1 b', 'unix-s');
	assert.deepEqual(
		v.invalidLines.map((l) => l.line),
		[2],
	);
	assert.equal(v.diffs[0]?.toLine, 3);
});

test('log-time: CSVは数式注入を防ぎ、本文を含めない', () => {
	assert.equal(sanitizeCsvCell('=1+1'), "'=1+1");
	assert.equal(sanitizeCsvCell('@x'), "'@x");
	assert.equal(sanitizeCsvCell('-1'), "'-1");
	assert.equal(sanitizeCsvCell('2026'), '2026');
	const csv = buildCsv([
		{
			fromLine: 1,
			toLine: 2,
			fromToken: '=cmd|x',
			toToken: '+SUM(1)',
			diffMs: '-5',
			diffMicros: -5000n,
			skippedBetween: false,
		},
	]);
	assert.ok(csv.startsWith('﻿前の行番号,'));
	assert.ok(csv.includes("'=cmd|x"));
	assert.ok(csv.includes("'+SUM(1)"));
	assert.ok(csv.includes(',-5,順序逆転,いいえ'));
	assert.ok(csv.endsWith('\r\n'));
});
