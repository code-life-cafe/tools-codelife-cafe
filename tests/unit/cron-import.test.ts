import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
	getNextRunTimes,
	parseCronExpression,
	toSystemdOnCalendar,
} from '../../src/lib/tools/cron-checker.ts';
import {
	importScheduleExpression,
	type ScheduleImportSuccess,
	shiftUtcCronToJst,
} from '../../src/lib/tools/cron-import.ts';

function ok(text: string): ScheduleImportSuccess {
	const r = importScheduleExpression(text);
	assert.equal(r.success, true, r.success ? '' : r.error);
	return r as ScheduleImportSuccess;
}

function err(text: string): string {
	const r = importScheduleExpression(text);
	assert.equal(r.success, false, `失敗するはず: ${text}`);
	return r.success ? '' : r.error;
}

const FROM = new Date(Date.UTC(2027, 0, 1, 0, 0, 0));

function runs(expr: string, timeZone: string, count = 60) {
	return getNextRunTimes(parseCronExpression(expr), {
		count,
		from: FROM,
		timeZone,
	}).map((d) => d.toISOString());
}

/** 換算後のJST式が、元のUTC式と同じ日時に実行されることを確かめる */
function assertSameRuns(utcExpr: string, jstExpr: string) {
	assert.deepEqual(runs(jstExpr, 'Asia/Tokyo'), runs(utcExpr, 'UTC'));
}

// --- 入力判定 ---

test('空・未対応の形式はエラーを返す', () => {
	assert.match(err(''), /入力してください/);
	assert.match(err('   '), /入力してください/);
	assert.match(err('0 9 * * 1'), /cron\(\.\.\.\)/);
	assert.match(err('at(2027-01-01T00:00:00)'), /cron\(\.\.\.\)/);
	assert.match(err('cron(0 9 ? * MON *'), /「\)」で閉じて/);
	assert.match(err('Mon *-*-* 09:00:00'), /OnCalendar=/);
});

// --- AWS EventBridge cron() ---

test('EventBridgeの平日9時（UTC）をJSTの18時に換算する', () => {
	const r = ok('cron(0 9 ? * MON-FRI *)');
	assert.equal(r.format, 'aws-cron');
	assert.equal(r.sourceExpr, '0 9 * * MON-FRI');
	assert.equal(r.sourceTimeZone, 'UTC');
	assert.equal(r.jstExpr, '0 18 * * MON-FRI');
	assert.ok(r.notes.some((n) => n.includes('UTC')));
	assertSameRuns(r.sourceExpr as string, r.jstExpr as string);
});

test('EventBridgeの曜日の数値（1=日曜〜7=土曜）を標準cronへ変換する', () => {
	assert.equal(ok('cron(0 1 ? * 2-6 *)').sourceExpr, '0 1 * * 1-5');
	assert.equal(ok('cron(0 1 ? * 1,7 *)').sourceExpr, '0 1 * * 0,6');
	// 「開始/幅」は土曜までで、日曜（7）を足さない
	const step = ok('cron(0 1 ? * 2/2 *)').sourceExpr as string;
	assert.equal(step, '0 1 * * 1-6/2');
	assert.deepEqual(parseCronExpression(step).daysOfWeek.values, [1, 3, 5]);
	// 「*/2」はAWSでは日・火・木・土（1,3,5,7）
	const all = ok('cron(0 1 ? * */2 *)').sourceExpr as string;
	assert.deepEqual(parseCronExpression(all).daysOfWeek.values, [0, 2, 4, 6]);
	assert.equal(ok('cron(0 1 ? * sun,Sat *)').sourceExpr, '0 1 * * SUN,SAT');
});

test('EventBridgeの日指定と月名を読み込む', () => {
	const r = ok('cron(15 10 1 JAN,JUL ? *)');
	assert.equal(r.sourceExpr, '15 10 1 JAN,JUL *');
	assert.equal(r.jstExpr, '15 19 1 JAN,JUL *');
	assertSameRuns(r.sourceExpr as string, r.jstExpr as string);
});

