import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	CronParseError,
	describeCronJapanese,
	generateCronFromJapanese,
	getNextRunTimes,
	lintCronSchedule,
	parseCronExpression,
	toAwsEventBridgeCron,
	toCrontabLine,
	toGithubActionsSchedule,
	VIXIE_DIALECT,
} from '../../src/lib/tools/cron-checker.ts';

test('標準5フィールドをパースできる', () => {
	const s = parseCronExpression('0 9 * * 1');
	assert.equal(s.hasSeconds, false);
	assert.deepEqual(s.minutes.values, [0]);
	assert.deepEqual(s.hours.values, [9]);
	assert.equal(s.daysOfMonth.isWildcard, true);
	assert.equal(s.months.isWildcard, true);
	assert.deepEqual(s.daysOfWeek.values, [1]);
});

test('秒付き6フィールドをパースできる', () => {
	const s = parseCronExpression('*/5 * * * * *');
	assert.equal(s.hasSeconds, true);
	assert.equal(s.seconds.step, 5);
	assert.equal(s.seconds.values.length, 12);
});

test('*/15 * * * * は15分おきの値集合になる', () => {
	const s = parseCronExpression('*/15 * * * *');
	assert.deepEqual(s.minutes.values, [0, 15, 30, 45]);
	assert.equal(s.minutes.step, 15);
	assert.equal(s.minutes.stepFromWildcard, true);
});

test('曜日は0と7がどちらも日曜として扱われる（0 0 * * 0,7）', () => {
	const s = parseCronExpression('0 0 * * 0,7');
	assert.deepEqual(s.daysOfWeek.values, [0]);
});

test('英語省略形（月・曜日）を解釈できる', () => {
	const s = parseCronExpression('0 9 * jan mon');
	assert.deepEqual(s.months.values, [1]);
	assert.deepEqual(s.daysOfWeek.values, [1]);
});

test('フィールド数が不正な場合はCronParseErrorを投げる', () => {
	assert.throws(() => parseCronExpression('* * *'), CronParseError);
});

test('範囲外の値はCronParseErrorを投げる', () => {
	assert.throws(() => parseCronExpression('99 9 * * *'), CronParseError);
	assert.throws(() => parseCronExpression('0 24 * * *'), CronParseError);
	assert.throws(() => parseCronExpression('0 9 32 * *'), CronParseError);
	assert.throws(() => parseCronExpression('0 9 * 13 *'), CronParseError);
});

test('空文字はCronParseErrorを投げる', () => {
	assert.throws(() => parseCronExpression(''), CronParseError);
	assert.throws(() => parseCronExpression('   '), CronParseError);
});

test('方言（dialect）は省略時にVixie cronが既定として使われる', () => {
	const s = parseCronExpression('0 0 1 * 1');
	assert.equal(s.dialect, VIXIE_DIALECT);
	assert.equal(s.dialect.name, 'vixie');
	// OR条件で結合されることの確認（回帰防止）
	assert.equal(s.dialect.combineDayAndWeekday(true, false, false, false), true);
	assert.equal(
		s.dialect.combineDayAndWeekday(false, false, false, false),
		false,
	);
	assert.equal(s.dialect.normalizeDow(7), 0);
});

test('カスタム方言を渡すと日・曜日をAND条件で結合できる（拡張性の確認）', () => {
	const andDialect = {
		...VIXIE_DIALECT,
		name: 'and-dialect',
		combineDayAndWeekday(
			domMatch: boolean,
			dowMatch: boolean,
			domWildcard: boolean,
			dowWildcard: boolean,
		) {
			if (domWildcard && dowWildcard) return true;
			if (domWildcard) return dowMatch;
			if (dowWildcard) return domMatch;
			return domMatch && dowMatch;
		},
	};
	const s = parseCronExpression('0 0 1 * 1', andDialect);
	assert.equal(s.dialect.name, 'and-dialect');
	assert.equal(
		s.dialect.combineDayAndWeekday(true, false, false, false),
		false,
	);
});

// --- 次回実行日時 -----------------------------------------------------

