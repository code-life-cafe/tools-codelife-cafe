// cron式チェッカーのロジック（純粋関数のみ、DOM/React非依存）
//
// 標準5フィールド（分 時 日 月 曜日）と秒付き6フィールド（秒 分 時 日 月 曜日）に対応する。
// 日付マッチングは Vixie cron 仕様（日と曜日の両方を指定した場合はOR条件）に従う。

export class CronParseError extends Error {}

interface FieldSpec {
	min: number;
	max: number;
	aliases?: Record<string, number>;
}

/**
 * cron方言固有の挙動を切り出す縫い目。標準5/6フィールドのパース自体は方言に依存しないが、
 * 「日と曜日を両方指定した場合の結合方法」と「曜日フィールドの正規化」は方言ごとに異なりうる
 * （例: Quartzは`?`によるAND/OR切替や`L` `W` `#`を持つ）。将来Quartz等を追加する際は
 * この`CronDialect`を差し替えるだけでパーサー本体に手を入れずに済む設計にしている。
 */
export interface CronDialect {
	name: string;
	/** 日(dom)と曜日(dow)を両方指定した場合の結合ルール */
	combineDayAndWeekday(
		domMatch: boolean,
		dowMatch: boolean,
		domWildcard: boolean,
		dowWildcard: boolean,
	): boolean;
	/** 曜日フィールドの値を0-6（日曜=0）へ正規化する */
	normalizeDow(value: number): number;
}

/** Vixie cron（cron(8)由来の標準的な実装）の方言定義。日・曜日両指定時はOR、7=日曜として扱う。 */
export const VIXIE_DIALECT: CronDialect = {
	name: 'vixie',
	combineDayAndWeekday(domMatch, dowMatch, domWildcard, dowWildcard) {
		if (domWildcard && dowWildcard) return true;
		if (domWildcard) return dowMatch;
		if (dowWildcard) return domMatch;
		return domMatch || dowMatch;
	},
	normalizeDow(value) {
		return value === 7 ? 0 : value;
	},
};

export interface CronField {
	/** マッチ判定に使う昇順・重複なしの値集合 */
	values: number[];
	/** フィールドが `*` のみで指定されていたか */
	isWildcard: boolean;
	/** 「*」に続くステップ指定、または「M/N」（コンマなし単一パーツ）の場合のステップ幅 */
	step?: number;
	/** ステップ指定の開始値（「*」からのステップなら最小値、「M/N」ならM） */
	stepStart?: number;
	/** ステップが全範囲（「*」からのステップ）から始まっているか */
	stepFromWildcard?: boolean;
}

export interface CronSchedule {
	raw: string;
	hasSeconds: boolean;
	seconds: CronField;
	minutes: CronField;
	hours: CronField;
	daysOfMonth: CronField;
	months: CronField;
	daysOfWeek: CronField;
	dialect: CronDialect;
}

const SECOND_SPEC: FieldSpec = { min: 0, max: 59 };
const MINUTE_SPEC: FieldSpec = { min: 0, max: 59 };
const HOUR_SPEC: FieldSpec = { min: 0, max: 23 };
const DOM_SPEC: FieldSpec = { min: 1, max: 31 };
const MONTH_SPEC: FieldSpec = {
	min: 1,
	max: 12,
	aliases: {
		jan: 1,
		feb: 2,
		mar: 3,
		apr: 4,
		may: 5,
		jun: 6,
		jul: 7,
		aug: 8,
		sep: 9,
		oct: 10,
		nov: 11,
		dec: 12,
	},
};
const DOW_SPEC: FieldSpec = {
	min: 0,
	max: 7,
	aliases: {
		sun: 0,
		mon: 1,
		tue: 2,
		wed: 3,
		thu: 4,
		fri: 5,
		sat: 6,
	},
};

const FIELD_NAMES_5 = ['分', '時', '日', '月', '曜日'];
const FIELD_NAMES_6 = ['秒', '分', '時', '日', '月', '曜日'];

