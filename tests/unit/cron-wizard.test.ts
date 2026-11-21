import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	getNextRunTimes,
	parseCronExpression,
} from '../../src/lib/tools/cron-checker.ts';
import {
	buildCronFromWizard,
	compressWeekdays,
	type WizardOptions,
	type WizardSuccess,
} from '../../src/lib/tools/cron-wizard.ts';

function ok(options: WizardOptions): WizardSuccess {
	const r = buildCronFromWizard(options);
	assert.equal(r.success, true, r.success ? '' : r.error);
	return r as WizardSuccess;
}

function err(options: WizardOptions): string {
	const r = buildCronFromWizard(options);
	assert.equal(r.success, false, `失敗するはず: ${JSON.stringify(options)}`);
	return r.success ? '' : r.error;
}

// 2026-12-31（木）23:59:30 JST を起点にする（getNextRunTimes は起点より後を返す）
const FROM = new Date(Date.UTC(2026, 11, 31, 14, 59, 30));

/** 生成した式の次回実行を JST の「YYYY-MM-DD HH:mm 曜」で返す */
function jstRuns(expr: string, count: number): string[] {
	const fmt = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		weekday: 'short',
		hourCycle: 'h23',
	});
	return getNextRunTimes(parseCronExpression(expr), {
		count,
		from: FROM,
		timeZone: 'Asia/Tokyo',
	}).map((d) => {
		const p = Object.fromEntries(
			fmt.formatToParts(d).map((x) => [x.type, x.value]),
		);
		return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.weekday}`;
	});
}

// --- n分ごと ---

test('n分ごと: 1分は毎分、それ以外は */n', () => {
	assert.equal(ok({ frequency: 'minutes', interval: 1 }).expr, '* * * * *');
	assert.equal(ok({ frequency: 'minutes', interval: 15 }).expr, '*/15 * * * *');
	assert.equal(ok({ frequency: 'minutes', interval: 30 }).expr, '*/30 * * * *');
});

test('n分ごと: 60の約数以外・未指定はエラー', () => {
	assert.match(err({ frequency: 'minutes', interval: 7 }), /分の間隔/);
	assert.match(err({ frequency: 'minutes', interval: 0 }), /分の間隔/);
	assert.match(err({ frequency: 'minutes', interval: 60 }), /分の間隔/);
	assert.match(err({ frequency: 'minutes' }), /分の間隔/);
});

test('n分ごと: 次回実行が等間隔になる', () => {
	const expr = ok({ frequency: 'minutes', interval: 20 }).expr;
	assert.deepEqual(jstRuns(expr, 4), [
		'2027-01-01 00:00 Fri',
		'2027-01-01 00:20 Fri',
		'2027-01-01 00:40 Fri',
		'2027-01-01 01:00 Fri',
	]);
});

// --- n時間ごと ---

test('n時間ごと: 分を指定し、1時間は毎時', () => {
	assert.equal(
		ok({ frequency: 'hours', interval: 1, minute: 30 }).expr,
		'30 * * * *',
	);
	assert.equal(
		ok({ frequency: 'hours', interval: 6, minute: 0 }).expr,
		'0 */6 * * *',
	);
	const expr = ok({ frequency: 'hours', interval: 8, minute: 15 }).expr;
	assert.deepEqual(jstRuns(expr, 4), [
		'2027-01-01 00:15 Fri',
		'2027-01-01 08:15 Fri',
		'2027-01-01 16:15 Fri',
		'2027-01-02 00:15 Sat',
	]);
});

test('n時間ごと: 24の約数以外・分の範囲外はエラー', () => {
	assert.match(
		err({ frequency: 'hours', interval: 5, minute: 0 }),
		/時間の間隔/,
	);
	assert.match(
		err({ frequency: 'hours', interval: 24, minute: 0 }),
		/時間の間隔/,
	);
	assert.match(err({ frequency: 'hours', interval: 2, minute: 60 }), /分は/);
	assert.match(err({ frequency: 'hours', interval: 2 }), /分は/);
});

// --- 毎日 ---

test('毎日: 境界値の0時0分と23時59分', () => {
	assert.equal(
		ok({ frequency: 'daily', hour: 0, minute: 0 }).expr,
		'0 0 * * *',
	);
	const expr = ok({ frequency: 'daily', hour: 23, minute: 59 }).expr;
	assert.equal(expr, '59 23 * * *');
	assert.deepEqual(jstRuns(expr, 2), [
		'2027-01-01 23:59 Fri',
		'2027-01-02 23:59 Sat',
	]);
});

test('毎日: 時・分の範囲外や整数でない値はエラー', () => {
	assert.match(err({ frequency: 'daily', hour: 24, minute: 0 }), /時は/);
	assert.match(err({ frequency: 'daily', hour: -1, minute: 0 }), /時は/);
	assert.match(err({ frequency: 'daily', hour: 9.5, minute: 0 }), /時は/);
	assert.match(err({ frequency: 'daily', hour: 9, minute: 1.5 }), /分は/);
	assert.match(err({ frequency: 'daily', minute: 0 }), /時は/);
});

// --- 毎週 ---

test('曜日のまとめ方: 連続3日以上は範囲、それ以外はカンマ', () => {
	assert.equal(compressWeekdays([1, 2, 3, 4, 5]), '1-5');
	assert.equal(compressWeekdays([1, 3, 5]), '1,3,5');
	assert.equal(compressWeekdays([0, 6]), '0,6');
	assert.equal(compressWeekdays([1, 2]), '1,2');
	assert.equal(compressWeekdays([0, 1, 2, 4, 5, 6]), '0-2,4-6');
	assert.equal(compressWeekdays([5, 1, 3, 3]), '1,3,5');
	assert.equal(compressWeekdays([0, 1, 2, 3, 4, 5, 6]), '*');
});

test('毎週: 平日9時の次回実行が月〜金になる', () => {
	const expr = ok({
		frequency: 'weekly',
		weekdays: [1, 2, 3, 4, 5],
		hour: 9,
		minute: 0,
	}).expr;
	assert.equal(expr, '0 9 * * 1-5');
	assert.deepEqual(jstRuns(expr, 3), [
		'2027-01-01 09:00 Fri',
		'2027-01-04 09:00 Mon',
		'2027-01-05 09:00 Tue',
	]);
});

test('毎週: 日曜と土曜、全曜日', () => {
	const weekend = ok({
		frequency: 'weekly',
		weekdays: [6, 0],
		hour: 10,
		minute: 30,
	}).expr;
	assert.equal(weekend, '30 10 * * 0,6');
	assert.deepEqual(jstRuns(weekend, 3), [
		'2027-01-02 10:30 Sat',
		'2027-01-03 10:30 Sun',
		'2027-01-09 10:30 Sat',
	]);
	assert.equal(
		ok({
			frequency: 'weekly',
			weekdays: [0, 1, 2, 3, 4, 5, 6],
			hour: 0,
			minute: 0,
		}).expr,
		'0 0 * * *',
	);
});

test('毎週: 曜日なし・範囲外の曜日はエラー', () => {
	assert.match(
		err({ frequency: 'weekly', weekdays: [], hour: 9, minute: 0 }),
		/曜日を1つ以上/,
	);
	assert.match(
		err({ frequency: 'weekly', hour: 9, minute: 0 }),
		/曜日を1つ以上/,
	);
	assert.match(
		err({ frequency: 'weekly', weekdays: [7], hour: 9, minute: 0 }),
		/曜日は0/,
	);
});

// --- 毎月 ---

test('毎月: 1日と28日は注意なし', () => {
	const first = ok({ frequency: 'monthly', dayOfMonth: 1, hour: 0, minute: 0 });
	assert.equal(first.expr, '0 0 1 * *');
	assert.deepEqual(first.notes, []);
	assert.deepEqual(jstRuns(first.expr, 2), [
		'2027-01-01 00:00 Fri',
		'2027-02-01 00:00 Mon',
	]);
	assert.deepEqual(
		ok({ frequency: 'monthly', dayOfMonth: 28, hour: 9, minute: 0 }).notes,
		[],
	);
});

test('毎月: 29〜31日は実行されない月の注意を返す', () => {
	const d31 = ok({ frequency: 'monthly', dayOfMonth: 31, hour: 9, minute: 0 });
	assert.equal(d31.expr, '0 9 31 * *');
	assert.equal(d31.notes.length, 1);
	assert.match(d31.notes[0], /31日がない月（2・4・6・9・11月）/);
	// 31日のない月を飛ばす（1月→3月→5月）
	assert.deepEqual(jstRuns(d31.expr, 3), [
		'2027-01-31 09:00 Sun',
		'2027-03-31 09:00 Wed',
		'2027-05-31 09:00 Mon',
	]);
	assert.match(
		ok({ frequency: 'monthly', dayOfMonth: 30, hour: 0, minute: 0 }).notes[0],
		/30日がない月（2月）/,
	);
	assert.match(
		ok({ frequency: 'monthly', dayOfMonth: 29, hour: 0, minute: 0 }).notes[0],
		/うるう年以外の2月/,
	);
});

test('毎月: 日の範囲外はエラー', () => {
	assert.match(
		err({ frequency: 'monthly', dayOfMonth: 0, hour: 0, minute: 0 }),
		/日は1〜31/,
	);
	assert.match(
		err({ frequency: 'monthly', dayOfMonth: 32, hour: 0, minute: 0 }),
		/日は1〜31/,
	);
	assert.match(err({ frequency: 'monthly', hour: 0, minute: 0 }), /日は1〜31/);
});

test('不明な頻度はエラー', () => {
	assert.match(
		err({ frequency: 'yearly' as WizardOptions['frequency'] }),
		/頻度を選んで/,
	);
});

test('生成した式はすべて解析欄のパーサーで解釈できる', () => {
	const cases: WizardOptions[] = [
		{ frequency: 'minutes', interval: 5 },
		{ frequency: 'hours', interval: 12, minute: 45 },
		{ frequency: 'daily', hour: 18, minute: 5 },
		{ frequency: 'weekly', weekdays: [1, 3, 5], hour: 7, minute: 0 },
		{ frequency: 'monthly', dayOfMonth: 15, hour: 12, minute: 0 },
	];
	for (const c of cases) {
		const { expr } = ok(c);
		assert.doesNotThrow(() => parseCronExpression(expr), expr);
	}
});
