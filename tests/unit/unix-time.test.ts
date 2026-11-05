import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	batchRowsToDelimitedText,
	convertBatch,
	detectTimestampCandidates,
	formatTimestamp,
	instantFromExplicitFormat,
	isValidTimeZone,
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

test('逆変換: DST開始で存在しない現地時刻は拒否される（#582）', () => {
	for (const input of [
		'2024-03-10T02:00:00',
		'2024-03-10 02:30:00',
		'2024-03-10T02:59:59.999999999',
		'2024/03/10 02:30:00',
	]) {
		assert.equal(parseDateTimeString(input, 'America/New_York'), null, input);
	}
});

test('逆変換: DST開始の前後に実在する現地時刻と端数を保持する（#582）', () => {
	const cases = [
		[
			'2024-03-10 01:30:00',
			'2024-03-10T06:30:00Z',
			'2024-03-10T01:30:00-05:00',
		],
		[
			'2024-03-10T01:59:59.999999999',
			'2024-03-10T06:59:59.999999999Z',
			'2024-03-10T01:59:59.999999999-05:00',
		],
		[
			'2024-03-10T03:00:00',
			'2024-03-10T07:00:00Z',
			'2024-03-10T03:00:00-04:00',
		],
		[
			'2024-03-10 03:30:00',
			'2024-03-10T07:30:00Z',
			'2024-03-10T03:30:00-04:00',
		],
		[
			'2024/03/10 01:30:00',
			'2024-03-10T06:30:00Z',
			'2024-03-10T01:30:00-05:00',
		],
		[
			'2024/03/10 03:30:00',
			'2024-03-10T07:30:00Z',
			'2024-03-10T03:30:00-04:00',
		],
	];
	for (const [input, isoUtc, isoLocal] of cases) {
		const parsed = parseDateTimeString(input, 'America/New_York');
		assert.ok(parsed, input);
		assert.equal(parsed.hasExplicitOffset, false);
		const outputs = formatTimestamp(parsed.instantNanos, 'America/New_York');
		assert.equal(outputs.isoUtc, isoUtc, input);
		assert.equal(outputs.isoLocal, isoLocal, input);
	}
});

test('逆変換: DST終了の重複時刻は明示オフセットで区別する（#582）', () => {
	for (const [input, isoUtc] of [
		['2024-11-03T01:30:00-04:00', '2024-11-03T05:30:00Z'],
		['2024-11-03T01:30:00-05:00', '2024-11-03T06:30:00Z'],
	]) {
		const parsed = parseDateTimeString(input, 'America/New_York');
		assert.ok(parsed, input);
		assert.equal(parsed.hasExplicitOffset, true);
		const outputs = formatTimestamp(parsed.instantNanos, 'America/New_York');
		assert.equal(outputs.isoUtc, isoUtc, input);
		assert.equal(outputs.isoLocal, input);
	}
});

test('逆変換: DST欠落時間帯でも明示オフセットを優先する（#582）', () => {
	const parsed = parseDateTimeString(
		'2024-03-10T02:30:00-05:00',
		'America/New_York',
	);
	assert.ok(parsed);
	assert.equal(parsed.hasExplicitOffset, true);
	assert.equal(
		formatTimestamp(parsed.instantNanos, 'UTC').isoUtc,
		'2024-03-10T07:30:00Z',
	);
});

test('逆変換・一括変換: UTCと東京では同じ日時を有効な時刻として扱う（#582）', () => {
	const inputs = ['2024-03-10 02:30:00', '2024/03/10 02:30:00'];
	for (const [timeZone, isoUtc] of [
		['UTC', '2024-03-10T02:30:00Z'],
		['Asia/Tokyo', '2024-03-09T17:30:00Z'],
	]) {
		for (const input of inputs) {
			const parsed = parseDateTimeString(input, timeZone);
			assert.ok(parsed, `${timeZone}: ${input}`);
			assert.equal(
				formatTimestamp(parsed.instantNanos, timeZone).isoUtc,
				isoUtc,
			);
		}
		const rows = convertBatch(inputs.join('\n'), timeZone);
		assert.equal(rows.length, inputs.length);
		for (const row of rows) {
			assert.equal(row.ok, true);
			assert.equal(row.isoUtc, isoUtc);
		}
	}
});