function resolveToken(
	token: string,
	spec: FieldSpec,
	fieldLabel: string,
): number {
	const lower = token.trim().toLowerCase();
	if (spec.aliases && lower in spec.aliases) {
		return spec.aliases[lower];
	}
	if (!/^-?\d+$/.test(lower)) {
		throw new CronParseError(
			`${fieldLabel}フィールドの値「${token}」を解釈できません`,
		);
	}
	const n = Number.parseInt(lower, 10);
	if (Number.isNaN(n)) {
		throw new CronParseError(
			`${fieldLabel}フィールドの値「${token}」を解釈できません`,
		);
	}
	return n;
}

function parseField(
	rawField: string,
	spec: FieldSpec,
	fieldLabel: string,
	normalize?: (value: number) => number,
): CronField {
	const trimmed = rawField.trim();
	if (trimmed === '') {
		throw new CronParseError(`${fieldLabel}フィールドが空です`);
	}

	const isWildcard = trimmed === '*';
	const parts = trimmed.split(',');
	const valueSet = new Set<number>();

	let step: number | undefined;
	let stepStart: number | undefined;
	let stepFromWildcard: boolean | undefined;
	const singlePart = parts.length === 1;

	for (const part of parts) {
		const [rangeToken, stepToken] = part.split('/');
		if (part.split('/').length > 2) {
			throw new CronParseError(
				`${fieldLabel}フィールドの指定「${part}」を解釈できません`,
			);
		}

		let rangeStart: number;
		let rangeEnd: number;
		let fromWildcardRange = false;

		if (rangeToken === '*') {
			rangeStart = spec.min;
			rangeEnd = spec.max;
			fromWildcardRange = true;
		} else if (rangeToken.includes('-')) {
			const [startToken, endToken] = rangeToken.split('-');
			if (startToken === undefined || endToken === undefined) {
				throw new CronParseError(
					`${fieldLabel}フィールドの範囲指定「${rangeToken}」を解釈できません`,
				);
			}
			rangeStart = resolveToken(startToken, spec, fieldLabel);
			rangeEnd = resolveToken(endToken, spec, fieldLabel);
		} else {
			rangeStart = resolveToken(rangeToken, spec, fieldLabel);
			rangeEnd = stepToken !== undefined ? spec.max : rangeStart;
		}

		if (
			rangeStart < spec.min ||
			rangeStart > spec.max ||
			rangeEnd < spec.min ||
			rangeEnd > spec.max
		) {
			throw new CronParseError(
				`${fieldLabel}フィールドの値は${spec.min}〜${spec.max}の範囲で指定してください（指定値: ${part}）`,
			);
		}
		if (rangeEnd < rangeStart) {
			throw new CronParseError(
				`${fieldLabel}フィールドの範囲指定「${rangeToken}」は開始値が終了値より大きくなっています`,
			);
		}

		let stepValue = 1;
		if (stepToken !== undefined) {
			if (!/^\d+$/.test(stepToken)) {
				throw new CronParseError(
					`${fieldLabel}フィールドのステップ指定「${stepToken}」を解釈できません`,
				);
			}
			stepValue = Number.parseInt(stepToken, 10);
			if (stepValue <= 0) {
				throw new CronParseError(
					`${fieldLabel}フィールドのステップ指定は1以上にしてください（指定値: ${stepToken}）`,
				);
			}
		}

		for (let v = rangeStart; v <= rangeEnd; v += stepValue) {
			valueSet.add(normalize ? normalize(v) : v);
		}

		if (singlePart && stepToken !== undefined) {
			step = stepValue;
			stepStart = rangeStart;
			stepFromWildcard = fromWildcardRange;
		}
	}

	return {
		values: [...valueSet].sort((a, b) => a - b),
		isWildcard,
		step,
		stepStart,
		stepFromWildcard,
	};
}

/**
 * cron式（標準5フィールドまたは秒付き6フィールド）をパースする。
 * 不正な入力は CronParseError を投げる。dialect省略時はVixie cron仕様を用いる。
 */