test('0 0 31 * * は2月をスキップして次回実行日時を計算する（うるう年でない年）', () => {
	const s = parseCronExpression('0 0 31 * *');
	const from = new Date(Date.UTC(2025, 0, 1, 0, 0, 0)); // 2025-01-01 (JSTでも同日扱いになるよう0時UTC基準)
	const next = getNextRunTimes(s, { count: 3, from, timeZone: 'UTC' });
	const months = next.map((d) => d.getUTCMonth() + 1);
	assert.ok(!months.includes(2), '2月は31日が存在しないため含まれないはず');
	// 4月は30日までしかないため、1月→3月→5月の順になる
	assert.deepEqual(months, [1, 3, 5]);
});

test('0 0 1 1 * は年をまたいで次回実行日時を計算する', () => {
	const s = parseCronExpression('0 0 1 1 *');
	const from = new Date(Date.UTC(2026, 5, 1, 0, 0, 0)); // 2026-06-01
	const [next] = getNextRunTimes(s, { count: 1, from, timeZone: 'UTC' });
	assert.equal(next.getUTCFullYear(), 2027);
	assert.equal(next.getUTCMonth() + 1, 1);
	assert.equal(next.getUTCDate(), 1);
});

test('うるう年の2/29を含むスケジュールは4年に1度実行される', () => {
	const s = parseCronExpression('0 0 29 2 *');
	const from = new Date(Date.UTC(2024, 1, 29, 1, 0, 0)); // 2024-02-29 01:00 UTC（実行時刻を過ぎた直後）
	const [next] = getNextRunTimes(s, { count: 1, from, timeZone: 'UTC' });
	assert.equal(next.getUTCFullYear(), 2028);
	assert.equal(next.getUTCMonth() + 1, 2);
	assert.equal(next.getUTCDate(), 29);
});

test('月末境界: 0 0 30 * * は2月には出現しない', () => {
	const s = parseCronExpression('0 0 30 * *');
	const from = new Date(Date.UTC(2025, 0, 31, 0, 0, 0));
	const next = getNextRunTimes(s, { count: 2, from, timeZone: 'UTC' });
	const months = next.map((d) => d.getUTCMonth() + 1);
	assert.deepEqual(months, [3, 4]);
});

test('JST固定（DSTなし）で次回実行日時がJSTの壁時計時刻と一致する', () => {
	const s = parseCronExpression('0 9 * * *');
	const from = new Date('2026-07-09T00:00:00Z');
	const [next] = getNextRunTimes(s, { count: 1, from, timeZone: 'Asia/Tokyo' });
	const jstFormatter = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Tokyo',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	});
	const parts = jstFormatter.formatToParts(next);
	const hour = parts.find((p) => p.type === 'hour')?.value;
	const minute = parts.find((p) => p.type === 'minute')?.value;
	assert.equal(hour, '09');
	assert.equal(minute, '00');
});

test('次回実行日時を10件取得できる', () => {
	const s = parseCronExpression('0 * * * *');
	const next = getNextRunTimes(s, { timeZone: 'UTC' });
	assert.equal(next.length, 10);
	for (let i = 1; i < next.length; i++) {
		assert.ok(next[i].getTime() > next[i - 1].getTime());
	}
});

test('秒付き6フィールド: */5 * * * * * の次回10件が5秒間隔になる', () => {
	const s = parseCronExpression('*/5 * * * * *');
	const from = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
	const next = getNextRunTimes(s, { count: 10, from, timeZone: 'UTC' });
	assert.equal(next.length, 10);
	const seconds = next.map((d) => d.getUTCSeconds());
	assert.deepEqual(seconds, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]); // fromちょうど(0秒)は含まない
	for (let i = 1; i < next.length; i++) {
		assert.equal(next[i].getTime() - next[i - 1].getTime(), 5000);
	}
});

test('秒付き6フィールド: 30 0 9 * * * の次回実行は9:00:30になる', () => {
	const s = parseCronExpression('30 0 9 * * *');
	const from = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
	const [next] = getNextRunTimes(s, { count: 1, from, timeZone: 'UTC' });
	assert.equal(next.getUTCHours(), 9);
	assert.equal(next.getUTCMinutes(), 0);
	assert.equal(next.getUTCSeconds(), 30);
});

