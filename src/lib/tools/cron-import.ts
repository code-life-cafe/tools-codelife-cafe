// 他サービスのスケジュール式（AWS EventBridge の cron()/rate()、GitHub Actions の schedule、
// systemd timer の OnCalendar=）を
// 標準5フィールドのcron式へ読み替える純粋関数。DOM/React非依存。
//
// cron式チェッカーの解析欄は入力をJST（Asia/Tokyo）として扱うため、UTCで評価される式は
// 9時間ずらしたJSTのcron式へ換算する。1行のcron式で同じ日時を表せない場合は換算しない。

import {
	CronParseError,
	type CronSchedule,
	getNextRunTimes,
	parseCronExpression,
} from './cron-checker.ts';

export type ScheduleImportFormat =
	| 'aws-cron'
	| 'aws-rate'
	| 'github-actions'
	| 'systemd';

export interface ScheduleImportSuccess {
	success: true;
	format: ScheduleImportFormat;
	/** 画面に出す形式名 */
	formatLabel: string;
	/** 元のタイムゾーンのままの標準5フィールドcron式。cronで表せない場合はnull */
	sourceExpr: string | null;
	/** 元の式を評価するタイムゾーン（rate式のように時刻に依存しない場合はnull） */
	sourceTimeZone: string | null;
	/** 画面に出すタイムゾーンの説明（sourceTimeZoneをそのまま出さない場合だけ） */
	sourceTimeZoneLabel?: string;
	/** 解析欄（JST）へ反映できるcron式。換算できない場合はnull */
	jstExpr: string | null;
	/** 変換で補った点・サービス固有の注意（エラーではない） */
	notes: string[];
}

export interface ScheduleImportFailure {
	success: false;
	error: string;
}

export type ScheduleImportResult =
	| ScheduleImportSuccess
	| ScheduleImportFailure;

const JST_OFFSET_HOURS = 9;
/** 月末をまたがない日の上限（2月の28日を考慮し、翌日も同じ月に収まる日） */
const MAX_SHIFTABLE_DAY = 27;

const AWS_DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const UNSUPPORTED_INPUT_MESSAGE =
	"AWS EventBridgeの cron(...) / rate(...)、GitHub Actionsの cron: '...'、またはsystemd timerの OnCalendar=... を貼り付けてください（標準のcron式は上の解析欄に入力してください）。";

function fail(error: string): ScheduleImportFailure {
	return { success: false, error };
}

// --- UTC → JST 換算 --------------------------------------------------------

function compressList(values: number[]): string {
	if (values.length >= 3) {
		const d = values[1] - values[0];
		const isProgression =
			d > 1 && values.every((v, i) => v === values[0] + i * d);
		if (isProgression) {
			return `${values[0]}-${values[values.length - 1]}/${d}`;
		}
	}
	const parts: string[] = [];
	let i = 0;
	while (i < values.length) {
		let j = i;
		while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++;
		if (j - i >= 2) {
			parts.push(`${values[i]}-${values[j]}`);
		} else {
			for (let k = i; k <= j; k++) parts.push(String(values[k]));
		}
		i = j + 1;
	}
	return parts.join(',');
}

function sortedUnique(values: number[]): number[] {
	return [...new Set(values)].sort((a, b) => a - b);
}

interface ShiftResult {
	expr: string | null;
	note?: string;
}

/**
 * UTCとして評価する5フィールドのcron式を、同じ日時に実行するJSTのcron式へ換算する。
 * 日付をまたぐ時刻が混在するなど、1行で同じ日時を表せない場合は expr を null にする。
 */
