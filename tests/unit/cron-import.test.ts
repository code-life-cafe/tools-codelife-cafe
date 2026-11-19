import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	getNextRunTimes,
	parseCronExpression,
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
