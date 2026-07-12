export type CalendarKind = 'gregorian' | 'lunisolar';

export interface CalendarDate {
	year: number;
	month: number;
	day: number;
}

export interface EraDefinition {
	id: string;
	name: string;
	aliases: string[];
	startYear: number;
	endYear: number;
	maxEraYear: number;
	sequence: number;
	calendar: CalendarKind;
	/**
	 * 改元日を含む厳密な開始日・終了日（グレゴリオ暦で確定できる期間のみ設定）。
	 * 月日が両方指定された入力の元号確定にのみ使用し、年単位の候補抽出には使わない。
	 */
	preciseStart?: CalendarDate;
	preciseEnd?: CalendarDate;
}

export interface EraCandidate {
	eraId: string;
	eraName: string;
	eraYear: number;
	label: string;
	isFirstYear: boolean;
	sequence: number;
}

export type AgeResult =
	| { kind: 'exact'; value: number; referenceDate: string }
	| { kind: 'range'; min: number; max: number; referenceDate: string }
	| { kind: 'unavailable'; reason: string };

export interface ConversionResult {
	westernYear: number;
	eraCandidates: EraCandidate[];
	zodiac: string;
	age: AgeResult;
	notices: string[];
	error?: string;
}

export type NormalizeResult =
	| { ok: true; eraId: string; eraYear: number }
	| { ok: false; error: string };

/** 日本がグレゴリオ暦を採用した日（明治5年12月3日→明治6年1月1日）。これより前の月日は厳密な日付換算の対象外。 */
export const GREGORIAN_ADOPTION_DATE: CalendarDate = {
	year: 1873,
	month: 1,
	day: 1,
};

/**
 * 元号マスタ（旧い順）。西暦→和暦は startYear <= year <= endYear を満たす候補を
 * すべて抽出し、sequence 昇順で表示する。1868年以降は既存の明治〜令和データを維持する。
 */
export const ERA_DEFINITIONS: EraDefinition[] = [
	{
		id: 'kouka',
		name: '弘化',
		aliases: ['弘化'],
		startYear: 1844,
		endYear: 1848,
		maxEraYear: 5,
		sequence: 1,
		calendar: 'lunisolar',
	},
	{
		id: 'kaei',
		name: '嘉永',
		aliases: ['嘉永'],
		startYear: 1848,
		endYear: 1854,
		maxEraYear: 7,
		sequence: 2,
		calendar: 'lunisolar',
	},
	{
		id: 'ansei',
		name: '安政',
		aliases: ['安政'],
		startYear: 1854,
		endYear: 1860,
		maxEraYear: 7,
		sequence: 3,
		calendar: 'lunisolar',
	},
	{
		id: 'manen',
		name: '万延',
		aliases: ['万延', '萬延'],
		startYear: 1860,
		endYear: 1861,
		maxEraYear: 2,
		sequence: 4,
		calendar: 'lunisolar',
	},
	{
		id: 'bunkyu',
		name: '文久',
		aliases: ['文久'],
		startYear: 1861,
		endYear: 1864,
		maxEraYear: 4,
		sequence: 5,
		calendar: 'lunisolar',
	},
	{
		id: 'genji',
		name: '元治',
		aliases: ['元治'],
		startYear: 1864,
		endYear: 1865,
		maxEraYear: 2,
		sequence: 6,
		calendar: 'lunisolar',
	},
	{
		id: 'keio',
		name: '慶応',
		aliases: ['慶応', '慶應'],
		startYear: 1865,
		endYear: 1868,
		maxEraYear: 4,
		sequence: 7,
		calendar: 'lunisolar',
	},
	{
		id: 'meiji',
		name: '明治',
		aliases: ['明治', 'M', '明'],
		startYear: 1868,
		endYear: 1912,
		maxEraYear: 45,
		sequence: 8,
		calendar: 'gregorian',
		// 明治5年12月2日までは旧暦。改元日自体は1868年（旧暦）のため、
		// 厳密な日付判定は GREGORIAN_ADOPTION_DATE 以降にのみ適用される。
		preciseStart: { year: 1868, month: 10, day: 23 },
		preciseEnd: { year: 1912, month: 7, day: 29 },
	},
	{
		id: 'taisho',
		name: '大正',
		aliases: ['大正', 'T', '大'],
		startYear: 1912,
		endYear: 1926,
		maxEraYear: 15,
		sequence: 9,
		calendar: 'gregorian',
		preciseStart: { year: 1912, month: 7, day: 30 },
		preciseEnd: { year: 1926, month: 12, day: 24 },
	},
	{
		id: 'showa',
		name: '昭和',
		aliases: ['昭和', 'S', '昭'],
		startYear: 1926,
		endYear: 1989,
		maxEraYear: 64,
		sequence: 10,
		calendar: 'gregorian',
		preciseStart: { year: 1926, month: 12, day: 25 },
		preciseEnd: { year: 1989, month: 1, day: 7 },
	},
	{
		id: 'heisei',
		name: '平成',
		aliases: ['平成', 'H', '平'],
		startYear: 1989,
		endYear: 2019,
		maxEraYear: 31,
		sequence: 11,
		calendar: 'gregorian',
		preciseStart: { year: 1989, month: 1, day: 8 },
		preciseEnd: { year: 2019, month: 4, day: 30 },
	},
	{
		id: 'reiwa',
		name: '令和',
		aliases: ['令和', 'R', '令'],
		startYear: 2019,
		endYear: 9999,
		maxEraYear: 9999,
		sequence: 12,
		calendar: 'gregorian',
		preciseStart: { year: 2019, month: 5, day: 1 },
		preciseEnd: { year: 9999, month: 12, day: 31 },
	},
];