export function shiftUtcCronToJst(utcExpr: string): ShiftResult {
	const schedule = parseCronExpression(utcExpr);
	if (schedule.hasSeconds) {
		throw new CronParseError('秒付きのcron式は換算できません');
	}
	const [minute, hourRaw, domRaw, month, dowRaw] = utcExpr.trim().split(/\s+/);
	const { hours, daysOfMonth, daysOfWeek, months } = schedule;
	const domWild = daysOfMonth.isWildcard;
	const dowWild = daysOfWeek.isWildcard;
	const monthWild = months.isWildcard;

	const build = (h: string, dom: string, dow: string) =>
		`${minute} ${h} ${dom} ${month} ${dow}`;

	// 毎日実行される式は、時をずらすだけで同じ日時になる
	if (domWild && dowWild && monthWild) {
		if (hours.isWildcard) return { expr: build(hourRaw, domRaw, dowRaw) };
		const shifted = sortedUnique(
			hours.values.map((h) => (h + JST_OFFSET_HOURS) % 24),
		);
		return { expr: build(compressList(shifted), domRaw, dowRaw) };
	}

	const wraps = hours.values.map((h) => h + JST_OFFSET_HOURS >= 24);
	if (wraps.every((w) => !w)) {
		const shifted = hours.values.map((h) => h + JST_OFFSET_HOURS);
		return { expr: build(compressList(shifted), domRaw, dowRaw) };
	}

	const cannot: ShiftResult = {
		expr: null,
		note: 'UTCの時刻をJSTにすると日付をまたぐ実行が含まれるため、JSTのcron式1行では同じ日時を表せません。UTCの式と次回実行日時の目安を確認してください。',
	};
	if (!wraps.every((w) => w)) return cannot;

	// 全ての時刻がJSTで翌日になる。日・曜日を1日ずらす。
	const domMax = Math.max(...daysOfMonth.values);
	if (!domWild && domMax > MAX_SHIFTABLE_DAY) return cannot;
	// 月の指定があると、月末の夜（UTC）が翌月（JST）になるため、日だけを指定した場合に限る
	if (!monthWild && !(dowWild && !domWild)) return cannot;

	const shiftedHours = compressList(
		sortedUnique(hours.values.map((h) => h + JST_OFFSET_HOURS - 24)),
	);
	const dom = domWild
		? domRaw
		: compressList(sortedUnique(daysOfMonth.values.map((d) => d + 1)));
	const dow = dowWild
		? dowRaw
		: compressList(sortedUnique(daysOfWeek.values.map((d) => (d + 1) % 7)));
	return { expr: build(shiftedHours, dom, dow) };
}

// --- AWS EventBridge cron() -------------------------------------------------

function convertAwsDowToken(token: string): string {
	const upper = token.trim().toUpperCase();
	if (AWS_DOW_NAMES.includes(upper)) return upper;
	if (!/^\d+$/.test(upper)) {
		throw new CronParseError(
			`曜日フィールドの値「${token}」を解釈できません（1〜7 または SUN〜SAT）`,
		);
	}
	const n = Number.parseInt(upper, 10);
	if (n < 1 || n > 7) {
		throw new CronParseError(
			`AWSの曜日は1（日曜）〜7（土曜）で指定してください（指定値: ${token}）`,
		);
	}
	return String(n - 1);
}

/** AWSの曜日（1=日曜〜7=土曜）を、標準cronの曜日（0=日曜〜6=土曜）へ変換する */
function convertAwsDowField(field: string): string {
	if (field === '*') return '*';
	return field
		.split(',')
		.map((part) => {
			const segments = part.split('/');
			if (segments.length > 2) {
				throw new CronParseError(
					`曜日フィールドの指定「${part}」を解釈できません`,
				);
			}
			const [range, step] = segments;
			let converted: string;
			if (range === '*') {
				converted = '*';
			} else if (range.includes('-')) {
				const [a, b] = range.split('-');
				converted = `${convertAwsDowToken(a)}-${convertAwsDowToken(b)}`;
			} else {
				converted = convertAwsDowToken(range);
				// 「開始/幅」は土曜までの範囲。標準cronの曜日は7（日曜）まであるため範囲を明示する
				if (step !== undefined) converted = `${converted}-6`;
			}
			return step === undefined ? converted : `${converted}/${step}`;
		})
		.join(',');
}

