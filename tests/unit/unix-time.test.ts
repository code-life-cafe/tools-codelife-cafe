import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	batchRowsToDelimitedText,
	convertBatch,
	detectTimestampCandidates,
	formatTimestamp,
	instantFromExplicitFormat,
	parseDateTimeString,
} from '../../src/lib/tools/unix-time.ts';

test('桁数境界: 10桁は秒、13桁はミリ秒、16桁はマイクロ秒、19桁はナノ秒が最上位候補になる', () => {
	const cases: [string, string][] = [
		['1783385779', 'unix-s'],
		['1783385779123', 'unix-ms'],
		['1783385779123456', 'unix-us'],
		['1783385779123456789', 'unix-ns'],
	];
	for (const [input, expected] of cases) {
		const candidates = detectTimestampCandidates(input);
		assert.ok(candidates.length > 0, `候補が空: ${input}`);
		assert.equal(candidates[0].format, expected, `input=${input}`);
		assert.equal(candidates[0].confidence, 'high');
	}
});

test('桁数境界: 9/11/12/15/18桁でもクラッシュせず候補を返す', () => {
	for (const input of [
		'178338577', // 9桁
		'17833857791', // 11桁
		'178338577912', // 12桁
		'178338577912345', // 15桁
		'178338577912345678', // 18桁
	]) {
		const candidates = detectTimestampCandidates(input);
		assert.ok(candidates.length > 0, `候補が空: ${input}`);
	}
});

test('Slack TS: 1355517523.000005 が2012-12-14T20:38:43.000005Zに変換される', () => {
	const candidates = detectTimestampCandidates('1355517523.000005');
	assert.equal(candidates[0].format, 'slack-ts');
	const outputs = formatTimestamp(candidates[0].instantNanos, 'UTC');
	assert.equal(outputs.isoUtc, '2012-12-14T20:38:43.000005Z');
});

test('既知値: 0 は 1970-01-01T00:00:00Z になる', () => {
	const candidates = detectTimestampCandidates('0');
	const top = candidates.find((c) => c.format === 'unix-s') ?? candidates[0];
	const outputs = formatTimestamp(top.instantNanos, 'UTC');
	assert.equal(outputs.isoUtc, '1970-01-01T00:00:00Z');
});

test('既知値: 1783385779 はJSTで2026-07-07になる', () => {
	const candidates = detectTimestampCandidates('1783385779');
	const outputs = formatTimestamp(candidates[0].instantNanos, 'Asia/Tokyo');
	assert.ok(outputs.isoLocal.startsWith('2026-07-07'));
});

test('負値: -86400 は 1969-12-31 になる', () => {
	const candidates = detectTimestampCandidates('-86400');
	const top = candidates.find((c) => c.format === 'unix-s') ?? candidates[0];
	const outputs = formatTimestamp(top.instantNanos, 'UTC');
	assert.equal(outputs.isoUtc, '1969-12-31T00:00:00Z');
});

test('2038年境界: 2147483647 / 2147483648 が正しく変換される', () => {
	const s1 = detectTimestampCandidates('2147483647').find(
		(c) => c.format === 'unix-s',
	);
	assert.ok(s1);
	assert.equal(
		formatTimestamp(s1.instantNanos, 'UTC').isoUtc,
		'2038-01-19T03:14:07Z',
	);

	const s2 = detectTimestampCandidates('2147483648').find(
		(c) => c.format === 'unix-s',
	);
	assert.ok(s2);
	assert.equal(
		formatTimestamp(s2.instantNanos, 'UTC').isoUtc,
		'2038-01-19T03:14:08Z',
	);
});

test('候補提示: 13桁はミリ秒以外にも解釈候補が複数返る場合がある', () => {
	// 13桁は ms が正準だが、us/ns 解釈でも妥当年代範囲に収まらないため low confidence でも
	// 一覧に含まれ得ることを確認する（実装のフォールバックにより最低1件は保証される）。
	const candidates = detectTimestampCandidates('1783385779123');
	assert.ok(candidates.length >= 1);
	assert.equal(candidates[0].format, 'unix-ms');
});