/** 対応する最古の元号年（これより前の西暦年は「対応元号なし」となる） */
export const MIN_SUPPORTED_YEAR = ERA_DEFINITIONS[0].startYear;

const ERA_BY_ID = new Map(ERA_DEFINITIONS.map((era) => [era.id, era]));

const ZODIAC = [
	'申',
	'酉',
	'戌',
	'亥',
	'子',
	'丑',
	'寅',
	'卯',
	'辰',
	'巳',
	'午',
	'未',
];

export function isValidDate(year: number, month: number, day: number): boolean {
	if (month < 1 || month > 12 || day < 1 || day > 31) return false;
	const date = new Date(year, month - 1, day);
	return (
		date.getFullYear() === year &&
		date.getMonth() === month - 1 &&
		date.getDate() === day
	);
}

export function getZodiac(year: number): string {
	if (!Number.isSafeInteger(year) || year < 0) return '';
	return ZODIAC[year % 12];
}

function formatEraLabel(eraName: string, eraYear: number): string {
	return eraYear === 1 ? `${eraName}元年` : `${eraName}${eraYear}年`;
}

function toEraCandidate(era: EraDefinition, westernYear: number): EraCandidate {
	const eraYear = westernYear - era.startYear + 1;
	return {
		eraId: era.id,
		eraName: era.name,
		eraYear,
		label: formatEraLabel(era.name, eraYear),
		isFirstYear: eraYear === 1,
		sequence: era.sequence,
	};
}

/**
 * 西暦年から候補となる元号をすべて抽出し、sequence 昇順で返す。
 * 明治以降も含め、改元年は複数候補を返す（年単位換算のため月日は考慮しない）。
 */
export function getEraCandidates(westernYear: number): EraCandidate[] {
	return ERA_DEFINITIONS.filter(
		(era) => westernYear >= era.startYear && westernYear <= era.endYear,
	)
		.sort((a, b) => a.sequence - b.sequence)
		.map((era) => toEraCandidate(era, westernYear));
}

/** preciseStart/preciseEnd を持つ元号の中から、月日を含む日付に一致するものを1件だけ返す。 */
function findExactEra(date: CalendarDate): EraDefinition | undefined {
	return ERA_DEFINITIONS.find(
		(era) =>
			era.preciseStart !== undefined &&
			era.preciseEnd !== undefined &&
			compareCalendarDates(date, era.preciseStart) >= 0 &&
			compareCalendarDates(date, era.preciseEnd) <= 0,
	);
}

function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
	if (a.year !== b.year) return a.year - b.year;
	if (a.month !== b.month) return a.month - b.month;
	return a.day - b.day;
}

function parseIsoDateString(value: string): CalendarDate | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
	if (!match) return null;
	return {
		year: Number(match[1]),
		month: Number(match[2]),
		day: Number(match[3]),
	};
}

/**
 * Date | 'YYYY-MM-DD' 文字列を暦日（年・月・日）へ変換する。
 * タイムゾーンによる暦日のずれを防ぐため、UTC変換（toISOString等）は行わない。
 * Date は必ずローカルの年月日ゲッターで読み取り、文字列は正規表現で直接パースする。
 */