test('一括変換: DSTの欠落時刻だけエラーにして前後・重複時刻を保持する（#582）', () => {
	const inputs = [
		'2024-03-10 01:30:00',
		'2024-03-10 02:30:00',
		'2024/03/10 02:30:00',
		'2024-03-10 03:30:00',
		'2024-11-03T01:30:00-04:00',
		'2024-11-03T01:30:00-05:00',
	];
	const rows = convertBatch(inputs.join('\n'), 'America/New_York');
	assert.equal(rows.length, inputs.length);
	for (const index of [1, 2]) {
		assert.deepEqual(rows[index], {
			input: inputs[index],
			ok: false,
			formatLabel: '',
			isoUtc: '',
			unixSeconds: '',
			unixMilliseconds: '',
			error: '解釈できません',
		});
	}
	for (const [index, isoUtc] of [
		[0, '2024-03-10T06:30:00Z'],
		[3, '2024-03-10T07:30:00Z'],
		[4, '2024-11-03T05:30:00Z'],
		[5, '2024-11-03T06:30:00Z'],
	] as const) {
		assert.equal(rows[index].ok, true);
		assert.equal(rows[index].isoUtc, isoUtc);
	}
});

test('isValidTimeZone: 有効・無効なタイムゾーン判定とformatTimestampでの安全なフォールバック', () => {
	assert.equal(isValidTimeZone('Asia/Tokyo'), true);
	assert.equal(isValidTimeZone('UTC'), true);
	assert.equal(isValidTimeZone('America/New_York'), true);
	assert.equal(isValidTimeZone('Invalid/TimeZone'), false);
	assert.equal(isValidTimeZone(''), false);
	assert.equal(isValidTimeZone('null'), false);

	// 不正なタイムゾーンでもクラッシュせず Asia/Tokyo にフォールバックしてフォーマットされる
	const outputs = formatTimestamp(1783385779000000000n, 'Invalid/TimeZone');
	assert.ok(outputs.isoLocal.includes('+09:00'));
});

// #586: ミリ秒を含む時刻でタイムゾーンオフセットが壊れる回帰
test('ミリ秒を含む時刻でもISO/RFC3339のオフセットが正しい（#586）', () => {
	const ms123 = 1_700_000_000_123n * 1_000_000n;
	const tokyo = formatTimestamp(ms123, 'Asia/Tokyo');
	assert.equal(tokyo.isoLocal, '2023-11-15T07:13:20.123+09:00');
	assert.equal(tokyo.rfc3339, '2023-11-15T07:13:20.123+09:00');

	const utc = formatTimestamp(ms123, 'UTC');
	assert.equal(utc.isoUtc, '2023-11-14T22:13:20.123Z');
	assert.equal(utc.rfc3339, '2023-11-14T22:13:20.123+00:00');

	assert.equal(
		formatTimestamp(ms123, 'America/New_York').rfc3339,
		'2023-11-14T17:13:20.123-05:00',
	);
	assert.equal(
		formatTimestamp(ms123, 'Asia/Kolkata').rfc3339,
		'2023-11-15T03:43:20.123+05:30',
	);
	assert.equal(
		formatTimestamp(ms123, 'Asia/Kathmandu').rfc3339,
		'2023-11-15T03:58:20.123+05:45',
	);
	// 負のタイムスタンプ（1970年以前）でも端数でオフセットが崩れない
	assert.equal(
		formatTimestamp(-1_700_000_000_123n * 1_000_000n, 'Asia/Tokyo').rfc3339,
		'1916-02-18T10:46:39.877+09:00',
	);
	// マイクロ秒・ナノ秒の端数でも同じ
	assert.equal(
		formatTimestamp(1_700_000_000_123_456_789n, 'Asia/Tokyo').rfc3339,
		'2023-11-15T07:13:20.123456789+09:00',
	);
});

test('秒未満の有無でオフセットが変わらない（#586）', () => {
	for (const tz of ['Asia/Tokyo', 'America/New_York', 'Asia/Kathmandu']) {
		const whole = formatTimestamp(1_700_000_000_000n * 1_000_000n, tz).rfc3339;
		const frac = formatTimestamp(1_700_000_000_999n * 1_000_000n, tz).rfc3339;
		assert.equal(whole.slice(-6), frac.slice(-6), tz);
	}
});