test('EventBridgeの日と曜日の「?」の規則に反する式はエラーにする', () => {
	assert.match(err('cron(0 9 * * MON *)'), /どちらか一方を「\?」/);
	assert.match(err('cron(0 9 ? * ? *)'), /両方を「\?」にはできません/);
	assert.match(err('cron(0 ? * * ? *)'), /日または曜日のフィールドにだけ/);
	assert.match(err('cron(0 9 1,? * ? *)'), /両方を「\?」|単独で指定/);
});

test('EventBridgeの L・W・# は未対応としてエラーにする', () => {
	assert.match(err('cron(0 9 L * ? *)'), /「L」（月末）/);
	assert.match(err('cron(0 9 15W * ? *)'), /「W」/);
	assert.match(err('cron(0 9 ? * 2#1 *)'), /「#」/);
	assert.match(err('cron(0 9 ? * 6L *)'), /最終曜日/);
	// 曜日名・月名に含まれる L・W は対象外
	assert.equal(ok('cron(0 9 ? JUL WED *)').sourceExpr, '0 9 * JUL WED');
});

test('EventBridgeのフィールド数・値の誤りはエラーにする', () => {
	assert.match(err('cron(0 9 * * ?)'), /6フィールド.*5個/);
	assert.match(err('cron()'), /0個/);
	assert.match(err('cron(0 9 ? * 8 *)'), /1（日曜）〜7（土曜）/);
	assert.match(err('cron(0 9 ? * 0 *)'), /1（日曜）〜7（土曜）/);
	assert.match(err('cron(0 9 ? * FOO *)'), /解釈できません/);
	assert.match(err('cron(0 25 ? * MON *)'), /0〜23/);
	assert.match(err('cron(0 9 ? * MON abc)'), /年フィールド/);
});

test('EventBridgeの年の指定は反映しない旨を注意する', () => {
	const r = ok('cron(0 9 ? * MON 2027-2028)');
	assert.equal(r.sourceExpr, '0 9 * * MON');
	assert.ok(r.notes.some((n) => n.includes('年の指定（2027-2028）')));
	assert.ok(
		!ok('cron(0 9 ? * MON *)').notes.some((n) => n.includes('年の指定')),
	);
});

// --- AWS EventBridge rate() ---

test('rate式をcron式の目安へ換算する', () => {
	const cases: [string, string | null][] = [
		['rate(1 minute)', '* * * * *'],
		['rate(5 minutes)', '*/5 * * * *'],
		['rate(30 minutes)', '*/30 * * * *'],
		['rate(60 minutes)', '0 * * * *'],
		['rate(120 minutes)', '0 */2 * * *'],
		['rate(1 hour)', '0 * * * *'],
		['rate(6 hours)', '0 */6 * * *'],
		['rate(24 hours)', '0 0 * * *'],
		['rate(1 day)', '0 0 * * *'],
		['rate(7 minutes)', null],
		['rate(5 hours)', null],
		['rate(2 days)', null],
	];
	for (const [input, expected] of cases) {
		const r = ok(input);
		assert.equal(r.format, 'aws-rate');
		assert.equal(r.jstExpr, expected, input);
		assert.equal(r.sourceExpr, expected, input);
		assert.equal(r.sourceTimeZone, null);
		assert.ok(r.notes[0].includes('起点'), input);
		assert.equal(
			r.notes.some((n) => n.includes('同じ間隔で表せません')),
			expected === null,
			input,
		);
	}
});

test('rate式の単数・複数形と値の誤りはエラーにする', () => {
	assert.match(err('rate(1 minutes)'), /単数形/);
	assert.match(err('rate(5 minute)'), /複数形/);
	assert.match(err('rate(0 minutes)'), /1以上/);
	assert.match(err('rate(5 weeks)'), /単位「weeks」/);
	assert.match(err('rate(five minutes)'), /rate\(値 単位\)/);
	assert.match(err('rate(-1 minutes)'), /rate\(値 単位\)/);
});

// --- GitHub Actions ---

test('GitHub Actionsのscheduleを抽出し、timezoneがなければUTCとして換算する', () => {
	const r = ok(`on:
  schedule:
    - cron: '30 0 * * 1-5'
  workflow_dispatch:`);
	assert.equal(r.format, 'github-actions');
	assert.equal(r.sourceExpr, '30 0 * * 1-5');
	assert.equal(r.sourceTimeZone, 'UTC');
	assert.equal(r.jstExpr, '30 9 * * 1-5');
	assert.ok(r.notes[0].includes('既定どおりUTC'));
	assert.ok(r.notes.some((n) => n.includes('遅れたり')));
	assert.ok(!r.notes.some((n) => n.includes('最短5分')));
});

test('GitHub Actionsのcronは引用符なし・二重引用符・行末コメントも読める', () => {
	assert.equal(ok('- cron: "0 3 * * *"').sourceExpr, '0 3 * * *');
	assert.equal(ok('cron: 0 3 * * *   # 毎日').sourceExpr, '0 3 * * *');
	assert.equal(ok("  - cron: '0 3 * * *' # 毎日").sourceExpr, '0 3 * * *');
});

test('GitHub Actionsのtimezoneに応じて換算する', () => {
	const tokyo = ok("- cron: '0 9 * * 1'\n  timezone: 'Asia/Tokyo'");
	assert.equal(tokyo.sourceTimeZone, 'Asia/Tokyo');
	assert.equal(tokyo.jstExpr, '0 9 * * 1');
	const utc = ok("- cron: '0 9 * * 1'\n  timezone: Etc/UTC");
	assert.equal(utc.sourceTimeZone, 'UTC');
	assert.equal(utc.jstExpr, '0 18 * * 1');
	const ny = ok('- cron: \'0 9 * * 1\'\n  timezone: "America/New_York"');
	assert.equal(ny.sourceTimeZone, 'America/New_York');
	assert.equal(ny.jstExpr, null);
	assert.ok(ny.notes[0].includes('換算はしていません'));
	assert.match(err("- cron: '0 9 * * 1'\n  timezone: Mars/Base"), /timezone/);
});

test('timezoneは最初のcronと同じschedule項目のものだけを使う（回帰: 別項目・stepのtimezoneを拾わない）', () => {
	// 別の項目のtimezoneは1件目に適用しない（1件目はUTC）
	const other = ok(
		"- cron: '0 1 * * *'\n- cron: '0 2 * * *'\n  timezone: 'Asia/Tokyo'",
	);
	assert.equal(other.sourceTimeZone, 'UTC');
	assert.equal(other.jstExpr, '0 10 * * *');
	// stepの with: にある timezone は使わない
	const workflow = ok(`on:
  schedule:
    - cron: '0 0 * * *'
jobs:
  build:
    steps:
      - uses: example/action@v1
        with:
          timezone: America/New_York`);
	assert.equal(workflow.sourceTimeZone, 'UTC');
	assert.equal(workflow.jstExpr, '0 9 * * *');
	// 同じ項目内なら、cronの前後どちらにあっても使う
	const after = ok(
		"    - cron: '0 1 * * *'\n      # コメント\n      timezone: 'Asia/Tokyo'\n    - cron: '0 2 * * *'",
	);
	assert.equal(after.sourceTimeZone, 'Asia/Tokyo');
	const before = ok("- timezone: Asia/Tokyo\n  cron: '0 1 * * *'");
	assert.equal(before.sourceTimeZone, 'Asia/Tokyo');
	assert.equal(before.jstExpr, '0 1 * * *');
	const bare = ok("cron: '0 1 * * *'\ntimezone: Asia/Tokyo");
	assert.equal(bare.sourceTimeZone, 'Asia/Tokyo');
	// 1件目の項目にtimezoneがなく、2件目の項目にある場合も1件目はUTC
	const second = ok(
		"- cron: '0 1 * * *'\n- timezone: Asia/Tokyo\n  cron: '0 2 * * *'",
	);
	assert.equal(second.sourceTimeZone, 'UTC');
});

test('先頭行の字下げが落ちた貼り付けでも、同じ項目のtimezoneを使う（回帰: round 2 F5）', () => {
	const dash = ok("- cron: '0 1 * * *'\n      timezone: Asia/Tokyo");
	assert.equal(dash.sourceTimeZone, 'Asia/Tokyo');
	assert.equal(dash.jstExpr, '0 1 * * *');
	const bare = ok("cron: '0 1 * * *'\n      timezone: Asia/Tokyo");
	assert.equal(bare.sourceTimeZone, 'Asia/Tokyo');
	// 字下げが落ちても、次の項目やstepの with: にあるtimezoneは使わない
	const nextItem = ok(
		"- cron: '0 1 * * *'\n    - cron: '0 2 * * *'\n      timezone: Asia/Tokyo",
	);
	assert.equal(nextItem.sourceTimeZone, 'UTC');
	const withStep = ok(`- cron: '0 0 * * *'
jobs:
  build:
    steps:
      - uses: example/action@v1
        with:
          timezone: America/New_York`);
	assert.equal(withStep.sourceTimeZone, 'UTC');
	const nested = ok(
		"- cron: '0 0 * * *'\n      other:\n        timezone: Asia/Tokyo",
	);
	assert.equal(nested.sourceTimeZone, 'UTC');
});

test('cron()/rate()の後ろの行末コメントは無視する', () => {
	assert.equal(ok('cron(0 9 ? * MON *) # 毎週月曜').sourceExpr, '0 9 * * MON');
	assert.equal(ok('rate(5 minutes)  # 5分ごと').jstExpr, '*/5 * * * *');
	assert.match(err('cron(0 9 ? * MON *) extra'), /余分な文字/);
	assert.match(err('cron(0 9 ? * MON *))'), /余分な文字/);
	assert.match(err('rate(5 minutes'), /「\)」で閉じて/);
});