function toCalendarDate(input: Date | string): CalendarDate {
	if (typeof input === 'string') {
		const parsed = parseIsoDateString(input);
		if (!parsed) {
			throw new Error('referenceDate は YYYY-MM-DD 形式で指定してください');
		}
		return parsed;
	}
	return {
		year: input.getFullYear(),
		month: input.getMonth() + 1,
		day: input.getDate(),
	};
}

function formatCalendarDate(date: CalendarDate): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/**
 * 年齢を算出する。基準日は暦日（タイムゾーンに依存しない年月日）として扱う。
 * - 誕生月日が判明している場合は満年齢を確定する（exact）。誕生日が基準日より
 *   後（未来）の場合は unavailable を返し、負の年齢を返すことはない。
 * - 年のみの場合は「基準年-生年-1」〜「基準年-生年」の範囲を返す（range）
 * - 生年が基準年より後（未来）の場合は unavailable を返す
 */
export function calculateAge(
	westernYear: number,
	referenceDate: Date | string,
	birthMonth?: number,
	birthDay?: number,
): AgeResult {
	const refParts = toCalendarDate(referenceDate);
	const referenceIso = formatCalendarDate(refParts);

	if (birthMonth !== undefined && birthDay !== undefined) {
		if (!isValidDate(westernYear, birthMonth, birthDay)) {
			return { kind: 'unavailable', reason: '存在しない日付です' };
		}
		const birthParts: CalendarDate = {
			year: westernYear,
			month: birthMonth,
			day: birthDay,
		};
		if (compareCalendarDates(birthParts, refParts) > 0) {
			return {
				kind: 'unavailable',
				reason: '未来の日付は年齢を計算できません',
			};
		}
		let value = refParts.year - westernYear;
		const hasHadBirthdayThisYear =
			birthMonth < refParts.month ||
			(birthMonth === refParts.month && birthDay <= refParts.day);
		if (!hasHadBirthdayThisYear) {
			value -= 1;
		}
		return { kind: 'exact', value, referenceDate: referenceIso };
	}

	if (westernYear > refParts.year) {
		return { kind: 'unavailable', reason: '未来の日付は年齢を計算できません' };
	}

	return {
		kind: 'range',
		min: refParts.year - westernYear - 1,
		max: refParts.year - westernYear,
		referenceDate: referenceIso,
	};
}

function buildNotices(
	westernYear: number,
	eraCandidates: EraCandidate[],
	age: AgeResult,
): string[] {
	const notices: string[] = [];

	const isLunisolarYear = westernYear < GREGORIAN_ADOPTION_DATE.year;

	if (isLunisolarYear && eraCandidates.length > 0) {
		notices.push(
			'年単位の対応候補です。旧暦月日を新暦月日に変換した結果ではありません。',
		);
	}

	if (westernYear === MIN_SUPPORTED_YEAR) {
		notices.push('これより前の元号（天保）が併存する可能性があります。');
	}

	// 旧暦期間はそもそも年単位換算である旨を既に案内済みのため、
	// 「誕生日前後で年齢が変わる」注記は近代以降（年のみ入力）の場合にのみ表示する。
	if (age.kind === 'range' && !isLunisolarYear) {
		notices.push('誕生日前後で年齢が変わるため、範囲で表示しています。');
	}

	return notices;
}

function emptyErrorResult(message: string): ConversionResult {
	return {
		westernYear: 0,
		eraCandidates: [],
		zodiac: '',
		age: { kind: 'unavailable', reason: message },
		notices: [],
		error: message,
	};
}

/**
 * 西暦年（および任意の月日）から一覧表示用の変換結果を生成する。
 * - 月日を指定しない場合は年単位の複数候補（改元年は複数元号）を返す
 * - 月日を両方指定した場合は、実際の改元日に基づき元号を1件へ確定する
 * - 1872年以前の月日付き入力は、旧暦のため厳密な日付換算の対象外として専用エラーを返す
 */