test('一括変換でもミリ秒入力のUTC表記が正しい（#586）', () => {
	const rows = convertBatch('1700000000123', 'Asia/Tokyo');
	assert.equal(rows[0].ok, true);
	assert.equal(rows[0].isoUtc, '2023-11-14T22:13:20.123Z');
});

// #587: 範囲外の小数タイムスタンプで例外が起き、UI全体が消える回帰
test('範囲外の小数は例外にせず解釈不能（候補なし）にする（#587）', () => {
	assert.deepEqual(detectTimestampCandidates('99999999999999999999.1'), []);
	assert.deepEqual(detectTimestampCandidates('-99999999999999999999.1'), []);
	assert.deepEqual(detectTimestampCandidates('8640000000000.5'), []);
	assert.deepEqual(detectTimestampCandidates('-8640000000000.5'), []);
});

test('Dateで表示できる範囲内の小数・整数は従来どおり解釈する（#587）', () => {
	const decimal = detectTimestampCandidates('1700000000.5');
	assert.equal(decimal.length, 1);
	assert.doesNotThrow(() => formatTimestamp(decimal[0].instantNanos, 'UTC'));

	const negative = detectTimestampCandidates('-1700000000.5');
	assert.equal(negative.length, 1);
	assert.equal(
		formatTimestamp(negative[0].instantNanos, 'UTC').unixSeconds,
		'-1700000000.500',
	);

	// 境界の内側（約27万年先）は低確度として扱い、例外を起こさない
	const nearMax = detectTimestampCandidates('8639999000000.5');
	assert.equal(nearMax.length, 1);
	assert.equal(nearMax[0].confidence, 'low');
	assert.doesNotThrow(() =>
		formatTimestamp(nearMax[0].instantNanos, 'Asia/Tokyo'),
	);
	assert.doesNotMatch(
		formatTimestamp(nearMax[0].instantNanos, 'Asia/Tokyo').rfc3339,
		/NaN/,
	);

	// どの単位でも表示できない巨大な整数は従来どおり候補なし
	assert.deepEqual(detectTimestampCandidates('9'.repeat(30)), []);
});

test('一括変換で範囲外の行だけエラーにし、正常な行は残す（#587）', () => {
	const rows = convertBatch(
		'1700000000\n99999999999999999999.1\n2023-11-15T07:13:20+09:00',
		'Asia/Tokyo',
	);
	assert.equal(rows.length, 3);
	assert.equal(rows[0].ok, true);
	assert.equal(rows[0].isoUtc, '2023-11-14T22:13:20Z');
	assert.equal(rows[1].ok, false);
	assert.equal(rows[1].error, '解釈できません');
	assert.equal(rows[2].ok, true);
	assert.equal(rows[2].unixSeconds, '1700000000');
});

test('WebMCP明示形式: Dateで表示できない範囲外の値はnullを返す（#587）', () => {
	assert.equal(
		instantFromExplicitFormat('99999999999999999999.1', 'unix-s'),
		null,
	);
	assert.equal(
		instantFromExplicitFormat('99999999999999999999', 'unix-ms'),
		null,
	);
	assert.notEqual(instantFromExplicitFormat('1700000000123', 'unix-ms'), null);
});

test('紀元前の小数秒は候補なしにする（#606）', () => {
	for (const input of [
		'-62135596800.000000001', // 0001-01-01T00:00:00Z の1ナノ秒前
		'-62167219200.0', // 0000-01-01T00:00:00Z
		'-62200000000.5', // 負の年
	]) {
		assert.deepEqual(detectTimestampCandidates(input), [], input);
	}
});

test('整数フォールバックでも紀元前の候補を返さない（#606）', () => {
	// 最小単位のナノ秒でも1年より前なので、他の単位にも有効候補はない。
	for (const input of ['-62135596800000000001', '-62167219200000000000']) {
		assert.deepEqual(detectTimestampCandidates(input), [], input);
	}
});