test('GitHub Actionsの5分未満の間隔を注意する', () => {
	assert.ok(ok("- cron: '* * * * *'").notes.some((n) => n.includes('最短5分')));
	assert.ok(
		ok("- cron: '*/2 * * * *'").notes.some((n) => n.includes('最短5分')),
	);
	assert.ok(
		ok("- cron: '0,3 9 * * *'").notes.some((n) => n.includes('最短5分')),
	);
	assert.ok(
		!ok("- cron: '*/5 * * * *'").notes.some((n) => n.includes('最短5分')),
	);
	// 時をまたぐ間隔（59分と0分）も見る
	assert.ok(
		ok("- cron: '0,58 * * * *'").notes.some((n) => n.includes('最短5分')),
	);
});

test('GitHub Actionsのcronが複数なら最初の1件を読み込む', () => {
	const r = ok("- cron: '0 1 * * *'\n- cron: '0 2 * * *'");
	assert.equal(r.sourceExpr, '0 1 * * *');
	assert.ok(r.notes.some((n) => n.includes('2件')));
});

test('GitHub Actionsの不正なcronはエラーにする', () => {
	assert.match(err("- cron: ''"), /見つけられませんでした/);
	assert.match(err("- cron: '0 9 * *'"), /フィールド数/);
	assert.match(err("- cron: '0 0 9 * * *'"), /秒フィールド/);
});