export function parseCronExpression(
	expression: string,
	dialect: CronDialect = VIXIE_DIALECT,
): CronSchedule {
	const raw = expression.trim();
	if (raw === '') {
		throw new CronParseError('cron式を入力してください');
	}

	const fields = raw.split(/\s+/);
	const hasSeconds = fields.length === 6;

	if (fields.length !== 5 && fields.length !== 6) {
		throw new CronParseError(
			`フィールド数が不正です（5または6フィールドが必要ですが、${fields.length}個検出されました）`,
		);
	}

	const names = hasSeconds ? FIELD_NAMES_6 : FIELD_NAMES_5;
	const [secondsRaw, minutesRaw, hoursRaw, domRaw, monthRaw, dowRaw] =
		hasSeconds ? fields : ['0', ...fields];

	const seconds = hasSeconds
		? parseField(secondsRaw, SECOND_SPEC, names[0])
		: parseField('0', SECOND_SPEC, '秒');
	const minutes = parseField(
		minutesRaw,
		MINUTE_SPEC,
		hasSeconds ? names[1] : names[0],
	);
	const hours = parseField(
		hoursRaw,
		HOUR_SPEC,
		hasSeconds ? names[2] : names[1],
	);
	const daysOfMonth = parseField(
		domRaw,
		DOM_SPEC,
		hasSeconds ? names[3] : names[2],
	);
	const months = parseField(
		monthRaw,
		MONTH_SPEC,
		hasSeconds ? names[4] : names[3],
	);
	const daysOfWeek = parseField(
		dowRaw,
		DOW_SPEC,
		hasSeconds ? names[5] : names[4],
		dialect.normalizeDow,
	);

	return {
		raw,
		hasSeconds,
		seconds,
		minutes,
		hours,
		daysOfMonth,
		months,
		daysOfWeek,
		dialect,
	};
}

// --- 次回実行日時計算 -------------------------------------------------

interface CivilTime {
	year: number;
	month: number; // 1-12
	day: number; // 1-31
	hour: number;
	minute: number;
	second: number;
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(year: number, month: number, day: number): number {
	// 0=日曜〜6=土曜（UTC基準の曜日計算。civil時刻はタイムゾーンのwall clockそのものなので問題ない）
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function matchesDayField(schedule: CronSchedule, c: CivilTime): boolean {
	const domMatch = schedule.daysOfMonth.values.includes(c.day);
	const dowMatch = schedule.daysOfWeek.values.includes(
		weekdayOf(c.year, c.month, c.day),
	);

	return schedule.dialect.combineDayAndWeekday(
		domMatch,
		dowMatch,
		schedule.daysOfMonth.isWildcard,
		schedule.daysOfWeek.isWildcard,
	);
}

function addMinutes(c: CivilTime, delta: number): CivilTime {
	const d = new Date(
		Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute + delta, c.second),
	);
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
		hour: d.getUTCHours(),
		minute: d.getUTCMinutes(),
		second: d.getUTCSeconds(),
	};
}

function addDays(c: CivilTime, delta: number): CivilTime {
	const d = new Date(Date.UTC(c.year, c.month - 1, c.day + delta, 0, 0, 0));
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
		hour: 0,
		minute: 0,
		second: 0,
	};
}

function firstOfNextMonth(c: CivilTime): CivilTime {
	const d = new Date(Date.UTC(c.year, c.month, 1, 0, 0, 0));
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: 1,
		hour: 0,
		minute: 0,
		second: 0,
	};
}

const MAX_ITERATIONS = 200_000;
const MAX_YEARS_AHEAD = 8;

/**
 * 指定した civil time（timeZone上の壁時計時刻）以降で、次にcron式にマッチする分を
 * 1件計算する（秒は0固定で返す。実際の該当秒はschedule.seconds.valuesを呼び出し側で展開する）。
 */