export function convertWesternYearToResult(
	westernYear: number,
	referenceDate: Date | string,
	birthMonth?: number,
	birthDay?: number,
): ConversionResult {
	if (!Number.isSafeInteger(westernYear) || westernYear < 1) {
		return emptyErrorResult('西暦年は1以上の整数で入力してください。');
	}

	const hasMonth = birthMonth !== undefined;
	const hasDay = birthDay !== undefined;
	if (hasMonth !== hasDay) {
		return emptyErrorResult('月と日は両方指定してください。');
	}

	if (hasMonth && hasDay) {
		const month = birthMonth as number;
		const day = birthDay as number;
		if (!isValidDate(westernYear, month, day)) {
			return emptyErrorResult(
				'存在しない日付です。月・日の入力内容を確認してください。',
			);
		}

		const dateParts: CalendarDate = { year: westernYear, month, day };
		if (compareCalendarDates(dateParts, GREGORIAN_ADOPTION_DATE) < 0) {
			return emptyErrorResult(
				'1872年以前の月日は旧暦のため、厳密な日付換算には対応していません。年のみで入力してください。',
			);
		}

		const exactEra = findExactEra(dateParts);
		const eraCandidates = exactEra
			? [toEraCandidate(exactEra, westernYear)]
			: [];
		const age = calculateAge(westernYear, referenceDate, month, day);
		return {
			westernYear,
			eraCandidates,
			zodiac: getZodiac(westernYear),
			age,
			notices: buildNotices(westernYear, eraCandidates, age),
		};
	}

	const eraCandidates = getEraCandidates(westernYear);
	const age = calculateAge(westernYear, referenceDate);
	return {
		westernYear,
		eraCandidates,
		zodiac: getZodiac(westernYear),
		age,
		notices: buildNotices(westernYear, eraCandidates, age),
	};
}

/**
 * 元号名・略記・全角数字・漢数字・元年表記を含む文字列を正規化し、
 * eraId と元号年（整数）に解決する。解釈不能・未対応形式はエラーを返す。
 */
export function normalizeWarekiInput(raw: string): NormalizeResult {
	const trimmed = raw.trim();
	if (trimmed === '') {
		return { ok: false, error: '和暦を入力してください' };
	}

	const halfWidth = zenkakuToHankaku(trimmed);

	// 元号エイリアスは長い文字列から優先的にマッチさせる（例: "昭和" を "昭" より先に判定）
	const sortedAliases = ERA_DEFINITIONS.flatMap((era) =>
		era.aliases.map((alias) => ({ era, alias })),
	).sort((a, b) => b.alias.length - a.alias.length);

	const matched = sortedAliases.find(({ alias }) =>
		startsWithAlias(halfWidth, alias),
	);

	if (!matched) {
		return {
			ok: false,
			error: '元号を認識できませんでした（例: 昭和45年 / S45 / 令和元年）',
		};
	}

	let rest = halfWidth.slice(matched.alias.length).trim();
	rest = rest.replace(/年$/, '');

	if (rest === '') {
		return { ok: false, error: '元号の年を入力してください' };
	}

	if (rest === '元') {
		return { ok: true, eraId: matched.era.id, eraYear: 1 };
	}

	const unsupportedNumeral = /[壱弐参拾廿]/;
	if (unsupportedNumeral.test(rest)) {
		return {
			ok: false,
			error: '未対応の数字表記です（大字・「廿」等は非対応）',
		};
	}

	const yearValue = parseYearToken(rest);
	if (yearValue === null || yearValue < 1 || yearValue > 99) {
		return { ok: false, error: '年の値を認識できませんでした' };
	}

	return { ok: true, eraId: matched.era.id, eraYear: yearValue };
}

function startsWithAlias(value: string, alias: string): boolean {
	if (/^[A-Za-z]+$/.test(alias)) {
		return value.slice(0, alias.length).toUpperCase() === alias.toUpperCase();
	}
	return value.startsWith(alias);
}

function zenkakuToHankaku(value: string): string {
	return value.replace(/[０-９]/g, (char) =>
		String.fromCharCode(char.charCodeAt(0) - 0xfee0),
	);
}

const KANJI_DIGITS: Record<string, number> = {
	〇: 0,
	零: 0,
	一: 1,
	二: 2,
	三: 3,
	四: 4,
	五: 5,
	六: 6,
	七: 7,
	八: 8,
	九: 9,
};

/**
 * 元号年トークンを整数へ変換する。半角数字はそのまま、漢数字は
 * 「十」を含む合成表記（四十五=45）と、桁読み表記（四五=45）の両方に対応する。
 */