function importAwsCron(inner: string): ScheduleImportResult {
	const fields = inner.trim().split(/\s+/);
	if (fields.length !== 6 || fields[0] === '') {
		return fail(
			`AWS EventBridgeのcron式は6フィールド（分 時 日 月 曜日 年）が必要ですが、${inner.trim() === '' ? 0 : fields.length}個検出されました。`,
		);
	}
	const [minute, hour, dom, month, dow, year] = fields;

	for (const [label, value] of [
		['分', minute],
		['時', hour],
		['月', month],
		['年', year],
	] as const) {
		if (value.includes('?')) {
			return fail(
				`「?」は日または曜日のフィールドにだけ指定できます（${label}フィールド: ${value}）。`,
			);
		}
	}
	if (/[LW]/i.test(dom)) {
		return fail(
			`日フィールドの「L」（月末）・「W」（最も近い平日）には未対応です（指定値: ${dom}）。`,
		);
	}
	if (dow.includes('#') || /(^|,)\d*L($|,)/i.test(dow)) {
		return fail(
			`曜日フィールドの「#」（第n曜日）・「L」（最終曜日）には未対応です（指定値: ${dow}）。`,
		);
	}
	const domQ = dom === '?';
	const dowQ = dow === '?';
	if (domQ === dowQ) {
		return fail(
			domQ
				? '日と曜日の両方を「?」にはできません。どちらか一方だけを「?」にしてください。'
				: 'AWS EventBridgeでは日と曜日のどちらか一方を「?」にする必要があります（両方の指定は受け付けられません）。',
		);
	}
	if ((dom.includes('?') && !domQ) || (dow.includes('?') && !dowQ)) {
		return fail('「?」は他の値と組み合わせずに単独で指定してください。');
	}

	const notes: string[] = [];
	if (year !== '*') {
		if (!/^[\d,\-/*]+$/.test(year)) {
			return fail(`年フィールドの値「${year}」を解釈できません。`);
		}
		notes.push(
			`年の指定（${year}）は標準のcron式に含められないため、反映していません。次回実行日時は年を問わずに表示します。`,
		);
	}

	let sourceExpr: string;
	try {
		sourceExpr = `${minute} ${hour} ${domQ ? '*' : dom} ${month} ${dowQ ? '*' : convertAwsDowField(dow)}`;
		parseCronExpression(sourceExpr);
	} catch (e) {
		return fail(
			e instanceof CronParseError ? e.message : 'cron式を解釈できませんでした',
		);
	}

	notes.push(
		'EventBridgeルールのcron式はUTCで評価されるため、UTCとして読み込みました（EventBridge Schedulerでタイムゾーンを指定している場合は、そのタイムゾーンの時刻です）。',
	);
	const shifted = shiftUtcCronToJst(sourceExpr);
	if (shifted.note) notes.push(shifted.note);

	return {
		success: true,
		format: 'aws-cron',
		formatLabel: 'AWS EventBridge（cron式）',
		sourceExpr,
		sourceTimeZone: 'UTC',
		jstExpr: shifted.expr,
		notes,
	};
}

// --- AWS EventBridge rate() -------------------------------------------------

const RATE_UNITS: Record<string, 'minute' | 'hour' | 'day'> = {
	minute: 'minute',
	minutes: 'minute',
	hour: 'hour',
	hours: 'hour',
	day: 'day',
	days: 'day',
};

function rateToCron(value: number, unit: 'minute' | 'hour' | 'day') {
	const minutes =
		unit === 'minute' ? value : unit === 'hour' ? value * 60 : value * 1440;
	if (minutes < 60 && 60 % minutes === 0) {
		return minutes === 1 ? '* * * * *' : `*/${minutes} * * * *`;
	}
	if (minutes % 60 === 0) {
		const hours = minutes / 60;
		if (hours < 24 && 24 % hours === 0) {
			return hours === 1 ? '0 * * * *' : `0 */${hours} * * *`;
		}
		if (hours === 24) return '0 0 * * *';
	}
	return null;
}

function importAwsRate(inner: string): ScheduleImportResult {
	const match = inner.trim().match(/^(\d+)\s+([a-zA-Z]+)$/);
	if (!match) {
		return fail(
			'rate式は「rate(値 単位)」の形で指定してください（例: rate(5 minutes)）。',
		);
	}
	const value = Number.parseInt(match[1], 10);
	const unitRaw = match[2].toLowerCase();
	const unit = RATE_UNITS[unitRaw];
	if (!unit) {
		return fail(
			`rate式の単位「${match[2]}」を解釈できません（minute(s)・hour(s)・day(s)）。`,
		);
	}
	if (value < 1) {
		return fail('rate式の値は1以上で指定してください。');
	}
	const plural = unitRaw.endsWith('s');
	if (value === 1 && plural) {
		return fail(
			`値が1のときは単数形で指定してください（例: rate(1 ${unit})）。AWSは「rate(1 ${unit}s)」を受け付けません。`,
		);
	}
	if (value > 1 && !plural) {
		return fail(
			`値が2以上のときは複数形で指定してください（例: rate(${value} ${unit}s)）。`,
		);
	}

	const cron = rateToCron(value, unit);
	const notes = [
		'rate式はルールを作成・有効化した時刻を起点に一定間隔で実行されます。cron式への換算は間隔の目安で、実際の実行分・時刻はずれます。',
	];
	if (!cron) {
		notes.push(
			`${value} ${unit === 'minute' ? '分' : unit === 'hour' ? '時間' : '日'}ごとの間隔は、cron式では同じ間隔で表せません（月や日の変わり目で間隔がずれるため）。`,
		);
	}
	return {
		success: true,
		format: 'aws-rate',
		formatLabel: 'AWS EventBridge（rate式）',
		sourceExpr: cron,
		sourceTimeZone: null,
		jstExpr: cron,
		notes,
	};
}

// --- GitHub Actions ---------------------------------------------------------

function stripYamlScalar(raw: string): string {
	const value = raw.trim();
	const quoted = value.match(/^(['"])(.*?)\1\s*(?:#.*)?$/);
	if (quoted) return quoted[2].trim();
	return value.replace(/\s+#.*$/, '').trim();
}

/** 5分未満の間隔で実行される日時があるか（先の50件で確認する） */
function hasIntervalUnder5Minutes(schedule: CronSchedule): boolean {
	let runs: Date[];
	try {
		runs = getNextRunTimes(schedule, {
			count: 50,
			from: new Date(Date.UTC(2027, 0, 4, 0, 0, 0)),
			timeZone: 'UTC',
		});
	} catch {
		return false;
	}
	for (let i = 1; i < runs.length; i++) {
		if (runs[i].getTime() - runs[i - 1].getTime() < 5 * 60 * 1000) return true;
	}
	return false;
}

/** 行頭の空白と「- 」を除いた、キーが始まる桁 */
function yamlKeyColumn(line: string): number {
	return (line.match(/^\s*(?:-\s+)?/) as RegExpMatchArray)[0].length;
}

const CRON_LINE = /^\s*(?:-\s*)?cron\s*:\s*(.*)$/;
const TIMEZONE_LINE = /^\s*(?:-\s*)?timezone\s*:\s*(.*)$/;

/**
 * cronの行と同じschedule項目にある timezone: だけを返す。
 * 別の項目や、stepの with: などにある timezone: は使わない。
 * 貼り付けで先頭行の字下げが落ちることがあるため、cronより後ろの兄弟キーの桁は
 * 「cronの行より深い（項目の始まりなら）／同じ以上の（そうでなければ）最初のキー行」の字下げで決める。
 */
function findTimezoneOfItem(lines: string[], cronIndex: number) {
	const cronLine = lines[cronIndex];
	const tzValue = (line: string) =>
		stripYamlScalar((line.match(TIMEZONE_LINE) as RegExpMatchArray)[1]);
	const startsItem = (line: string) => /^\s*-\s/.test(line);
	const indentOf = (line: string) =>
		(line.match(/^\s*/) as RegExpMatchArray)[0].length;
	const skip = (line: string) =>
		line.trim() === '' || line.trim().startsWith('#');

	// 後ろへ: 項目の終わり（兄弟キーより浅い行、または次の「- 」）まで
	const cronIndent = indentOf(cronLine);
	const cronStartsItem = startsItem(cronLine);
	let siblingColumn: number | undefined;
	for (let i = cronIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (skip(line)) continue;
		const indent = indentOf(line);
		if (siblingColumn === undefined) {
			const outside = cronStartsItem
				? indent <= cronIndent
				: indent < cronIndent;
			if (outside || startsItem(line)) break;
			siblingColumn = indent;
		}
		if (indent < siblingColumn) break;
		if (indent === siblingColumn && startsItem(line)) break;
		if (indent === siblingColumn && TIMEZONE_LINE.test(line)) {
			return tzValue(line);
		}
	}
	// 前へ: cronの行が項目の始まりでなければ、項目の「- 」の行まで
	if (!cronStartsItem) {
		const column = cronIndent;
		const isTimezone = (line: string) =>
			TIMEZONE_LINE.test(line) && yamlKeyColumn(line) === column;
		for (let i = cronIndex - 1; i >= 0; i--) {
			const line = lines[i];
			if (skip(line)) continue;
			if (startsItem(line)) {
				if (yamlKeyColumn(line) !== column) break;
				return isTimezone(line) ? tzValue(line) : undefined;
			}
			if (indentOf(line) < column) break;
			if (isTimezone(line)) return tzValue(line);
		}
	}
	return undefined;
}

function importGithubActions(text: string): ScheduleImportResult {
	const lines = text.split(/\r?\n/);
	const crons: string[] = [];
	let firstCronIndex = -1;
	lines.forEach((line, i) => {
		const cronMatch = line.match(CRON_LINE);
		if (!cronMatch) return;
		if (firstCronIndex < 0) firstCronIndex = i;
		crons.push(stripYamlScalar(cronMatch[1]));
	});
	if (crons.length === 0 || crons[0] === '') {
		return fail(
			"GitHub Actionsの schedule から cron: '...' の行を見つけられませんでした。",
		);
	}

	const timezone = findTimezoneOfItem(lines, firstCronIndex);
	const notes: string[] = [];
	if (crons.length > 1) {
		notes.push(
			`cronが${crons.length}件あるため、最初の1件（${crons[0]}）を読み込みました。`,
		);
	}
	const expr = crons[0];
	let schedule: CronSchedule;
	try {
		schedule = parseCronExpression(expr);
	} catch (e) {
		return fail(
			e instanceof CronParseError ? e.message : 'cron式を解釈できませんでした',
		);
	}
	if (schedule.hasSeconds) {
		return fail(
			'GitHub Actionsのscheduleは秒フィールドに対応していません（5フィールドで指定してください）。',
		);
	}
	if (hasIntervalUnder5Minutes(schedule)) {
		notes.push(
			'GitHub Actionsのscheduleは最短5分間隔です。これより短い間隔を指定しても、5分より短い間隔では実行されません。',
		);
	}
	notes.push(
		'GitHub Actionsのscheduleは、高負荷の時間帯（毎時0分など）に開始が遅れたり、実行されなかったりすることがあります。',
	);

	const tz = timezone ?? '';
	let sourceTimeZone: string;
	let jstExpr: string | null;
	if (tz === '' || tz === 'UTC' || tz === 'Etc/UTC') {
		sourceTimeZone = 'UTC';
		notes.unshift(
			tz === ''
				? 'timezoneの指定がないため、GitHub Actionsの既定どおりUTCとして読み込みました。'
				: 'timezoneの指定（UTC）どおりUTCとして読み込みました。',
		);
		const shifted = shiftUtcCronToJst(expr);
		jstExpr = shifted.expr;
		if (shifted.note) notes.push(shifted.note);
	} else if (tz === 'Asia/Tokyo') {
		sourceTimeZone = 'Asia/Tokyo';
		jstExpr = expr;
		notes.unshift(
			'timezoneの指定（Asia/Tokyo）どおりJSTとして読み込みました。',
		);
	} else {
		let valid = true;
		try {
			new Intl.DateTimeFormat('en-US', { timeZone: tz });
		} catch {
			valid = false;
		}
		if (!valid) {
			return fail(`timezoneの値「${tz}」を解釈できません。`);
		}
		sourceTimeZone = tz;
		jstExpr = null;
		notes.unshift(
			`timezone（${tz}）はUTC・Asia/Tokyo以外のため、JSTへの換算はしていません。`,
		);
	}

	return {
		success: true,
		format: 'github-actions',
		formatLabel: 'GitHub Actions（schedule）',
		sourceExpr: expr,
		sourceTimeZone,
		jstExpr,
		notes,
	};
}

// --- systemd timer（OnCalendar=） -------------------------------------------

/** 月曜始まりの順（systemdの曜日範囲の順）。cronの曜日は index+1 を7で割った余り */
const SYSTEMD_WEEKDAYS = [
	['mon', 'monday'],
	['tue', 'tuesday'],
	['wed', 'wednesday'],
	['thu', 'thursday'],
	['fri', 'friday'],
	['sat', 'saturday'],
	['sun', 'sunday'],
] as const;

const SYSTEMD_SHORTHANDS: Record<string, string> = {
	minutely: '*-*-* *:*:00',
	hourly: '*-*-* *:00:00',
	daily: '*-*-* 00:00:00',
	weekly: 'Mon *-*-* 00:00:00',
	monthly: '*-*-01 00:00:00',
	yearly: '*-01-01 00:00:00',
	annually: '*-01-01 00:00:00',
	quarterly: '*-01,04,07,10-01 00:00:00',
	semiannually: '*-01,07-01 00:00:00',
};

const SYSTEMD_FORMAT_HINT =
	'書式は「[曜日] [年-]月-日 時:分:秒 [タイムゾーン]」です（例: Mon..Fri *-*-* 09:00:00 Asia/Tokyo）。';

interface SystemdSpec {
	seconds: number[];
	minutes: number[];
	hours: number[];
	days: number[];
	months: number[];
	/** cronの曜日（0=日曜〜6=土曜）。全曜日ならnull */
	weekdays: number[] | null;
	year: string;
	timeZone: string | null;
}

function rangeValues(min: number, max: number): number[] {
	return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

function sameValues(a: number[] | null, b: number[] | null): boolean {
	if (a === null || b === null) return a === b;
	return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** 数値のフィールド（`*`・`,`・`A..B`・`A/幅`・`A..B/幅`）を値の一覧にする */
function parseSystemdNumbers(
	raw: string,
	min: number,
	max: number,
	label: string,
): number[] {
	if (raw === '*') return rangeValues(min, max);
	const values = new Set<number>();
	for (const part of raw.split(',')) {
		const m = part.match(/^(\d+)(?:\.\.(\d+))?(?:\/(\d+))?$/);
		if (!m) {
			if (part.startsWith('*/')) {
				throw new CronParseError(
					`${label}の「${part}」はsystemdでは使えません。「${min === 0 ? '00' : '01'}/${part.slice(2)}」のように開始値から書いてください。`,
				);
			}
			if (label === '秒' && /\d\.\d/.test(part)) {
				throw new CronParseError(
					`小数の秒（${part}）には対応していません。cronは秒単位までです。`,
				);
			}
			throw new CronParseError(`${label}の指定「${part}」を解釈できません。`);
		}
		const start = Number.parseInt(m[1], 10);
		const step = m[3] === undefined ? 1 : Number.parseInt(m[3], 10);
		const end =
			m[2] !== undefined
				? Number.parseInt(m[2], 10)
				: m[3] !== undefined
					? max
					: start;
		if (start < min || start > max || end < min || end > max) {
			throw new CronParseError(
				`${label}は${min}〜${max}の範囲で指定してください（指定値: ${part}）。`,
			);
		}
		if (end < start) {
			throw new CronParseError(
				`${label}の範囲「${part}」は小さい値から大きい値の順に書いてください。`,
			);
		}
		if (step < 1 || step > max) {
			throw new CronParseError(
				`${label}の幅（/の後ろ）は1〜${max}で指定してください（指定値: ${part}）。`,
			);
		}
		for (let v = start; v <= end; v += step) values.add(v);
	}
	return [...values].sort((a, b) => a - b);
}

function systemdWeekdayIndex(name: string): number {
	const lower = name.toLowerCase();
	const index = SYSTEMD_WEEKDAYS.findIndex(
		([short, long]) => lower === short || lower === long,
	);
	if (index < 0) {
		throw new CronParseError(
			`曜日「${name}」を解釈できません（Mon〜Sun または Monday〜Sunday）。`,
		);
	}
	return index;
}

function isWeekdayToken(token: string): boolean {
	return token
		.split(',')
		.flatMap((part) => part.split('..'))
		.every((name) =>
			SYSTEMD_WEEKDAYS.some(
				([short, long]) =>
					name.toLowerCase() === short || name.toLowerCase() === long,
			),
		);
}

/** 曜日（`Mon,Wed`・`Mon..Fri`）をcronの曜日（0=日曜〜6=土曜）の一覧にする。全曜日ならnull */
function parseSystemdWeekdays(raw: string): number[] | null {
	const values = new Set<number>();
	for (const part of raw.split(',')) {
		const names = part.split('..');
		if (names.length > 2 || names.some((n) => n === '')) {
			throw new CronParseError(`曜日の指定「${part}」を解釈できません。`);
		}
		const start = systemdWeekdayIndex(names[0]);
		const end = names.length === 2 ? systemdWeekdayIndex(names[1]) : start;
		if (end < start) {
			throw new CronParseError(
				`曜日の範囲「${part}」はsystemdでは使えません。systemdの曜日は月曜始まりの順で、日曜をまたぐ範囲は「Fri..Sun,Mon」のように分けて書きます。`,
			);
		}
		for (let i = start; i <= end; i++) values.add((i + 1) % 7);
	}
	if (values.size === 7) return null;
	return [...values].sort((a, b) => a - b);
}

/** OnCalendar= の値（1行分）を解釈する */
function parseOnCalendar(value: string): SystemdSpec {
	let tokens = value.trim().split(/\s+/).filter(Boolean);
	const shorthandKey = tokens[0]?.toLowerCase() ?? '';
	const shorthand = Object.hasOwn(SYSTEMD_SHORTHANDS, shorthandKey)
		? SYSTEMD_SHORTHANDS[shorthandKey]
		: undefined;
	if (shorthand) tokens = [...shorthand.split(' '), ...tokens.slice(1)];

	let i = 0;
	let weekdayRaw: string | undefined;
	let dateRaw = '*-*-*';
	let timeRaw = '00:00:00';
	let timeZone: string | null = null;
	if (i < tokens.length && isWeekdayToken(tokens[i])) {
		weekdayRaw = tokens[i++];
	}
	if (i < tokens.length && /^[\d*.,/~]+-[\d*.,/~-]+$/.test(tokens[i])) {
		dateRaw = tokens[i++];
	}
	if (i < tokens.length && tokens[i].includes(':')) {
		timeRaw = tokens[i++];
	}
	if (i < tokens.length && i > 0 && /^[A-Za-z]/.test(tokens[i])) {
		timeZone = tokens[i++];
	}
	if (i < tokens.length) {
		throw new CronParseError(
			`「${tokens[i]}」を解釈できません。${SYSTEMD_FORMAT_HINT}`,
		);
	}

	if (dateRaw.includes('~')) {
		throw new CronParseError(
			`月末から数える日（「~」、指定値: ${dateRaw}）には対応していません。`,
		);
	}
	const dateParts = dateRaw.split('-');
	if (dateParts.length < 2 || dateParts.length > 3) {
		throw new CronParseError(
			`日付「${dateRaw}」を解釈できません。${SYSTEMD_FORMAT_HINT}`,
		);
	}
	const [yearRaw, monthRaw, dayRaw] =
		dateParts.length === 3 ? dateParts : ['*', ...dateParts];
	if (yearRaw !== '*' && !/^[\d,./]+$/.test(yearRaw)) {
		throw new CronParseError(`年の指定「${yearRaw}」を解釈できません。`);
	}

	const timeParts = timeRaw.split(':');
	if (timeParts.length < 2 || timeParts.length > 3) {
		throw new CronParseError(
			`時刻「${timeRaw}」を解釈できません。${SYSTEMD_FORMAT_HINT}`,
		);
	}
	const [hourRaw, minuteRaw, secondRaw = '00'] = timeParts;

	if (timeZone !== null) {
		try {
			new Intl.DateTimeFormat('en-US', { timeZone });
		} catch {
			throw new CronParseError(`タイムゾーン「${timeZone}」を解釈できません。`);
		}
	}

	return {
		seconds: parseSystemdNumbers(secondRaw, 0, 59, '秒'),
		minutes: parseSystemdNumbers(minuteRaw, 0, 59, '分'),
		hours: parseSystemdNumbers(hourRaw, 0, 23, '時'),
		days: parseSystemdNumbers(dayRaw, 1, 31, '日'),
		months: parseSystemdNumbers(monthRaw, 1, 12, '月'),
		weekdays:
			weekdayRaw === undefined ? null : parseSystemdWeekdays(weekdayRaw),
		year: yearRaw,
		timeZone,
	};
}

/** 値の一覧をcronの1フィールドにする（全範囲は `*`、最小値から最後まで続く等間隔は `*\/幅`） */
function toCronField(values: number[], min: number, max: number): string {
	if (values.length === max - min + 1) return '*';
	if (values.length >= 2 && values[0] === min) {
		const d = values[1] - values[0];
		const isProgression = d > 1 && values.every((v, i) => v === min + i * d);
		if (isProgression && values[values.length - 1] + d > max) return `*/${d}`;
	}
	return compressList(values);
}

/**
 * dowOverride を渡すと、日と曜日の両指定（OR条件）のcron式にする。このとき日は `*\/幅` にしない
 * （Vixie cronは先頭が `*` の日を「指定なし」とみなし、曜日とのAND相当になるため）。
 */
function specToCron(spec: SystemdSpec, dowOverride?: number[]): string {
	const dowValues = dowOverride ?? spec.weekdays;
	const fields = [
		toCronField(spec.minutes, 0, 59),
		toCronField(spec.hours, 0, 23),
		dowOverride ? compressList(spec.days) : toCronField(spec.days, 1, 31),
		toCronField(spec.months, 1, 12),
		dowValues === null ? '*' : compressList(dowValues),
	];
	const hasSeconds = !(spec.seconds.length === 1 && spec.seconds[0] === 0);
	if (hasSeconds) fields.unshift(toCronField(spec.seconds, 0, 59));
	return fields.join(' ');
}

const ALL_DAYS_COUNT = 31;

function importSystemd(text: string): ScheduleImportResult {
	const values = text
		.split(/\r?\n/)
		.map((line) => line.match(/^\s*OnCalendar\s*=\s*(.*?)\s*$/i)?.[1])
		.filter((v): v is string => v !== undefined && v !== '');
	if (values.length === 0) {
		return fail(
			'OnCalendar= の値が空です。OnCalendar=Mon..Fri *-*-* 09:00:00 のように値を書いてください。',
		);
	}

	const notes: string[] = [];
	let specs: SystemdSpec[];
	try {
		specs = values.map(parseOnCalendar);
	} catch (e) {
		return fail(
			e instanceof CronParseError ? e.message : '式を解釈できませんでした',
		);
	}

	const isAnd = (s: SystemdSpec) =>
		s.weekdays !== null && s.days.length !== ALL_DAYS_COUNT;
	let sourceExpr: string;
	// 日だけの行と曜日だけの行が、同じ時刻・月・タイムゾーンなら、cronの日と曜日のOR条件1行にまとめる
	const daySpec = specs.find(
		(s) => s.weekdays === null && s.days.length !== ALL_DAYS_COUNT,
	);
	const dowSpec = specs.find(
		(s) => s.weekdays !== null && s.days.length === ALL_DAYS_COUNT,
	);
	const pair =
		specs.length === 2 &&
		daySpec !== undefined &&
		dowSpec !== undefined &&
		daySpec.timeZone === dowSpec.timeZone &&
		daySpec.year === dowSpec.year &&
		sameValues(daySpec.seconds, dowSpec.seconds) &&
		sameValues(daySpec.minutes, dowSpec.minutes) &&
		sameValues(daySpec.hours, dowSpec.hours) &&
		sameValues(daySpec.months, dowSpec.months)
			? { daySpec, dowSpec }
			: null;

	let spec: SystemdSpec;
	if (pair) {
		spec = pair.daySpec;
		sourceExpr = specToCron(spec, pair.dowSpec.weekdays as number[]);
		notes.push(
			'日を指定した行と曜日を指定した行の2行を、cronの日と曜日の両指定（どちらかに一致すれば実行するOR条件）の1行にまとめました。',
		);
	} else {
		spec = specs[0];
		if (specs.length > 1) {
			notes.push(
				`OnCalendar= が${specs.length}件あるため、最初の1件（${values[0]}）を読み込みました（systemdはいずれかに一致すれば実行します）。`,
			);
		}
		if (isAnd(spec)) {
			return fail(
				'systemdは1行に曜日と日を両方指定すると、両方に一致する日（AND条件）だけ実行します。cronは両指定をどちらかに一致すれば実行（OR条件）として扱うため、1行のcron式では表せません。',
			);
		}
		sourceExpr = specToCron(spec);
	}

	if (spec.year !== '*') {
		notes.push(
			`年の指定（${spec.year}）は標準のcron式に含められないため、反映していません。次回実行日時は年を問わずに表示します。`,
		);
	}

	try {
		parseCronExpression(sourceExpr);
	} catch (e) {
		return fail(
			e instanceof CronParseError ? e.message : 'cron式を解釈できませんでした',
		);
	}

	const tz = spec.timeZone;
	let sourceTimeZone: string;
	let sourceTimeZoneLabel: string | undefined;
	let jstExpr: string | null;
	if (tz === null) {
		sourceTimeZone = 'Asia/Tokyo';
		sourceTimeZoneLabel = '指定なし（サーバーのタイムゾーン）';
		jstExpr = sourceExpr;
		notes.unshift(
			'タイムゾーンの指定がないため、サーバーのタイムゾーンをJSTとみなして読み込みました。サーバーがUTCの場合は、末尾に「UTC」を付けて貼り付け直すとJSTへ換算します。',
		);
	} else if (tz === 'Asia/Tokyo' || tz === 'Japan') {
		sourceTimeZone = 'Asia/Tokyo';
		if (tz === 'Japan') sourceTimeZoneLabel = 'Japan（Asia/Tokyoと同じ）';
		jstExpr = sourceExpr;
		notes.unshift(`タイムゾーンの指定（${tz}）どおりJSTとして読み込みました。`);
	} else if (tz === 'UTC' || tz === 'Etc/UTC') {
		sourceTimeZone = 'UTC';
		notes.unshift(`タイムゾーンの指定（${tz}）どおりUTCとして読み込みました。`);
		// 秒は換算に影響しないため、分以降を換算して秒を付け直す
		const fields = sourceExpr.split(' ');
		const secondField = fields.length === 6 ? fields.shift() : undefined;
		const shifted = shiftUtcCronToJst(fields.join(' '));
		jstExpr =
			shifted.expr === null
				? null
				: secondField === undefined
					? shifted.expr
					: `${secondField} ${shifted.expr}`;
		if (shifted.note) notes.push(shifted.note);
	} else {
		sourceTimeZone = tz;
		jstExpr = null;
		notes.unshift(
			`タイムゾーン（${tz}）はUTC・Asia/Tokyo以外のため、JSTへの換算はしていません。`,
		);
	}

	return {
		success: true,
		format: 'systemd',
		formatLabel: 'systemd timer（OnCalendar=）',
		sourceExpr,
		sourceTimeZone,
		...(sourceTimeZoneLabel ? { sourceTimeZoneLabel } : {}),
		jstExpr,
		notes,
	};
}

// --- 入口 -------------------------------------------------------------------

/**
 * AWS EventBridge の cron()/rate()、GitHub Actions の schedule（cron: の行）、
 * systemd timer の OnCalendar= を判定して読み込む。
 * 解釈できない入力は success: false と日本語のエラーを返す（例外は投げない）。
 */
export function importScheduleExpression(text: string): ScheduleImportResult {
	const trimmed = text.trim();
	if (trimmed === '') return fail('読み込む式を入力してください。');

	// 行末のコメント（「# ...」）は無視する
	const call = trimmed.match(/^(cron|rate)\s*\(([^)]*)\)\s*(?:#.*)?$/i);
	if (call) {
		try {
			return call[1].toLowerCase() === 'cron'
				? importAwsCron(call[2])
				: importAwsRate(call[2]);
		} catch (e) {
			return fail(
				e instanceof CronParseError ? e.message : '式を解釈できませんでした',
			);
		}
	}
	if (/^(cron|rate)\s*\([^)]*$/i.test(trimmed)) {
		return fail('「)」で閉じてください（例: cron(0 9 ? * MON-FRI *)）。');
	}
	if (/^(cron|rate)\s*\(/i.test(trimmed)) {
		return fail(
			'「)」の後ろに余分な文字があります。式は「cron(...)」「rate(...)」だけを貼り付けてください（行末の「# コメント」は可）。',
		);
	}
	if (/(^|\n)\s*OnCalendar\s*=/i.test(trimmed)) {
		return importSystemd(trimmed);
	}
	if (/(^|\n)\s*(?:-\s*)?cron\s*:/.test(trimmed)) {
		try {
			// 字下げで項目を判定するため、前後の空白を除く前の文字列を渡す
			return importGithubActions(text);
		} catch (e) {
			return fail(
				e instanceof CronParseError ? e.message : '式を解釈できませんでした',
			);
		}
	}
	return fail(UNSUPPORTED_INPUT_MESSAGE);
}