function findNextCivilMatch(
	schedule: CronSchedule,
	from: CivilTime,
): CivilTime {
	let c = addMinutes(from, 1);
	c = { ...c, second: 0 };
	const yearLimit = from.year + MAX_YEARS_AHEAD;

	for (let i = 0; i < MAX_ITERATIONS; i++) {
		if (c.year > yearLimit) {
			throw new CronParseError(
				`次回実行日時が見つかりませんでした（${MAX_YEARS_AHEAD}年以内に該当する日時がありません）`,
			);
		}
		if (!schedule.months.values.includes(c.month)) {
			c = firstOfNextMonth(c);
			continue;
		}
		if (c.day > daysInMonth(c.year, c.month)) {
			c = firstOfNextMonth(c);
			continue;
		}
		if (!matchesDayField(schedule, c)) {
			c = addDays(c, 1);
			continue;
		}
		if (!schedule.hours.values.includes(c.hour)) {
			c = addMinutes(c, 60 - c.minute);
			c = { ...c, second: 0 };
			continue;
		}
		if (!schedule.minutes.values.includes(c.minute)) {
			c = addMinutes(c, 1);
			continue;
		}
		return c;
	}
	throw new CronParseError('次回実行日時の計算が上限回数に達しました');
}

/**
 * IANAタイムゾーン上の壁時計時刻（civil time）を、対応するUTCのDateに変換する。
 * DSTのあるタイムゾーンでも収束するよう2回のオフセット補正を行う。
 */
function civilToUtc(c: CivilTime, timeZone: string): Date {
	let guess = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
	for (let i = 0; i < 2; i++) {
		const parts = getZonedParts(new Date(guess), timeZone);
		const diffMs =
			Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) -
			Date.UTC(
				parts.year,
				parts.month - 1,
				parts.day,
				parts.hour,
				parts.minute,
				parts.second,
			);
		guess += diffMs;
	}
	return new Date(guess);
}

function getZonedParts(date: Date, timeZone: string): CivilTime {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
	});
	const parts = formatter.formatToParts(date);
	const get = (type: string) =>
		Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
	return {
		year: get('year'),
		month: get('month'),
		day: get('day'),
		hour: get('hour'),
		minute: get('minute'),
		second: get('second'),
	};
}

export interface NextRunOptions {
	count?: number;
	from?: Date;
	timeZone: string;
}

/**
 * 指定タイムゾーン上でcron式が次にマッチする日時をN件返す（UTCのDate配列）。
 * 秒付き6フィールドの場合、1分内に複数の該当秒があれば1分につき複数件を返す
 * （例: 「5秒おき」の6フィールド指定は5秒間隔で結果を返す）。
 */
export function getNextRunTimes(
	schedule: CronSchedule,
	options: NextRunOptions,
): Date[] {
	const count = options.count ?? 10;
	const from = options.from ?? new Date();
	const timeZone = options.timeZone;

	const results: Date[] = [];
	let cursorCivil = getZonedParts(from, timeZone);
	let currentMinuteCivil: CivilTime | null = null;
	let pendingSeconds: number[] = [];

	while (results.length < count) {
		if (pendingSeconds.length === 0) {
			currentMinuteCivil = findNextCivilMatch(schedule, cursorCivil);
			pendingSeconds = [...schedule.seconds.values];
		}
		const second = pendingSeconds.shift();
		if (second === undefined || !currentMinuteCivil) break;

		const resultCivil: CivilTime = { ...currentMinuteCivil, second };
		results.push(civilToUtc(resultCivil, timeZone));
		cursorCivil = resultCivil;
	}
	return results;
}

// --- 日本語解説 ---------------------------------------------------------

const DOW_NAMES_JA = ['日', '月', '火', '水', '木', '金', '土'];
const MONTH_UNIT = '月';

function joinJa(items: string[]): string {
	return items.join('・');
}

function describeStepIfAny(field: CronField, unit: string): string | null {
	if (field.step !== undefined && field.stepFromWildcard) {
		return `${field.step}${unit}おき`;
	}
	return null;
}