// --- 日本語解説 -------------------------------------------------------

test('「0 9 * * 1」は「毎週月曜 9:00」と解説される', () => {
	const s = parseCronExpression('0 9 * * 1');
	assert.equal(describeCronJapanese(s), '毎週月曜 9:00');
});

test('「*/15 * * * *」は「毎日 15分おき」と解説される', () => {
	const s = parseCronExpression('*/15 * * * *');
	assert.equal(describeCronJapanese(s), '毎日 15分おき');
});

test('「0 0 1 1 *」は「毎年1月1日 0:00」と解説される', () => {
	const s = parseCronExpression('0 0 1 1 *');
	assert.equal(describeCronJapanese(s), '毎年1月1日 0:00');
});

test('「0 0 31 * *」は「毎月31日 0:00」と解説される', () => {
	const s = parseCronExpression('0 0 31 * *');
	assert.equal(describeCronJapanese(s), '毎月31日 0:00');
});

test('「0 9 * jan mon」は月が脱落せず「毎年1月の毎週月曜 9:00」と解説される', () => {
	const s = parseCronExpression('0 9 * jan mon');
	assert.equal(describeCronJapanese(s), '毎年1月の毎週月曜 9:00');
});

test('「5 */2 * * *」は分が脱落せず「毎日 5分 2時間おき」と解説される', () => {
	const s = parseCronExpression('5 */2 * * *');
	assert.equal(describeCronJapanese(s), '毎日 5分 2時間おき');
});

// --- cronリンター -----------------------------------------------------

test('毎分実行は警告される', () => {
	const s = parseCronExpression('* * * * *');
	const issues = lintCronSchedule(s);
	assert.ok(
		issues.some((i) => i.severity === 'warn' && i.message.includes('毎分')),
	);
});

test('毎秒実行は警告される', () => {
	const s = parseCronExpression('* * * * * *');
	const issues = lintCronSchedule(s);
	assert.ok(
		issues.some((i) => i.severity === 'warn' && i.message.includes('毎秒')),
	);
});

test('29〜31日指定は実行されない月がある旨の警告が出る', () => {
	const s = parseCronExpression('0 0 31 * *');
	const issues = lintCronSchedule(s);
	assert.ok(
		issues.some(
			(i) => i.severity === 'warn' && i.message.includes('存在しない月'),
		),
	);
});

test('日と曜日を両方指定するとOR動作の情報が出る', () => {
	const s = parseCronExpression('0 0 1 * 1');
	const issues = lintCronSchedule(s);
	assert.ok(
		issues.some((i) => i.severity === 'info' && i.message.includes('OR')) ||
			issues.some((i) => i.message.includes('いずれかに一致')),
	);
});

test('通常の日次実行では警告が出ない', () => {
	const s = parseCronExpression('0 9 * * *');
	const issues = lintCronSchedule(s);
	assert.equal(issues.length, 0);
});

test('秒ステップによる高頻度実行（5秒おき）は警告される', () => {
	const s = parseCronExpression('*/5 * * * * *');
	const issues = lintCronSchedule(s);
	assert.ok(
		issues.some((i) => i.severity === 'warn' && i.message.includes('高頻度')),
	);
});

// --- 逆引き生成 -------------------------------------------------------

test('「毎日9時」から cron式を生成できる', () => {
	const result = generateCronFromJapanese('毎日9時');
	assert.ok(result.success);
	if (result.success) assert.equal(result.expr, '0 9 * * *');
});

test('「平日の9時と18時」から cron式を生成できる', () => {
	const result = generateCronFromJapanese('平日の9時と18時');
	assert.ok(result.success);
	if (result.success) assert.equal(result.expr, '0 9,18 * * 1-5');
});

test('「15分おき」から cron式を生成できる', () => {
	const result = generateCronFromJapanese('15分おき');
	assert.ok(result.success);
	if (result.success) assert.equal(result.expr, '*/15 * * * *');
});