// --- UTC → JST 換算 ---

test('毎日実行される式は時を9時間ずらし、日付をまたいでも換算できる', () => {
	assert.equal(shiftUtcCronToJst('0 20 * * *').expr, '0 5 * * *');
	assert.equal(shiftUtcCronToJst('*/15 * * * *').expr, '*/15 * * * *');
	assert.equal(shiftUtcCronToJst('0 */2 * * *').expr, '0 1-23/2 * * *');
	assert.equal(shiftUtcCronToJst('0 0,12,18 * * *').expr, '0 3,9,21 * * *');
	for (const e of [
		'0 20 * * *',
		'0 */2 * * *',
		'0 0,12,18 * * *',
		'5 13-16 * * *',
	]) {
		assertSameRuns(e, shiftUtcCronToJst(e).expr as string);
	}
});

test('全ての時刻が日付をまたぐ場合は曜日・日を1日ずらす', () => {
	assert.equal(shiftUtcCronToJst('0 22 * * 0-4').expr, '0 7 * * 1-5');
	assert.equal(shiftUtcCronToJst('0 20 * * 6').expr, '0 5 * * 0');
	assert.equal(shiftUtcCronToJst('0 15 1,15 * *').expr, '0 0 2,16 * *');
	assert.equal(shiftUtcCronToJst('0 15 27 3 *').expr, '0 0 28 3 *');
	assert.equal(shiftUtcCronToJst('0 20 1 * 1').expr, '0 5 2 * 2');
	for (const e of [
		'0 22 * * 0-4',
		'0 20 * * 6',
		'0 15 1,15 * *',
		'0 15 27 3 *',
		'0 20 1 * 1',
	]) {
		assertSameRuns(e, shiftUtcCronToJst(e).expr as string);
	}
});