function describeDayPart(schedule: CronSchedule): string {
	const monthWildcard = schedule.months.isWildcard;
	const domWildcard = schedule.daysOfMonth.isWildcard;
	const dowWildcard = schedule.daysOfWeek.isWildcard;

	const monthText = monthWildcard
		? ''
		: joinJa(schedule.months.values.map((m) => `${m}${MONTH_UNIT}`));
	const domText = domWildcard
		? ''
		: joinJa(schedule.daysOfMonth.values.map((d) => `${d}日`));
	const dowText = dowWildcard
		? ''
		: joinJa(schedule.daysOfWeek.values.map((d) => `${DOW_NAMES_JA[d]}曜`));

	// 月を指定している場合は「毎年○月」、していなければ「毎月」を日・曜日の前に付与する
	const monthPrefix = monthWildcard ? '毎月' : `毎年${monthText}`;

	if (!domWildcard && !dowWildcard) {
		// Vixie cron仕様: 日・曜日を両方指定した場合はOR
		return `${monthPrefix}${domText}または${dowText}`;
	}
	if (!domWildcard) {
		return `${monthPrefix}${domText}`;
	}
	if (!dowWildcard) {
		if (monthWildcard) return `毎週${dowText}`;
		return `毎年${monthText}の毎週${dowText}`;
	}
	if (!monthWildcard) {
		return `毎年${monthText}の毎日`;
	}
	return '毎日';
}

function pad2(n: number): string {
	return n.toString().padStart(2, '0');
}

function describeTimePart(schedule: CronSchedule): string {
	const secStep = schedule.hasSeconds
		? describeStepIfAny(schedule.seconds, '秒')
		: null;
	if (secStep) return secStep;

	const minStep = describeStepIfAny(schedule.minutes, '分');
	if (minStep && schedule.hours.isWildcard) return minStep;

	const hourStep = describeStepIfAny(schedule.hours, '時間');
	if (hourStep && schedule.minutes.values.length === 1) {
		const minute = schedule.minutes.values[0];
		return minute === 0 ? hourStep : `${minute}分 ${hourStep}`;
	}

	if (schedule.hours.isWildcard && schedule.minutes.isWildcard) {
		return '毎分実行';
	}

	if (schedule.hours.isWildcard) {
		return joinJa(schedule.minutes.values.map((m) => `毎時${m}分`));
	}

	const secSuffix =
		schedule.hasSeconds &&
		!schedule.seconds.isWildcard &&
		schedule.seconds.values.length === 1
			? `:${pad2(schedule.seconds.values[0])}`
			: '';

	const times: string[] = [];
	for (const h of schedule.hours.values) {
		for (const m of schedule.minutes.values) {
			times.push(`${h}:${pad2(m)}${secSuffix}`);
		}
	}
	return joinJa(times);
}

/**
 * cron式の日本語解説文を生成する（例: 「毎週月曜 9:00」）。
 */
export function describeCronJapanese(schedule: CronSchedule): string {
	const dayPart = describeDayPart(schedule);
	const timePart = describeTimePart(schedule);
	return `${dayPart} ${timePart}`.trim();
}

// --- cronリンター ---------------------------------------------------------

export type CronLintSeverity = 'error' | 'warn' | 'info';

export interface CronLintIssue {
	severity: CronLintSeverity;
	message: string;
}