test('「毎週月曜9時」から cron式を生成できる', () => {
	const result = generateCronFromJapanese('毎週月曜9時');
	assert.ok(result.success);
	if (result.success) assert.equal(result.expr, '0 9 * * 1');
});

test('「毎月1日0時」から cron式を生成できる', () => {
	const result = generateCronFromJapanese('毎月1日0時');
	assert.ok(result.success);
	if (result.success) assert.equal(result.expr, '0 0 1 * *');
});

test('解釈できない日本語入力は候補を提示する', () => {
	const result = generateCronFromJapanese('よくわからない指定');
	assert.equal(result.success, false);
	if (!result.success) assert.ok(result.suggestions.length > 0);
});

test('ラウンドトリップ: 生成したcron式を再パースして解説が入力意図と一致する', () => {
	const cases: [string, string][] = [
		['毎日9時', '毎日 9:00'],
		['毎週月曜9時', '毎週月曜 9:00'],
		['毎月1日0時', '毎月1日 0:00'],
	];
	for (const [jaInput, expectedDescription] of cases) {
		const gen = generateCronFromJapanese(jaInput);
		assert.ok(gen.success, `生成に失敗: ${jaInput}`);
		if (!gen.success) continue;
		const schedule = parseCronExpression(gen.expr);
		assert.equal(
			describeCronJapanese(schedule),
			expectedDescription,
			`不一致: ${jaInput}`,
		);
	}
});

// --- フォーマット別コピー -----------------------------------------------

test('crontab行はそのままのcron式を返す', () => {
	const s = parseCronExpression('0 9 * * 1');
	assert.equal(toCrontabLine(s).value, '0 9 * * 1');
});

test('GitHub Actions形式のYAMLスニペットを生成する', () => {
	const s = parseCronExpression('0 9 * * 1');
	const result = toGithubActionsSchedule(s);
	assert.match(result.value, /schedule:\n\s+- cron: '0 9 \* \* 1'/);
});

test('GitHub Actions形式: 分がワイルドカードの場合も*として出力される（回帰防止）', () => {
	const s = parseCronExpression('* 9 * * *');
	const result = toGithubActionsSchedule(s);
	assert.match(result.value, /schedule:\n\s+- cron: '\* 9 \* \* \*'/);
});

test('秒付きcron式はGitHub Actions形式に非対応の警告を返す', () => {
	const s = parseCronExpression('*/5 * * * * *');
	const result = toGithubActionsSchedule(s);
	assert.equal(result.value, '');
	assert.ok(result.warning);
});

test('AWS EventBridge形式のcron式を生成する（日指定優先で曜日は?）', () => {
	const s = parseCronExpression('0 12 1 * *');
	const result = toAwsEventBridgeCron(s);
	assert.equal(result.value, 'cron(0 12 1 * ? *)');
});

test('AWS EventBridge形式: 曜日指定時は日が?になり曜日はAWS基準(SUN=1)に変換される', () => {
	const s = parseCronExpression('0 9 * * 1');
	const result = toAwsEventBridgeCron(s);
	assert.equal(result.value, 'cron(0 9 ? * 2 *)');
});

// --- 現在分の秒候補（取りこぼし回帰） -----------------------------------

const iso = (ds: Date[]) => ds.map((d) => d.toISOString());

test('6フィールド */5 秒指定: 同じ分内の次回秒候補を返す', () => {
	const s = parseCronExpression('*/5 * * * * *');
	const from = new Date('2026-09-26T00:00:12Z');
	assert.deepEqual(
		iso(getNextRunTimes(s, { count: 3, from, timeZone: 'UTC' })),
		[
			'2026-09-26T00:00:15.000Z',
			'2026-09-26T00:00:20.000Z',
			'2026-09-26T00:00:25.000Z',
		],
	);
});

test('fromちょうどに一致する秒は再返却せず次の候補を返す', () => {
	const s = parseCronExpression('*/5 * * * * *');
	const from = new Date('2026-09-26T00:00:15Z');
	assert.deepEqual(
		iso(getNextRunTimes(s, { count: 2, from, timeZone: 'UTC' })),
		['2026-09-26T00:00:20.000Z', '2026-09-26T00:00:25.000Z'],
	);
});