test('1行で同じ日時を表せない場合は換算しない', () => {
	const cases = [
		'0 10,20 * * 1', // 日付をまたぐ時刻とまたがない時刻が混在
		'0 * * * 1', // 毎時（曜日指定あり）
		'0 20 28 * *', // 月末に近い日
		'0 20 31 * *',
		'0 20 * 3 *', // 月の指定（月末の夜が翌月になる）
		'0 20 * 3 1', // 月と曜日の指定
	];
	for (const e of cases) {
		const r = shiftUtcCronToJst(e);
		assert.equal(r.expr, null, e);
		assert.ok(r.note?.includes('日付をまたぐ'), e);
	}
	const aws = ok('cron(0 20 31 * ? *)');
	assert.equal(aws.jstExpr, null);
	assert.equal(aws.sourceExpr, '0 20 31 * *');
	assert.ok(aws.notes.some((n) => n.includes('日付をまたぐ')));
});

test('日付をまたがない時刻は、月・日・曜日の指定があっても時だけずらす', () => {
	for (const e of ['0 0 31 12 *', '30 14 * 2 1-5', '0 1-5 1 * 0']) {
		const r = shiftUtcCronToJst(e);
		assert.ok(r.expr, e);
		assertSameRuns(e, r.expr as string);
	}
});

// --- systemd timer（OnCalendar=） ---

test('systemd: 平日9時（Asia/Tokyo）をそのままJSTのcron式にする', () => {
	const r = ok('OnCalendar=Mon..Fri *-*-* 09:00:00 Asia/Tokyo');
	assert.equal(r.format, 'systemd');
	assert.equal(r.formatLabel, 'systemd timer（OnCalendar=）');
	assert.equal(r.sourceExpr, '0 9 * * 1-5');
	assert.equal(r.sourceTimeZone, 'Asia/Tokyo');
	assert.equal(r.sourceTimeZoneLabel, undefined);
	assert.equal(r.jstExpr, '0 9 * * 1-5');
	assert.ok(r.notes.some((n) => n.includes('Asia/Tokyo')));
});

test('systemd: [Timer]節ごと貼り付けても OnCalendar= の行だけを読む', () => {
	const r = ok(
		'[Timer]\n# 毎朝\nOnCalendar=*-*-* 06:30:00 Asia/Tokyo\nPersistent=true\n',
	);
	assert.equal(r.jstExpr, '30 6 * * *');
	// 空の OnCalendar=（設定のリセット）は無視する
	assert.equal(ok('OnCalendar=\nOnCalendar=daily').jstExpr, '0 0 * * *');
	assert.equal(ok('  oncalendar = hourly').jstExpr, '0 * * * *');
});