test('WebMCP明示形式でも紀元前はnullにする（#606）', () => {
	for (const [input, format] of [
		['-62135596801', 'unix-s'],
		['-62135596800001', 'unix-ms'],
		['-62135596800000001', 'unix-us'],
		['-62135596800000000001', 'unix-ns'],
		['-62135596800.000000001', 'unix-s'],
		['-62135596800.000000001', 'slack-ts'],
	] as const) {
		assert.equal(instantFromExplicitFormat(input, format), null, format);
	}
});

test('年の下限ちょうどは数値入力の有効候補として保持する（#606）', () => {
	const startOfYearOne = -62_135_596_800_000_000_000n;
	assert.equal(
		detectTimestampCandidates('-62135596800.0')[0]?.instantNanos,
		startOfYearOne,
	);
	assert.equal(
		detectTimestampCandidates(startOfYearOne.toString())[0]?.instantNanos,
		startOfYearOne,
	);
	assert.equal(
		instantFromExplicitFormat('-62135596800', 'unix-s'),
		startOfYearOne,
	);
});

test('一括変換: 紀元前の入力は既存エラーにし、正常行は保持する（#606）', () => {
	const inputs = [
		'1700000000',
		'-62135596800.000000001',
		'-62135596800000000001',
		'0000-01-01T00:00:00Z',
		'0000/01/01 00:00:00',
		'2023-11-15T07:13:20+09:00',
	];
	const rows = convertBatch(inputs.join('\n'), 'Asia/Tokyo');
	assert.equal(rows.length, inputs.length);
	for (const index of [1, 2, 3, 4]) {
		assert.deepEqual(rows[index], {
			input: inputs[index],
			ok: false,
			formatLabel: '',
			isoUtc: '',
			unixSeconds: '',
			unixMilliseconds: '',
			error: '解釈できません',
		});
	}
	for (const index of [0, 5]) {
		assert.equal(rows[index].ok, true);
		assert.equal(rows[index].isoUtc, '2023-11-14T22:13:20Z');
	}
});

for (const [timeZone, utc, local, offset] of [
	['Asia/Kolkata', '1890-01-01T00:00:00', '1890-01-01T05:21:10', '+05:21:10'],
	['Asia/Tokyo', '1696-01-01T00:00:00', '1696-01-01T09:18:59', '+09:18:59'],
	[
		'America/New_York',
		'1880-01-01T00:00:00',
		'1879-12-31T19:03:58',
		'-04:56:02',
	],
]) {
	test(`LMTのオフセット秒と小数秒を丸めず保持する: ${timeZone} ${utc}（#606）`, () => {
		const instant = BigInt(Date.parse(`${utc}Z`)) * 1_000_000n;
		for (const [nanos, fractional] of [
			[0n, ''],
			[123_000_000n, '.123'],
			[123_456_789n, '.123456789'],
		] as const) {
			const outputs = formatTimestamp(instant + nanos, timeZone);
			assert.equal(outputs.isoUtc, `${utc}${fractional}Z`);
			assert.equal(outputs.isoLocal, `${local}${fractional}${offset}`);
			assert.equal(outputs.rfc3339, `${local}${fractional}${offset}`);
			// オフセットを省略した壁時計入力でも、LMTの秒差を保持する。
			const parsed = parseDateTimeString(`${local}${fractional}`, timeZone);
			assert.equal(parsed?.instantNanos, instant + nanos);
		}
	});
}

test('現行標準時は秒0を省略して従来のオフセット表示を保つ（#606）', () => {
	const instant = 1_700_000_000_123_456_789n;
	for (const [timeZone, local, offset] of [
		['Asia/Tokyo', '2023-11-15T07:13:20.123456789', '+09:00'],
		['Asia/Kolkata', '2023-11-15T03:43:20.123456789', '+05:30'],
		['Asia/Kathmandu', '2023-11-15T03:58:20.123456789', '+05:45'],
		['America/New_York', '2023-11-14T17:13:20.123456789', '-05:00'],
		['UTC', '2023-11-14T22:13:20.123456789', '+00:00'],
	]) {
		const outputs = formatTimestamp(instant, timeZone);
		assert.equal(outputs.isoUtc, '2023-11-14T22:13:20.123456789Z');
		assert.equal(
			outputs.isoLocal,
			`${local}${timeZone === 'UTC' ? 'Z' : offset}`,
		);
		assert.equal(outputs.rfc3339, `${local}${offset}`);
	}
});