test('ミリ秒付きfrom（15.500）でも15秒は返さず20秒から始まる', () => {
	const s = parseCronExpression('*/5 * * * * *');
	const from = new Date('2026-09-26T00:00:15.500Z');
	const [first] = getNextRunTimes(s, { count: 1, from, timeZone: 'UTC' });
	assert.equal(first.toISOString(), '2026-09-26T00:00:20.000Z');
});

test('分境界: 最終秒候補の後は翌分の先頭候補へ進む', () => {
	const s = parseCronExpression('*/20 * * * * *');
	const from = new Date('2026-09-26T00:00:41Z');
	assert.deepEqual(
		iso(getNextRunTimes(s, { count: 2, from, timeZone: 'UTC' })),
		['2026-09-26T00:01:00.000Z', '2026-09-26T00:01:20.000Z'],
	);
});

test('5フィールド: 現在分の0秒を過ぎていれば翌分、fromが0秒ちょうどなら翌分', () => {
	const s = parseCronExpression('* * * * *');
	assert.deepEqual(
		iso(
			getNextRunTimes(s, {
				count: 2,
				from: new Date('2026-09-26T00:00:12Z'),
				timeZone: 'UTC',
			}),
		),
		['2026-09-26T00:01:00.000Z', '2026-09-26T00:02:00.000Z'],
	);
	const [first] = getNextRunTimes(s, {
		count: 1,
		from: new Date('2026-09-26T00:00:00Z'),
		timeZone: 'UTC',
	});
	assert.equal(first.toISOString(), '2026-09-26T00:01:00.000Z');
});

test('日時指定（毎時30分 0秒）: 現在分がマッチしない場合は従来どおり', () => {
	const s = parseCronExpression('30 * * * *');
	const [first] = getNextRunTimes(s, {
		count: 1,
		from: new Date('2026-09-26T00:30:10Z'),
		timeZone: 'UTC',
	});
	assert.equal(first.toISOString(), '2026-09-26T01:30:00.000Z');
});

test('Asia/Tokyo: 6フィールドでも現在分の秒候補を取りこぼさない', () => {
	const s = parseCronExpression('*/5 * * * * *');
	const from = new Date('2026-09-26T00:00:12Z'); // JST 09:00:12
	assert.deepEqual(
		iso(getNextRunTimes(s, { count: 2, from, timeZone: 'Asia/Tokyo' })),
		['2026-09-26T00:00:15.000Z', '2026-09-26T00:00:20.000Z'],
	);
});

// --- DST fall-back（同じ壁時計分が2回現れる） ---------------------------

test('America/New_York 秋の巻き戻し: fromが2回目の01:00台でも同分の残り秒を返す', () => {
	const s = parseCronExpression('*/5 * * * * *');
	// 2026-11-01 06:00:00Z = 01:00:00 EST（01時台の2回目）
	const from = new Date('2026-11-01T06:00:12Z');
	assert.deepEqual(
		iso(getNextRunTimes(s, { count: 3, from, timeZone: 'America/New_York' })),
		[
			'2026-11-01T06:00:15.000Z',
			'2026-11-01T06:00:20.000Z',
			'2026-11-01T06:00:25.000Z',
		],
	);
});

test('America/New_York 秋の巻き戻し: 2回目の分の末尾からは翌分(2回目側)へ進む', () => {
	const s = parseCronExpression('*/20 * * * * *');
	const from = new Date('2026-11-01T06:00:41Z');
	assert.deepEqual(
		iso(getNextRunTimes(s, { count: 2, from, timeZone: 'America/New_York' })),
		['2026-11-01T06:01:00.000Z', '2026-11-01T06:01:20.000Z'],
	);
});