test('systemd: 省略形をcron式にする', () => {
	const cases: [string, string][] = [
		['minutely', '* * * * *'],
		['hourly', '0 * * * *'],
		['daily', '0 0 * * *'],
		['Daily', '0 0 * * *'],
		['weekly', '0 0 * * 1'],
		['monthly', '0 0 1 * *'],
		['yearly', '0 0 1 1 *'],
		['annually', '0 0 1 1 *'],
		['quarterly', '0 0 1 */3 *'],
		['semiannually', '0 0 1 */6 *'],
	];
	for (const [value, expected] of cases) {
		assert.equal(ok(`OnCalendar=${value}`).sourceExpr, expected, value);
	}
});

test('systemd: 日付・時刻・秒の省略を既定値で補う', () => {
	const cases: [string, string][] = [
		['Mon 9:00', '0 9 * * 1'], // 日付の省略は毎日
		['*-*-15', '0 0 15 * *'], // 時刻の省略は 00:00:00
		['01-01', '0 0 1 1 *'], // 年の省略（月-日）
		['*-1 9:00', '0 9 1 * *'],
		['*:30', '30 * * * *'], // 時:分だけ
		['9:00', '0 9 * * *'],
		['*-*-* 9,12:0', '0 9,12 * * *'],
		['*-*-* 0,12:0', '0 */12 * * *'], // 最小値から最後まで等間隔なら */幅
	];
	for (const [value, expected] of cases) {
		assert.equal(ok(`OnCalendar=${value}`).sourceExpr, expected, value);
	}
});

test('systemd: 範囲・ステップ・曜日の正式名を読む', () => {
	const cases: [string, string][] = [
		['*:0/15', '*/15 * * * *'],
		['*-*-* 00/6:00', '0 */6 * * *'],
		['*-*-* 9..17/2:00', '0 9-17/2 * * *'],
		['*-*-1..10/3', '0 0 1-10/3 * *'],
		['*-*-01/2', '0 0 */2 * *'],
		['*-02/3-01', '0 0 1 2-11/3 *'],
		['*-*-1,15 *:00', '0 * 1,15 * *'],
		['Monday,Wednesday 10:00', '0 10 * * 1,3'],
		['mOn..fRi 10:00', '0 10 * * 1-5'],
		['Sat..Sun 9:00', '0 9 * * 0,6'],
		['Fri..Sun,Mon 9:00', '0 9 * * 0,1,5,6'],
		['Mon..Sun 9:00', '0 9 * * *'],
		['Mon..Wed,Fri', '0 0 * * 1-3,5'],
	];
	for (const [value, expected] of cases) {
		const r = ok(`OnCalendar=${value}`);
		assert.equal(r.sourceExpr, expected, value);
		parseCronExpression(expected);
	}
});

test('systemd: 秒が0以外なら秒付き6フィールドにする', () => {
	assert.equal(ok('OnCalendar=*-*-* *:*:0/10').sourceExpr, '*/10 * * * * *');
	assert.equal(ok('OnCalendar=*-*-* 9:00:30').sourceExpr, '30 0 9 * * *');
	assert.equal(ok('OnCalendar=*-*-* 9:00:00').sourceExpr, '0 9 * * *');
});

test('systemd: 年の指定は反映せず注意を出す', () => {
	const r = ok('OnCalendar=2027-*-* 00:00 Asia/Tokyo');
	assert.equal(r.sourceExpr, '0 0 * * *');
	assert.ok(r.notes.some((n) => n.includes('年の指定（2027）')));
	assert.ok(!ok('OnCalendar=daily').notes.some((n) => n.includes('年の指定')));
});