export function lintCronSchedule(schedule: CronSchedule): CronLintIssue[] {
	const issues: CronLintIssue[] = [];

	if (schedule.hasSeconds && schedule.seconds.isWildcard) {
		issues.push({
			severity: 'warn',
			message:
				'毎秒実行される設定です。サーバーやジョブへの負荷に注意してください。',
		});
	} else if (
		!schedule.hasSeconds &&
		schedule.minutes.isWildcard &&
		schedule.hours.isWildcard
	) {
		issues.push({
			severity: 'warn',
			message:
				'毎分実行される設定です。サーバーやジョブへの負荷に注意してください。',
		});
	} else if (
		schedule.hasSeconds &&
		!schedule.seconds.isWildcard &&
		schedule.seconds.stepFromWildcard &&
		schedule.seconds.step !== undefined
	) {
		issues.push({
			severity: 'warn',
			message: `${schedule.seconds.step}秒おきに実行される高頻度な設定です（1分あたり約${Math.ceil(60 / schedule.seconds.step)}回）。サーバーやジョブへの負荷に注意してください。`,
		});
	}

	const highDays = schedule.daysOfMonth.isWildcard
		? []
		: schedule.daysOfMonth.values.filter((d) => d >= 29);
	if (highDays.length > 0) {
		const monthsToCheck = schedule.months.isWildcard
			? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
			: schedule.months.values;
		// 2月は29日まで(うるう年)、4/6/9/11月は30日までしかないため、29〜31日指定は
		// 一部の月で実行されない可能性がある
		const hasSkippedMonth = monthsToCheck.some((m) => {
			const maxDay = m === 2 ? 29 : [4, 6, 9, 11].includes(m) ? 30 : 31;
			return highDays.some((d) => d > maxDay);
		});
		if (hasSkippedMonth) {
			issues.push({
				severity: 'warn',
				message: `${highDays.join('・')}日を指定していますが、該当日が存在しない月ではその月は実行されません（2月・4月・6月・9月・11月は要注意）。`,
			});
		}
	}

	if (!schedule.daysOfMonth.isWildcard && !schedule.daysOfWeek.isWildcard) {
		issues.push({
			severity: 'info',
			message:
				'日と曜日の両方を指定しているため、Vixie cron仕様により「日または曜日のいずれかに一致」した場合に実行されます（AND条件ではありません）。',
		});
	}

	return issues;
}

// --- 逆引き生成（日本語→cron式） -------------------------------------------

const DOW_JA_TO_NUM: Record<string, number> = {
	日: 0,
	月: 1,
	火: 2,
	水: 3,
	木: 4,
	金: 5,
	土: 6,
};

export interface ReverseGenerateSuccess {
	success: true;
	expr: string;
}

export interface ReverseGenerateFailure {
	success: false;
	suggestions: string[];
}

export type ReverseGenerateResult =
	| ReverseGenerateSuccess
	| ReverseGenerateFailure;

const FALLBACK_SUGGESTIONS = [
	'毎日9時',
	'平日の9時と18時',
	'15分おき',
	'毎週月曜9時',
	'毎月1日0時',
];