test('America/New_York 秋の巻き戻し: 1回目側のfromは従来どおり1回目の秒候補を返す', () => {
	const s = parseCronExpression('*/5 * * * * *');
	const from = new Date('2026-11-01T05:00:12Z'); // 01:00:12 EDT（1回目）
	const [first] = getNextRunTimes(s, {
		count: 1,
		from,
		timeZone: 'America/New_York',
	});
	assert.equal(first.toISOString(), '2026-11-01T05:00:15.000Z');
});

test('Europe/London 秋の巻き戻し: 1回目(BST)のfromでも同分の残り秒を返す', () => {
	const s = parseCronExpression('*/5 * * * * *');
	const from = new Date('2026-10-25T00:00:12Z'); // 01:00:12 BST（1回目）
	assert.deepEqual(
		iso(getNextRunTimes(s, { count: 2, from, timeZone: 'Europe/London' })),
		['2026-10-25T00:00:15.000Z', '2026-10-25T00:00:20.000Z'],
	);
});

test('Europe/London 秋の巻き戻し: 2回目(GMT)のfromでも同分の残り秒を返す', () => {
	const s = parseCronExpression('*/5 * * * * *');
	const from = new Date('2026-10-25T01:00:12Z'); // 01:00:12 GMT（2回目）
	assert.deepEqual(
		iso(getNextRunTimes(s, { count: 2, from, timeZone: 'Europe/London' })),
		['2026-10-25T01:00:15.000Z', '2026-10-25T01:00:20.000Z'],
	);
});

test('Australia/Lord_Howe 30分fold: 1回目・2回目どちらのfromでも同分の残り秒を返す', () => {
	const s = parseCronExpression('*/5 * * * * *');
	assert.deepEqual(
		iso(
			getNextRunTimes(s, {
				count: 2,
				from: new Date('2026-04-04T14:30:12Z'), // 01:30:12 +11（1回目）
				timeZone: 'Australia/Lord_Howe',
			}),
		),
		['2026-04-04T14:30:15.000Z', '2026-04-04T14:30:20.000Z'],
	);
	assert.deepEqual(
		iso(
			getNextRunTimes(s, {
				count: 2,
				from: new Date('2026-04-04T15:00:12Z'), // 01:30:12 +10:30（2回目）
				timeZone: 'Australia/Lord_Howe',
			}),
		),
		['2026-04-04T15:00:15.000Z', '2026-04-04T15:00:20.000Z'],
	);
});

test('Antarctica/Troll 2時間fold: 1回目・2回目どちらのfromでも同分の残り秒を返す', () => {
	const s = parseCronExpression('*/5 * * * * *');
	assert.deepEqual(
		iso(
			getNextRunTimes(s, {
				count: 2,
				from: new Date('2026-10-24T23:00:12Z'), // 01:00:12 +02:00（1回目）
				timeZone: 'Antarctica/Troll',
			}),
		),
		['2026-10-24T23:00:15.000Z', '2026-10-24T23:00:20.000Z'],
	);
	assert.deepEqual(
		iso(
			getNextRunTimes(s, {
				count: 2,
				from: new Date('2026-10-25T01:00:12Z'), // 01:00:12 +00:00（2回目）
				timeZone: 'Antarctica/Troll',
			}),
		),
		['2026-10-25T01:00:15.000Z', '2026-10-25T01:00:20.000Z'],
	);
});

test('DST spring-forward: 存在しない壁時計時刻を返さず時系列順を保つ', () => {
	assert.deepEqual(
		iso(
			getNextRunTimes(parseCronExpression('59 * * * * *'), {
				count: 3,
				from: new Date('2026-03-08T06:59:58Z'),
				timeZone: 'America/New_York',
			}),
		),
		[
			'2026-03-08T06:59:59.000Z',
			'2026-03-08T07:00:59.000Z',
			'2026-03-08T07:01:59.000Z',
		],
	);
});