test('systemd: UTCはJSTへ換算する（秒付きも）', () => {
	const r = ok('OnCalendar=Mon..Fri *-*-* 00:30:00 UTC');
	assert.equal(r.sourceTimeZone, 'UTC');
	assert.equal(r.sourceExpr, '30 0 * * 1-5');
	assert.equal(r.jstExpr, '30 9 * * 1-5');
	assertSameRuns(r.sourceExpr as string, r.jstExpr as string);
	assert.equal(ok('OnCalendar=daily Etc/UTC').jstExpr, '0 9 * * *');

	const withSeconds = ok('OnCalendar=*-*-* 22:00:15 UTC');
	assert.equal(withSeconds.sourceExpr, '15 0 22 * * *');
	assert.equal(withSeconds.jstExpr, '15 0 7 * * *');

	// 日付をまたぐ時刻が混在すると換算しない
	const wrap = ok('OnCalendar=Mon *-*-* 10,20:00 UTC');
	assert.equal(wrap.jstExpr, null);
	assert.ok(wrap.notes.some((n) => n.includes('日付をまたぐ')));
});

test('systemd: タイムゾーンの指定がなければJSTとみなし、その旨を出す', () => {
	const r = ok('OnCalendar=Mon..Fri 09:00');
	assert.equal(r.sourceTimeZone, 'Asia/Tokyo');
	assert.equal(r.sourceTimeZoneLabel, '指定なし（サーバーのタイムゾーン）');
	assert.equal(r.jstExpr, '0 9 * * 1-5');
	assert.ok(r.notes[0].includes('指定がない'));
});

test('systemd: UTC・Asia/Tokyo以外のタイムゾーンは換算しない', () => {
	const r = ok('OnCalendar=*-*-* 09:00 America/New_York');
	assert.equal(r.sourceTimeZone, 'America/New_York');
	assert.equal(r.sourceExpr, '0 9 * * *');
	assert.equal(r.jstExpr, null);
	assert.ok(r.notes[0].includes('America/New_York'));
	assert.match(
		err('OnCalendar=*-*-* 09:00 Foo/Bar'),
		/タイムゾーン「Foo\/Bar」/,
	);
});

test('systemd: 日の行と曜日の行の2行は、cronのOR条件1行にまとめる', () => {
	const r = ok(
		'OnCalendar=*-*-13 12:00:00 Asia/Tokyo\nOnCalendar=Fri *-*-* 12:00:00 Asia/Tokyo',
	);
	assert.equal(r.sourceExpr, '0 12 13 * 5');
	assert.ok(r.notes.some((n) => n.includes('OR条件')));
	// 曜日の行が先でも同じ
	assert.equal(
		ok('OnCalendar=Fri 12:00\nOnCalendar=*-*-13 12:00').sourceExpr,
		'0 12 13 * 5',
	);
});

test('systemd: まとめられない複数行は最初の1件を読み、その旨を出す', () => {
	const cases = [
		'OnCalendar=*-*-13 12:00\nOnCalendar=Fri 13:00', // 時刻が違う
		'OnCalendar=*-*-13 12:00 UTC\nOnCalendar=Fri 12:00', // タイムゾーンが違う
		'OnCalendar=*-*-13 12:00\nOnCalendar=*-*-20 12:00', // 両方とも日の行
		'OnCalendar=*-*-13 12:00\nOnCalendar=Fri 12:00\nOnCalendar=daily', // 3行
	];
	for (const text of cases) {
		const r = ok(text);
		assert.equal(r.sourceExpr, '0 12 13 * *', text);
		assert.ok(
			r.notes.some((n) => n.includes('最初の1件')),
			text,
		);
	}
});