function normalizeJaInput(text: string): string {
	return text
		.trim()
		.replace(/\s+/g, '')
		.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 日本語の自然文からcron式を生成する（ルールベース、決定的処理。AI/LLMは使用しない）。
 */
export function generateCronFromJapanese(text: string): ReverseGenerateResult {
	const input = normalizeJaInput(text);

	if (input === '毎分') return { success: true, expr: '* * * * *' };
	if (input === '毎時') return { success: true, expr: '0 * * * *' };

	let m = input.match(/^毎日(\d{1,2})時(?:(\d{1,2})分)?$/);
	if (m) {
		const hour = Number.parseInt(m[1], 10);
		const minute = m[2] ? Number.parseInt(m[2], 10) : 0;
		if (hour <= 23 && minute <= 59) {
			return { success: true, expr: `${minute} ${hour} * * *` };
		}
	}

	m = input.match(/^平日の?(\d{1,2}時(?:と\d{1,2}時)*)$/);
	if (m) {
		const hours = [...m[1].matchAll(/(\d{1,2})時/g)].map((mm) =>
			Number.parseInt(mm[1], 10),
		);
		if (hours.every((h) => h <= 23)) {
			return { success: true, expr: `0 ${hours.join(',')} * * 1-5` };
		}
	}

	m = input.match(/^(\d{1,2})分おき$/);
	if (m) {
		const n = Number.parseInt(m[1], 10);
		if (n >= 1 && n <= 59) {
			return { success: true, expr: `*/${n} * * * *` };
		}
	}

	m = input.match(/^(\d{1,2})秒おき$/);
	if (m) {
		const n = Number.parseInt(m[1], 10);
		if (n >= 1 && n <= 59) {
			return { success: true, expr: `*/${n} * * * * *` };
		}
	}

	m = input.match(/^(\d{1,2})時間おき$/);
	if (m) {
		const n = Number.parseInt(m[1], 10);
		if (n >= 1 && n <= 23) {
			return { success: true, expr: `0 */${n} * * *` };
		}
	}

	m = input.match(/^毎週((?:[日月火水木金土]・?)+)曜(?:の?(\d{1,2})時)?$/);
	if (m) {
		const dowChars = m[1].split('・').filter(Boolean);
		const dows = dowChars
			.map((c) => DOW_JA_TO_NUM[c])
			.filter((v) => v !== undefined);
		const hour = m[2] ? Number.parseInt(m[2], 10) : 0;
		if (dows.length === dowChars.length && hour <= 23) {
			return { success: true, expr: `0 ${hour} * * ${dows.join(',')}` };
		}
	}

	m = input.match(/^毎月(\d{1,2})日(?:の?(\d{1,2})時)?$/);
	if (m) {
		const day = Number.parseInt(m[1], 10);
		const hour = m[2] ? Number.parseInt(m[2], 10) : 0;
		if (day >= 1 && day <= 31 && hour <= 23) {
			return { success: true, expr: `0 ${hour} ${day} * *` };
		}
	}

	return { success: false, suggestions: FALLBACK_SUGGESTIONS };
}

// --- フォーマット別コピー ---------------------------------------------------

const AWS_DOW_MAP: Record<number, number> = {
	0: 1,
	1: 2,
	2: 3,
	3: 4,
	4: 5,
	5: 6,
	6: 7,
};

export interface FormatCopyResult {
	value: string;
	warning?: string;
}

export function toCrontabLine(schedule: CronSchedule): FormatCopyResult {
	return { value: schedule.raw };
}

export function toGithubActionsSchedule(
	schedule: CronSchedule,
): FormatCopyResult {
	if (schedule.hasSeconds) {
		return {
			value: '',
			warning:
				'GitHub Actionsのschedule triggerは秒フィールドに対応していません（分単位まで）。',
		};
	}
	const line = `${schedule.minutes.isWildcard ? '*' : schedule.minutes.values.join(',')} ${
		schedule.hours.isWildcard ? '*' : schedule.hours.values.join(',')
	} ${schedule.daysOfMonth.isWildcard ? '*' : schedule.daysOfMonth.values.join(',')} ${
		schedule.months.isWildcard ? '*' : schedule.months.values.join(',')
	} ${schedule.daysOfWeek.isWildcard ? '*' : schedule.daysOfWeek.values.join(',')}`;
	return { value: `schedule:\n  - cron: '${line}'` };
}

export function toAwsEventBridgeCron(schedule: CronSchedule): FormatCopyResult {
	if (schedule.hasSeconds) {
		return {
			value: '',
			warning:
				'AWS EventBridgeのcron式は秒フィールドに対応していません（分単位まで）。',
		};
	}

	const minute = schedule.minutes.isWildcard
		? '*'
		: schedule.minutes.values.join(',');
	const hour = schedule.hours.isWildcard
		? '*'
		: schedule.hours.values.join(',');
	const domWildcard = schedule.daysOfMonth.isWildcard;
	const dowWildcard = schedule.daysOfWeek.isWildcard;

	let warning: string | undefined;
	let dom: string;
	let dow: string;

	if (domWildcard && dowWildcard) {
		dom = '*';
		dow = '?';
	} else if (!domWildcard && dowWildcard) {
		dom = schedule.daysOfMonth.values.join(',');
		dow = '?';
	} else if (domWildcard && !dowWildcard) {
		dom = '?';
		dow = schedule.daysOfWeek.values.map((d) => AWS_DOW_MAP[d]).join(',');
	} else {
		// AWSは日・曜日のどちらか一方しか指定できないため、日を優先し曜日側を "?" にする
		dom = schedule.daysOfMonth.values.join(',');
		dow = '?';
		warning =
			'AWS EventBridgeは日と曜日を同時指定できないため、日指定を優先し曜日側を「?」に変換しました。';
	}

	const value = `cron(${minute} ${hour} ${dom} ${schedule.months.isWildcard ? '*' : schedule.months.values.join(',')} ${dow} *)`;
	return warning ? { value, warning } : { value };
}