test('DST fall-back: 1回目の末尾から2回目の先頭へ連続して進む', () => {
	assert.deepEqual(
		iso(
			getNextRunTimes(parseCronExpression('* * * * * *'), {
				count: 3,
				from: new Date('2026-11-01T05:59:58Z'),
				timeZone: 'America/New_York',
			}),
		),
		[
			'2026-11-01T05:59:59.000Z',
			'2026-11-01T06:00:00.000Z',
			'2026-11-01T06:00:01.000Z',
		],
	);
	assert.equal(
		getNextRunTimes(parseCronExpression('0 0 1 * * *'), {
			count: 1,
			from: new Date('2026-11-01T05:59:58Z'),
			timeZone: 'America/New_York',
		})[0].toISOString(),
		'2026-11-01T06:00:00.000Z',
	);
});

test('高頻度スケジュール: Intl formatterを候補ごとに生成しない', () => {
	const Original = Intl.DateTimeFormat;
	let constructions = 0;
	Intl.DateTimeFormat = new Proxy(Original, {
		construct(target, args) {
			constructions++;
			return Reflect.construct(target, args);
		},
	});
	try {
		const dates = getNextRunTimes(parseCronExpression('* * * * * *'), {
			count: 50,
			from: new Date('2026-09-26T00:00:12Z'),
			timeZone: 'Asia/Tokyo',
		});
		assert.equal(dates.length, 50);
		assert.ok(constructions <= 1, `formatter creations: ${constructions}`);
		for (let i = 1; i < dates.length; i++)
			assert.equal(dates[i].getTime() - dates[i - 1].getTime(), 1000);
	} finally {
		Intl.DateTimeFormat = Original;
	}
});

test('疎な式: 8年を超える結果一覧でも各次回候補を探索する', () => {
	const annual = getNextRunTimes(parseCronExpression('0 0 1 1 *'), {
		from: new Date('2026-01-01T00:00:00Z'),
		timeZone: 'UTC',
	});
	assert.equal(annual.length, 10);
	assert.equal(annual[9].getUTCFullYear(), 2036);
	const leap = getNextRunTimes(parseCronExpression('0 0 29 2 *'), {
		from: new Date('2026-01-01T00:00:00Z'),
		timeZone: 'UTC',
	});
	assert.deepEqual(
		leap.map((d) => d.getUTCFullYear()),
		[2028, 2032, 2036, 2040, 2044, 2048, 2052, 2056, 2060, 2064],
	);
});

test('疎な年次式: UI/MCPの一覧で毎分のタイムゾーン変換をしない', () => {
	const original = Intl.DateTimeFormat.prototype.formatToParts;
	let calls = 0;
	Intl.DateTimeFormat.prototype.formatToParts = function (...args) {
		calls++;
		return original.apply(this, args);
	};
	try {
		for (const timeZone of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
			calls = 0;
			const dates = getNextRunTimes(parseCronExpression('0 0 1 1 *'), {
				count: 50,
				from: new Date('2026-01-01T00:00:00Z'),
				timeZone,
			});
			assert.equal(dates.length, 50);
			assert.ok(calls < 12_000, `${timeZone}: ${calls} timezone conversions`);
		}
	} finally {
		Intl.DateTimeFormat.prototype.formatToParts = original;
	}
});

test('疎な週次・年次式: 1回目の一致直後にもfoldの2回目を返す', () => {
	for (const [expression, timeZone, first, repeated] of [
		[
			'0 1 * * 0',
			'America/New_York',
			'2026-11-01T05:00:00Z',
			'2026-11-01T06:00:00.000Z',
		],
		[
			'0 1 1 11 *',
			'America/New_York',
			'2026-11-01T05:00:00Z',
			'2026-11-01T06:00:00.000Z',
		],
		[
			'30 1 * * 0',
			'Australia/Lord_Howe',
			'2026-04-04T14:30:00Z',
			'2026-04-04T15:00:00.000Z',
		],
		[
			'0 1 * * 0',
			'Antarctica/Troll',
			'2026-10-24T23:00:00Z',
			'2026-10-25T01:00:00.000Z',
		],
	]) {
		for (const delay of [0, 12_000, 60_000]) {
			assert.equal(
				getNextRunTimes(parseCronExpression(expression), {
					timeZone,
					from: new Date(Date.parse(first) + delay),
					count: 1,
				})[0].toISOString(),
				repeated,
			);
		}
	}
});