test('和暦: 昭和/平成/令和の改元境界', () => {
	const heiseiStart = parseDateTimeString('1989-01-08T00:00:00Z', 'UTC');
	const showaEnd = parseDateTimeString('1989-01-07T00:00:00Z', 'UTC');
	const reiwaStart = parseDateTimeString('2019-05-01T00:00:00Z', 'UTC');
	const heiseiEnd = parseDateTimeString('2019-04-30T00:00:00Z', 'UTC');
	assert.ok(heiseiStart && showaEnd && reiwaStart && heiseiEnd);

	assert.match(
		formatTimestamp(heiseiStart.instantNanos, 'UTC').wareki,
		/^平成元年/,
	);
	assert.match(
		formatTimestamp(showaEnd.instantNanos, 'UTC').wareki,
		/^昭和64年/,
	);
	assert.match(
		formatTimestamp(reiwaStart.instantNanos, 'UTC').wareki,
		/^令和元年/,
	);
	assert.match(
		formatTimestamp(heiseiEnd.instantNanos, 'UTC').wareki,
		/^平成31年/,
	);
});

test('逆変換: ISO 8601（オフセット付き/Z）を解釈できる', () => {
	const withZ = parseDateTimeString('2026-07-07T00:56:19Z', 'UTC');
	assert.ok(withZ);
	assert.equal(
		formatTimestamp(withZ.instantNanos, 'UTC').unixSeconds,
		'1783385779',
	);

	const withOffset = parseDateTimeString('2026-07-07T09:56:19+09:00', 'UTC');
	assert.ok(withOffset);
	assert.equal(
		formatTimestamp(withOffset.instantNanos, 'UTC').unixSeconds,
		'1783385779',
	);
});

test('逆変換: RFC 3339 形式を解釈できる', () => {
	const parsed = parseDateTimeString('2026-07-07T09:56:19+09:00', 'UTC');
	assert.ok(parsed);
	assert.equal(
		formatTimestamp(parsed.instantNanos, 'UTC').unixSeconds,
		'1783385779',
	);
});

test('逆変換: YYYY/MM/DD HH:mm:ss をタイムゾーン基準で解釈できる', () => {
	const parsed = parseDateTimeString('2026/07/07 09:56:19', 'Asia/Tokyo');
	assert.ok(parsed);
	assert.equal(
		formatTimestamp(parsed.instantNanos, 'UTC').unixSeconds,
		'1783385779',
	);
});

test('逆変換: YYYY-MM-DD のみの入力は0時として解釈される', () => {
	const parsed = parseDateTimeString('2026-07-07', 'UTC');
	assert.ok(parsed);
	assert.equal(
		formatTimestamp(parsed.instantNanos, 'UTC').isoUtc,
		'2026-07-07T00:00:00Z',
	);
});

test('解釈できない入力は候補・パース結果ともに空になる', () => {
	assert.deepEqual(detectTimestampCandidates('not-a-timestamp'), []);
	assert.equal(parseDateTimeString('not-a-timestamp', 'UTC'), null);
});

test('一括変換: 混在形式・空行・不正行を含む入力を処理できる', () => {
	const input = ['1783385779', '', '2026-07-07T00:56:19Z', 'invalid-line'].join(
		'\n',
	);
	const rows = convertBatch(input, 'UTC');
	assert.equal(rows.length, 3);
	assert.equal(rows[0].ok, true);
	assert.equal(rows[0].unixSeconds, '1783385779');
	assert.equal(rows[1].ok, true);
	assert.equal(rows[1].unixSeconds, '1783385779');
	assert.equal(rows[2].ok, false);
	assert.equal(rows[2].error, '解釈できません');
});

