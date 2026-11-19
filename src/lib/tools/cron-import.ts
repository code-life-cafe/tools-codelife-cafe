// 他サービスのスケジュール式（AWS EventBridge の cron()/rate()、GitHub Actions の schedule）を
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

export type ScheduleImportFormat = 'aws-cron' | 'aws-rate' | 'github-actions';

export interface ScheduleImportSuccess {
	success: true;
	format: ScheduleImportFormat;
	/** 画面に出す形式名 */
	formatLabel: string;
	/** 元のタイムゾーンのままの標準5フィールドcron式。cronで表せない場合はnull */
	sourceExpr: string | null;
	/** 元の式を評価するタイムゾーン（rate式のように時刻に依存しない場合はnull） */
	sourceTimeZone: string | null;
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
	"AWS EventBridgeの cron(...) / rate(...)、またはGitHub Actionsの cron: '...' を貼り付けてください（標準のcron式は上の解析欄に入力してください）。";

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

function importGithubActions(text: string): ScheduleImportResult {
	const crons: string[] = [];
	let timezone: string | undefined;
	for (const line of text.split(/\r?\n/)) {
		const cronMatch = line.match(/^\s*(?:-\s*)?cron\s*:\s*(.*)$/);
		if (cronMatch) {
			crons.push(stripYamlScalar(cronMatch[1]));
			continue;
		}
		const tzMatch = line.match(/^\s*(?:-\s*)?timezone\s*:\s*(.*)$/);
		if (tzMatch && timezone === undefined) {
			timezone = stripYamlScalar(tzMatch[1]);
		}
	}
	if (crons.length === 0 || crons[0] === '') {
		return fail(
			"GitHub Actionsの schedule から cron: '...' の行を見つけられませんでした。",
		);
	}

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

// --- 入口 -------------------------------------------------------------------

/**
 * AWS EventBridge の cron()/rate()、GitHub Actions の schedule（cron: の行）を判定して読み込む。
 * 解釈できない入力は success: false と日本語のエラーを返す（例外は投げない）。
 */
export function importScheduleExpression(text: string): ScheduleImportResult {
	const trimmed = text.trim();
	if (trimmed === '') return fail('読み込む式を入力してください。');

	const call = trimmed.match(/^(cron|rate)\s*\(([\s\S]*)\)\s*$/i);
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
	if (/^(cron|rate)\s*\(/i.test(trimmed)) {
		return fail('「)」で閉じてください（例: cron(0 9 ? * MON-FRI *)）。');
	}
	if (/(^|\n)\s*(?:-\s*)?cron\s*:/.test(trimmed)) {
		try {
			return importGithubActions(trimmed);
		} catch (e) {
			return fail(
				e instanceof CronParseError ? e.message : '式を解釈できませんでした',
			);
		}
	}
	return fail(UNSUPPORTED_INPUT_MESSAGE);
}