test('systemd: 解釈できない・cronで表せない指定はエラーを返す', () => {
	assert.match(err('OnCalendar='), /値が空/);
	assert.match(err('OnCalendar=Mon *-*-1 00:00'), /AND条件/);
	assert.match(err('OnCalendar=*:*/15'), /「00\/15」のように開始値から/);
	assert.match(err('OnCalendar=*-*-*/2'), /「01\/2」のように開始値から/);
	assert.match(err('OnCalendar=Fri..Mon'), /日曜をまたぐ範囲/);
	assert.match(err('OnCalendar=*-*~01'), /月末から数える日/);
	assert.match(err('OnCalendar=*-*-* 9:00:00.5'), /小数の秒/);
	assert.match(err('OnCalendar=*-*-* 24:00'), /時は0〜23/);
	assert.match(err('OnCalendar=*-*-* 9:60'), /分は0〜59/);
	assert.match(err('OnCalendar=*-13-01'), /月は1〜12/);
	assert.match(err('OnCalendar=*-*-32'), /日は1〜31/);
	assert.match(err('OnCalendar=*-*-* 17..9:00'), /小さい値から大きい値/);
	assert.match(err('OnCalendar=*:0/90'), /幅/);
	assert.match(err('OnCalendar=Funday 9:00'), /解釈できません/);
	assert.match(err('OnCalendar=UTC'), /解釈できません/);
	assert.match(
		err('OnCalendar=*-*-* 9:00 UTC extra'),
		/「extra」を解釈できません/,
	);
	assert.match(err('OnCalendar=*-*-*-* 9:00'), /日付/);
	assert.match(err('OnCalendar=*-*-* 9:00:00:00'), /時刻/);
	assert.match(err('OnCalendar=abc-*-* 9:00'), /解釈できません/);
});

test('systemd: cron式チェッカーの systemd timer 出力を読み戻すと同じ日時に実行する', () => {
	for (const expr of [
		'0 9 * * 1-5',
		'*/15 * * * *',
		'10-40/10 * * * *',
		'0 0 */2 * *',
		'0 0 1 */3 *',
		'0 12 13 * 5',
		'0 0 1,15 * 1',
		'0 9 * * 0,6',
		'*/10 * * * * *',
	]) {
		const { value } = toSystemdOnCalendar(parseCronExpression(expr));
		const r = ok(value);
		assert.ok(r.jstExpr, expr);
		assert.deepEqual(
			runs(r.jstExpr as string, 'Asia/Tokyo'),
			runs(expr, 'Asia/Tokyo'),
			expr,
		);
	}
});

// systemdが使える環境では、OnCalendar= をsystemd-analyzeで実際に展開し、換算後のJSTプレビューと照合する。
const hasSystemdAnalyze =
	spawnSync('systemd-analyze', ['--version'], { encoding: 'utf8' }).status ===
	0;

for (const onCalendar of [
	'Mon..Fri *-*-* 09:00:00 Asia/Tokyo',
	'Mon..Fri *-*-* 00:30:00 UTC',
	'*-*-* 22:00:00 UTC',
	'Sat..Sun 09:00 Asia/Tokyo',
	'*-*-1..10/3 9..17/2:00 Asia/Tokyo',
	'*-02/3-01 00:00 UTC',
	'quarterly Asia/Tokyo',
	'weekly UTC',
	'*:0/15 Asia/Tokyo',
	'*-*-* *:*:0/20 UTC',
]) {
	test(`systemd: systemd-analyzeの展開が換算後のJSTプレビューと一致する: ${onCalendar}`, {
		skip: !hasSystemdAnalyze && 'systemd-analyzeがない環境',
	}, () => {
		const r = ok(`OnCalendar=${onCalendar}`);
		assert.ok(r.jstExpr, onCalendar);
		const count = 12;
		const out = spawnSync(
			'systemd-analyze',
			[
				'calendar',
				`--iterations=${count}`,
				`--base-time=@${FROM.getTime() / 1000}`,
				onCalendar,
			],
			{ encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } },
		);
		assert.equal(out.status, 0, out.stderr);
		const actual = [
			...out.stdout.matchAll(
				/(?:Next elapse|Iteration #\d+): \w+ (\S+ \S+) UTC/g,
			),
		].map((m) => new Date(`${m[1].replace(' ', 'T')}Z`).toISOString());
		assert.equal(actual.length, count);
		assert.deepEqual(actual, runs(r.jstExpr as string, 'Asia/Tokyo', count));
	});
}
