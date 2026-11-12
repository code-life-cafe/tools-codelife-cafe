// time-zones.ts — タイムゾーン選択肢の取得。

/** Intl.supportedValuesOf が使えない環境で提示する最小限の選択肢 */
export const FALLBACK_TIME_ZONES: readonly string[] = [
	'UTC',
	'Asia/Tokyo',
	'America/New_York',
	'Europe/London',
];

/**
 * 実行環境が対応するIANAタイムゾーン名の一覧を返す。
 * Intl.supportedValuesOf が無い環境では FALLBACK_TIME_ZONES を返す。
 */
export function getSupportedTimeZones(): string[] {
	return typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
		? Intl.supportedValuesOf('timeZone')
		: [...FALLBACK_TIME_ZONES];
}
