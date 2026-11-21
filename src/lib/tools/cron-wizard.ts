/**
 * cron式の生成ウィザード（頻度・時刻・曜日・日の選択 → 標準5フィールドのcron式）。
 * 決定的な純粋関数。入力はJSTの実行時刻として扱う（解析欄と同じ前提）。
 */

export type WizardFrequency =
	| 'minutes'
	| 'hours'
	| 'daily'
	| 'weekly'
	| 'monthly';

/** n分ごとに選べる間隔（60の約数。1時間の中で等間隔になるもの） */
export const WIZARD_MINUTE_INTERVALS = [
	1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30,
] as const;

/** n時間ごとに選べる間隔（24の約数。1日の中で等間隔になるもの） */
export const WIZARD_HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12] as const;

export interface WizardOptions {
	frequency: WizardFrequency;
	/** n分ごと・n時間ごとの間隔 */
	interval?: number;
	/** 時（0〜23）。毎日・毎週・毎月で使う */
	hour?: number;
	/** 分（0〜59）。n時間ごと・毎日・毎週・毎月で使う */
	minute?: number;
	/** 曜日（0=日曜〜6=土曜）。毎週で使う */
	weekdays?: number[];
	/** 日（1〜31）。毎月で使う */
	dayOfMonth?: number;
}

export interface WizardSuccess {
	success: true;
	expr: string;
	notes: string[];
}

export interface WizardFailure {
	success: false;
	error: string;
}

export type WizardResult = WizardSuccess | WizardFailure;

function isIntIn(value: unknown, min: number, max: number): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= min &&
		value <= max
	);
}

/** 曜日の集合を、3日以上の連続は範囲（1-5）、それ以外はカンマ区切りにまとめる */
export function compressWeekdays(weekdays: number[]): string {
	const days = [...new Set(weekdays)].sort((a, b) => a - b);
	if (days.length === 7) return '*';
	const parts: string[] = [];
	let i = 0;
	while (i < days.length) {
		let j = i;
		while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++;
		if (j - i >= 2) {
			parts.push(`${days[i]}-${days[j]}`);
		} else {
			for (let k = i; k <= j; k++) parts.push(String(days[k]));
		}
		i = j + 1;
	}
	return parts.join(',');
}

function fail(error: string): WizardFailure {
	return { success: false, error };
}

function checkTime(
	options: WizardOptions,
	needHour: boolean,
): WizardFailure | null {
	if (needHour && !isIntIn(options.hour, 0, 23)) {
		return fail('時は0〜23の整数で選んでください。');
	}
	if (!isIntIn(options.minute, 0, 59)) {
		return fail('分は0〜59の整数で選んでください。');
	}
	return null;
}

/**
 * ウィザードの選択から標準5フィールドのcron式を作る。
 * 選択が不正な場合は日本語のエラーを返す。
 */
export function buildCronFromWizard(options: WizardOptions): WizardResult {
	switch (options.frequency) {
		case 'minutes': {
			const n = options.interval;
			if (
				typeof n !== 'number' ||
				!(WIZARD_MINUTE_INTERVALS as readonly number[]).includes(n)
			) {
				return fail(
					`分の間隔は ${WIZARD_MINUTE_INTERVALS.join('・')} 分から選んでください。`,
				);
			}
			return {
				success: true,
				expr: n === 1 ? '* * * * *' : `*/${n} * * * *`,
				notes: [],
			};
		}
		case 'hours': {
			const n = options.interval;
			if (
				typeof n !== 'number' ||
				!(WIZARD_HOUR_INTERVALS as readonly number[]).includes(n)
			) {
				return fail(
					`時間の間隔は ${WIZARD_HOUR_INTERVALS.join('・')} 時間から選んでください。`,
				);
			}
			const timeError = checkTime(options, false);
			if (timeError) return timeError;
			return {
				success: true,
				expr: `${options.minute} ${n === 1 ? '*' : `*/${n}`} * * *`,
				notes: [],
			};
		}
		case 'daily': {
			const timeError = checkTime(options, true);
			if (timeError) return timeError;
			return {
				success: true,
				expr: `${options.minute} ${options.hour} * * *`,
				notes: [],
			};
		}
		case 'weekly': {
			const weekdays = options.weekdays ?? [];
			if (weekdays.length === 0) {
				return fail('曜日を1つ以上選んでください。');
			}
			if (!weekdays.every((d) => isIntIn(d, 0, 6))) {
				return fail('曜日は0（日曜）〜6（土曜）で選んでください。');
			}
			const timeError = checkTime(options, true);
			if (timeError) return timeError;
			return {
				success: true,
				expr: `${options.minute} ${options.hour} * * ${compressWeekdays(weekdays)}`,
				notes: [],
			};
		}
		case 'monthly': {
			const day = options.dayOfMonth;
			if (!isIntIn(day, 1, 31)) {
				return fail('日は1〜31の整数で選んでください。');
			}
			const timeError = checkTime(options, true);
			if (timeError) return timeError;
			const notes =
				day >= 29
					? [
							`${day}日がない月（${day === 31 ? '2・4・6・9・11月' : day === 30 ? '2月' : 'うるう年以外の2月'}）は実行されません。`,
						]
					: [];
			return {
				success: true,
				expr: `${options.minute} ${options.hour} ${day} * *`,
				notes,
			};
		}
		default:
			return fail('頻度を選んでください。');
	}
}
