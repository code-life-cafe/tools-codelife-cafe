export type Gengo = '明治' | '大正' | '昭和' | '平成' | '令和';

export interface WarekiResult {
	gengo: Gengo | null;
	warekiYear: number | null;
	warekiString: string;
	seirekiYear: number;
	zodiac: string;
	age: number;
	error?: string;
}

const ERAS = [
	{ name: '令和', start: new Date('2019-05-01') },
	{ name: '平成', start: new Date('1989-01-08') },
	{ name: '昭和', start: new Date('1926-12-25') },
	{ name: '大正', start: new Date('1912-07-30') },
	{ name: '明治', start: new Date('1868-10-23') }, // 明治改元の日
] as const;

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
	if (year < 0) return '';
	return ZODIAC[year % 12];
}

export function getAge(year: number): number {
	const currentYear = new Date().getFullYear();
	return Math.max(0, currentYear - year);
}

export function formatWarekiYear(gengo: string, year: number): string {
	if (gengo === '不明') return '変換範囲外';
	return year === 1 ? `${gengo}元年` : `${gengo}${year}年`;
}

export function seirekiToWareki(
	year: number,
	month: number,
	day: number,
): WarekiResult {
	if (!isValidDate(year, month, day)) {
		return {
			gengo: null,
			warekiYear: null,
			warekiString: 'エラー',
			seirekiYear: year,
			zodiac: getZodiac(year),
			age: getAge(year),
			error: '存在しない日付です。月・日の入力内容を確認してください。',
		};
	}

	if (year < 1868) {
		return {
			gengo: null,
			warekiYear: null,
			warekiString: '変換範囲外',
			seirekiYear: year,
			zodiac: getZodiac(year),
			age: getAge(year),
			error: '明治以前は対応していません',
		};
	}

	const date = new Date(year, month - 1, day);

	const gengoObj = ERAS.find((era) => date >= era.start);
	if (!gengoObj) {
		return {
			gengo: null,
			warekiYear: null,
			warekiString: '変換範囲外',
			seirekiYear: year,
			zodiac: getZodiac(year),
			age: getAge(year),
			error: '明治以前の日付です',
		};
	}

	const gengoName = gengoObj.name as Gengo;
	const warekiYear = year - gengoObj.start.getFullYear() + 1;
	const warekiString = formatWarekiYear(gengoName, warekiYear);

	return {
		gengo: gengoName,
		warekiYear,
		warekiString,
		seirekiYear: year,
		zodiac: getZodiac(year),
		age: getAge(year),
	};
}

export function warekiToSeireki(
	gengo: Gengo,
	warekiYear: number,
	month?: number,
	day?: number,
): WarekiResult {
	if (warekiYear < 1) {
		return {
			gengo,
			warekiYear,
			warekiString: formatWarekiYear(gengo, warekiYear),
			seirekiYear: 0,
			zodiac: '',
			age: 0,
			error: '年は1以上を指定してください',
		};
	}

	const eraIndex = ERAS.findIndex((e) => e.name === gengo);
	if (eraIndex === -1) {
		return {
			gengo,
			warekiYear,
			warekiString: formatWarekiYear(gengo, warekiYear),
			seirekiYear: 0,
			zodiac: '',
			age: 0,
			error: '不正な元号です',
		};
	}

	const era = ERAS[eraIndex];
	const startYear = era.start.getFullYear();
	const seirekiYear = startYear + warekiYear - 1;

	if (
		month !== undefined &&
		day !== undefined &&
		!isValidDate(seirekiYear, month, day)
	) {
		return {
			gengo,
			warekiYear,
			warekiString: formatWarekiYear(gengo, warekiYear),
			seirekiYear,
			zodiac: getZodiac(seirekiYear),
			age: getAge(seirekiYear),
			error: '存在しない日付です。月・日の入力内容を確認してください。',
		};
	}

	let error: string | undefined;

	if (month !== undefined && day !== undefined) {
		const targetDate = new Date(seirekiYear, month - 1, day);
		const nextEra = ERAS[eraIndex - 1]; // ERAS is sorted newest to oldest
		const fd = (d: Date) =>
			`${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;

		if (targetDate < era.start) {
			error = `${gengo}は${fd(era.start)}以降です`;
		} else if (nextEra && targetDate >= nextEra.start) {
			error = `${seirekiYear}年${month}月${day}日は${nextEra.name}です (${fd(nextEra.start)}〜)`;
		}
	}

	return {
		gengo,
		warekiYear,
		warekiString: formatWarekiYear(gengo, warekiYear),
		seirekiYear,
		zodiac: getZodiac(seirekiYear),
		age: getAge(seirekiYear),
		error,
	};
}