test('一括変換: TSV/CSVへのエクスポートができる', () => {
	const rows = convertBatch('1783385779', 'UTC');
	const tsv = batchRowsToDelimitedText(rows, '\t');
	assert.ok(tsv.includes('入力\t形式\tISO8601(UTC)\tUNIX秒\tUNIXミリ秒'));
	assert.ok(tsv.includes('1783385779'));

	const csv = batchRowsToDelimitedText(rows, ',');
	assert.ok(csv.startsWith('入力,形式'));
});

test('タイムゾーン: JST/UTC/任意TZで出力が異なる', () => {
	const candidates = detectTimestampCandidates('1783385779');
	const instant = candidates[0].instantNanos;
	const jst = formatTimestamp(instant, 'Asia/Tokyo');
	const utc = formatTimestamp(instant, 'UTC');
	const ny = formatTimestamp(instant, 'America/New_York');

	assert.notEqual(jst.isoLocal, utc.isoLocal);
	assert.notEqual(jst.isoLocal, ny.isoLocal);
	assert.ok(jst.isoLocal.endsWith('+09:00'));
	assert.ok(utc.isoLocal.endsWith('Z'));
});

test('Discordタグ: 主要スタイルが出力される', () => {
	const candidates = detectTimestampCandidates('1783385779');
	const outputs = formatTimestamp(candidates[0].instantNanos, 'UTC');
	assert.equal(outputs.discord.F, '<t:1783385779:F>');
	assert.equal(outputs.discord.R, '<t:1783385779:R>');
	assert.equal(outputs.discord.t, '<t:1783385779:t>');
});

test('相対時刻: nowMsを基準に算出される', () => {
	const candidates = detectTimestampCandidates('1783385779');
	const nowMs = 1783385779000 + 3 * 60 * 60 * 1000; // 3時間後を基準
	const outputs = formatTimestamp(candidates[0].instantNanos, 'UTC', nowMs);
	assert.match(outputs.relative, /時間前/);
});

test('ミリ秒端数がISO 8601表示で保持される', () => {
	const candidates = detectTimestampCandidates('1783385779123');
	const top = candidates.find((c) => c.format === 'unix-ms');
	assert.ok(top);
	const outputs = formatTimestamp(top.instantNanos, 'UTC');
	assert.equal(outputs.isoUtc, '2026-07-07T00:56:19.123Z');
	assert.equal(outputs.unixMilliseconds, '1783385779123');
});

test('巨大すぎる数値（Date/Intlで表示不能）は候補が空になる', () => {
	const candidates = detectTimestampCandidates('1'.repeat(35));
	assert.deepEqual(candidates, []);
});

test('WebMCP明示形式: 小数はUNIX秒/Slack TS以外では拒否される', () => {
	assert.equal(instantFromExplicitFormat('1783385779123.5', 'unix-ms'), null);
	assert.notEqual(instantFromExplicitFormat('1783385779.5', 'unix-s'), null);
});

test('負の小数秒がunixSecondsで正しい符号・値になる', () => {
	const negativeHalfSecond = -500_000_000n;
	const outputs = formatTimestamp(negativeHalfSecond, 'UTC');
	assert.equal(outputs.unixSeconds, '-0.500');

	const negativeOneAndHalf = -1_500_000_000n;
	const outputsB = formatTimestamp(negativeOneAndHalf, 'UTC');
	assert.equal(outputsB.unixSeconds, '-1.500');
});

test('Discordタグは四捨五入せず切り捨てた秒を使う', () => {
	const nearlyNextSecond = 1_783_385_779_900_000_000n; // 1783385779.9秒
	const outputs = formatTimestamp(nearlyNextSecond, 'UTC');
	assert.equal(outputs.unixSeconds, '1783385779.900');
	assert.equal(outputs.discord.F, '<t:1783385779:F>');
});

test('逆変換: 存在しない日時コンポーネントは拒否される', () => {
	assert.equal(parseDateTimeString('2026-02-31T00:00:00Z', 'UTC'), null);
	assert.equal(parseDateTimeString('2026-07-07T25:61:61Z', 'UTC'), null);
	assert.equal(parseDateTimeString('2026/13/01 00:00:00', 'UTC'), null);
});