function parseYearToken(token: string): number | null {
	if (/^\d+$/.test(token)) {
		return Number.parseInt(token, 10);
	}

	if (![...token].every((ch) => ch === '十' || ch in KANJI_DIGITS)) {
		return null;
	}

	if (token.includes('十')) {
		const [tensPartRaw, onesPartRaw] = token.split('十');
		if (onesPartRaw?.includes('十')) return null;
		const tens = tensPartRaw === '' ? 1 : KANJI_DIGITS[tensPartRaw];
		const ones =
			onesPartRaw === undefined || onesPartRaw === ''
				? 0
				: KANJI_DIGITS[onesPartRaw];
		if (tens === undefined || ones === undefined) return null;
		return tens * 10 + ones;
	}

	if (token.length === 1) {
		return KANJI_DIGITS[token];
	}
	if (token.length === 2) {
		const [a, b] = [...token];
		if (KANJI_DIGITS[a] === undefined || KANJI_DIGITS[b] === undefined) {
			return null;
		}
		return KANJI_DIGITS[a] * 10 + KANJI_DIGITS[b];
	}

	return null;
}

/**
 * 元号IDと元号年（および任意の月日）から一覧表示用の変換結果を生成する。
 * maxEraYear を超える入力は範囲外エラーとして返す。月日を指定した場合、その
 * 元号の実際の在位期間外であれば「元号と月日の組み合わせが一致しない」エラーを返す。
 */
export function convertWarekiToResult(
	eraId: string,
	eraYear: number,
	referenceDate: Date | string,
	birthMonth?: number,
	birthDay?: number,
): ConversionResult {
	const era = ERA_BY_ID.get(eraId);
	if (!era) {
		return emptyErrorResult('不正な元号です');
	}

	if (
		!Number.isSafeInteger(eraYear) ||
		eraYear < 1 ||
		eraYear > era.maxEraYear
	) {
		return emptyErrorResult(
			`${era.name}は1〜${era.maxEraYear}年の範囲で入力してください`,
		);
	}

	const westernYear = era.startYear + eraYear - 1;

	const hasMonth = birthMonth !== undefined;
	const hasDay = birthDay !== undefined;
	if (hasMonth !== hasDay) {
		return emptyErrorResult('月と日は両方指定してください。');
	}

	if (hasMonth && hasDay) {
		const month = birthMonth as number;
		const day = birthDay as number;
		if (!isValidDate(westernYear, month, day)) {
			return emptyErrorResult(
				'存在しない日付です。月・日の入力内容を確認してください。',
			);
		}

		const dateParts: CalendarDate = { year: westernYear, month, day };
		if (compareCalendarDates(dateParts, GREGORIAN_ADOPTION_DATE) < 0) {
			return emptyErrorResult(
				'1872年以前の月日は旧暦のため、厳密な日付換算には対応していません。年のみで入力してください。',
			);
		}

		const exactEra = findExactEra(dateParts);
		if (!exactEra || exactEra.id !== era.id) {
			const actualLabel = exactEra
				? formatEraLabel(exactEra.name, dateParts.year - exactEra.startYear + 1)
				: '対応元号なし';
			return emptyErrorResult(
				`指定した和暦と月日の組み合わせが一致しません（該当日は${actualLabel}です）。`,
			);
		}
	}

	return convertWesternYearToResult(
		westernYear,
		referenceDate,
		birthMonth,
		birthDay,
	);
}

/** 和暦欄の表示文字列。対応元号が無い場合は「対応元号なし」を返す。 */
export function formatEraColumnText(result: ConversionResult): string {
	if (result.eraCandidates.length === 0) return '対応元号なし';
	return result.eraCandidates.map((c) => c.label).join(' / ');
}

/** 年齢欄の表示文字列。 */
export function formatAgeColumnText(result: ConversionResult): string {
	const { age } = result;
	if (age.kind === 'exact') return `${age.value}歳`;
	if (age.kind === 'range') return `${age.min}〜${age.max}歳`;
	return age.reason;
}

/**
 * 一覧表示と同一の結果モデルから、コピー用テキストを生成する（設計書 8.）。
 * 表示・コピーの不一致を防ぐため、必ずこの関数経由で文字列化する。
 */
export function formatResultForCopy(result: ConversionResult): string {
	const lines = [
		`和暦: ${formatEraColumnText(result)}`,
		`西暦: ${result.westernYear}年`,
		`干支: ${result.zodiac}年`,
		`年齢: ${formatAgeColumnText(result)}`,
	];
	for (const notice of result.notices) {
		lines.push(`注意: ${notice}`);
	}
	return lines.join('\n');
}
