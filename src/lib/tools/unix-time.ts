// UNIXタイムスタンプ⇔日時変換ツールのロジック（純粋関数のみ）
//
// 内部表現として「エポックからのナノ秒（BigInt）」を正準値（Instant）として扱う。
// 秒・ミリ秒・マイクロ秒・ナノ秒・Slack TS のいずれの入力もこの Instant に正規化してから
// 各種出力（ISO 8601 / RFC 3339 / 和暦 / Discordタグ / 相対時刻）を導出する。
// v2 で Snowflake・FILETIME・Cocoa・Excelシリアル値等を追加する際は、
// FORMAT_REGISTRY にエントリを増やすだけで拡張できるようにしている。

export type TimestampFormatId =
	| 'unix-s'
	| 'unix-ms'
	| 'unix-us'
	| 'unix-ns'
	| 'slack-ts';

export type Confidence = 'high' | 'low';

export interface TimestampFormatDefinition {
	id: TimestampFormatId;
	label: string;
	/** 整数部の標準的な桁数（候補の確度順ソートに使用） */
	canonicalDigits: number;
	/** 1単位あたりのナノ秒数 */
	nanosPerUnit: bigint;
}

/** v1 で対応する形式のレジストリ。v2 拡張時はここに追加する。 */
export const FORMAT_REGISTRY: readonly TimestampFormatDefinition[] = [
	{
		id: 'unix-s',
		label: 'UNIX秒',
		canonicalDigits: 10,
		nanosPerUnit: 1_000_000_000n,
	},
	{
		id: 'unix-ms',
		label: 'UNIXミリ秒',
		canonicalDigits: 13,
		nanosPerUnit: 1_000_000n,
	},
	{
		id: 'unix-us',
		label: 'UNIXマイクロ秒',
		canonicalDigits: 16,
		nanosPerUnit: 1_000n,
	},
	{
		id: 'unix-ns',
		label: 'UNIXナノ秒',
		canonicalDigits: 19,
		nanosPerUnit: 1n,
	},
];

const FORMAT_BY_ID = new Map(FORMAT_REGISTRY.map((f) => [f.id, f]));

export interface TimestampCandidate {
	format: TimestampFormatId;
	label: string;
	instantNanos: bigint;
	confidence: Confidence;
}

const PLAUSIBLE_YEAR_MIN = 1990;
const PLAUSIBLE_YEAR_MAX = 2040;
const ACCEPTABLE_YEAR_MIN = 1;
const ACCEPTABLE_YEAR_MAX = 9999;

/** 全角数字・全角記号を半角に正規化する */
function toHalfWidth(input: string): string {
	return input
		.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
		.replace(/[．]/g, '.')
		.replace(/[－ー―]/g, '-');
}

/** BigInt に対応した floor 除算（負数を正しく切り捨てる） */
function floorDivBigInt(a: bigint, b: bigint): bigint {
	const q = a / b;
	const r = a % b;
	return r !== 0n && r < 0n !== b < 0n ? q - 1n : q;
}

function instantToYear(instantNanos: bigint): number | null {
	const epochMs = floorDivBigInt(instantNanos, 1_000_000n);
	if (
		epochMs < BigInt(Number.MIN_SAFE_INTEGER) ||
		epochMs > BigInt(Number.MAX_SAFE_INTEGER)
	) {
		return null;
	}
	const date = new Date(Number(epochMs));
	if (Number.isNaN(date.getTime())) return null;
	return date.getUTCFullYear();
}

function confidenceForYear(year: number | null): Confidence | null {
	if (year === null) return null;
	if (year < ACCEPTABLE_YEAR_MIN || year > ACCEPTABLE_YEAR_MAX) return null;
	return year >= PLAUSIBLE_YEAR_MIN && year <= PLAUSIBLE_YEAR_MAX
		? 'high'
		: 'low';
}

function sortCandidates(
	candidates: TimestampCandidate[],
	digitCount: number,
): TimestampCandidate[] {
	const order = new Map(FORMAT_REGISTRY.map((f, i) => [f.id, i]));
	return [...candidates].sort((a, b) => {
		if (a.confidence !== b.confidence) {
			return a.confidence === 'high' ? -1 : 1;
		}
		const defA = FORMAT_BY_ID.get(
			a.format === 'slack-ts' ? 'unix-s' : a.format,
		);
		const defB = FORMAT_BY_ID.get(
			b.format === 'slack-ts' ? 'unix-s' : b.format,
		);
		const distA = defA ? Math.abs(digitCount - defA.canonicalDigits) : 99;
		const distB = defB ? Math.abs(digitCount - defB.canonicalDigits) : 99;
		if (distA !== distB) return distA - distB;
		return (
			(order.get(a.format as TimestampFormatId) ?? 99) -
			(order.get(b.format as TimestampFormatId) ?? 99)
		);
	});
}

/**
 * 整数の数値文字列（符号なし・小数なし）から候補一覧を生成する。
 * 4形式（秒/ミリ秒/マイクロ秒/ナノ秒）それぞれの解釈で妥当な年代範囲に
 * 収まるものだけを候補として残し、確度順（high→low）・桁数の近さ順に並べる。
 */
function detectFromInteger(sign: -1 | 1, digits: string): TimestampCandidate[] {
	const magnitude = BigInt(digits) * BigInt(sign);
	const candidates: TimestampCandidate[] = [];

	for (const def of FORMAT_REGISTRY) {
		const instantNanos = magnitude * def.nanosPerUnit;
		const confidence = confidenceForYear(instantToYear(instantNanos));
		if (!confidence) continue;
		candidates.push({
			format: def.id,
			label: def.label,
			instantNanos,
			confidence,
		});
	}

	if (candidates.length === 0) {
		// どの単位でも妥当な年代に収まらない場合は、桁数が最も近い形式を
		// フォールバックとして1件だけ提示する（候補ゼロを避ける）。
		// ただし Date/Intl で表示不能な（year 1〜9999 の範囲外になる）
		// 巨大な値はフォールバック対象から除外し、解釈不能として空配列を返す。
		const formattable = FORMAT_REGISTRY.map((def) => ({
			def,
			instantNanos: magnitude * def.nanosPerUnit,
		})).filter(({ instantNanos }) => instantToYear(instantNanos) !== null);

		if (formattable.length === 0) return [];

		let closest = formattable[0];
		let bestDist = Math.abs(digits.length - closest.def.canonicalDigits);
		for (const candidate of formattable) {
			const dist = Math.abs(digits.length - candidate.def.canonicalDigits);
			if (dist < bestDist) {
				bestDist = dist;
				closest = candidate;
			}
		}
		candidates.push({
			format: closest.def.id,
			label: closest.def.label,
			instantNanos: closest.instantNanos,
			confidence: 'low',
		});
	}

	return sortCandidates(candidates, digits.length);
}

/**
 * 小数を含む数値文字列（秒.小数部）から候補を生成する。
 * 整数部が10桁ちょうどの場合は Slack TS 形式として判定する。
 */
function detectFromDecimal(
	sign: -1 | 1,
	intDigits: string,
	fracDigits: string,
): TimestampCandidate[] {
	const fracNanos = fracDigits.slice(0, 9).padEnd(9, '0');
	const seconds = BigInt(intDigits);
	const nanos = BigInt(fracNanos);
	const instantNanos = (seconds * 1_000_000_000n + nanos) * BigInt(sign);

	const isSlackTs = intDigits.length === 10;
	const confidence = confidenceForYear(instantToYear(instantNanos)) ?? 'low';

	return [
		{
			format: isSlackTs ? 'slack-ts' : 'unix-s',
			label: isSlackTs ? 'Slack TS（秒.マイクロ秒）' : 'UNIX秒（小数秒）',
			instantNanos,
			confidence,
		},
	];
}

const INTEGER_PATTERN = /^(-)?(\d+)$/;
const DECIMAL_PATTERN = /^(-)?(\d+)\.(\d+)$/;

/**
 * 形式を明示指定して数値文字列をInstantへ変換する（WebMCP等の決定的変換用）。
 * 候補の年代フィルタは適用せず、指定形式でそのまま解釈する。
 */
export function instantFromExplicitFormat(
	rawInput: string,
	format: TimestampFormatId,
): bigint | null {
	const normalized = toHalfWidth(rawInput).trim();
	if (normalized === '') return null;

	const decimalMatch = normalized.match(DECIMAL_PATTERN);
	if (decimalMatch) {
		// 小数入力は「秒.端数」表現（UNIX秒 / Slack TS）としてのみ受け付ける。
		// ミリ秒以上の単位を明示指定した小数は解釈が曖昧なため非対応とする。
		if (format !== 'unix-s' && format !== 'slack-ts') return null;
		const [, signPart, intDigits, fracDigits] = decimalMatch;
		const fracNanos = fracDigits.slice(0, 9).padEnd(9, '0');
		const seconds = BigInt(intDigits);
		const nanos = BigInt(fracNanos);
		return (seconds * 1_000_000_000n + nanos) * BigInt(signPart ? -1 : 1);
	}

	const intMatch = normalized.match(INTEGER_PATTERN);
	if (!intMatch) return null;
	const [, signPart, digits] = intMatch;
	const magnitude = BigInt(digits) * BigInt(signPart ? -1 : 1);
	const def = FORMAT_BY_ID.get(format === 'slack-ts' ? 'unix-s' : format);
	if (!def) return null;
	return magnitude * def.nanosPerUnit;
}

/**
 * 数値文字列（タイムスタンプ）から解釈可能な全候補を確度順に返す。
 * 数値として解釈できない入力には空配列を返す。
 */
export function detectTimestampCandidates(
	rawInput: string,
): TimestampCandidate[] {
	const normalized = toHalfWidth(rawInput).trim();
	if (normalized === '') return [];

	const decimalMatch = normalized.match(DECIMAL_PATTERN);
	if (decimalMatch) {
		const [, signPart, intDigits, fracDigits] = decimalMatch;
		return detectFromDecimal(signPart ? -1 : 1, intDigits, fracDigits);
	}

	const intMatch = normalized.match(INTEGER_PATTERN);
	if (intMatch) {
		const [, signPart, digits] = intMatch;
		return detectFromInteger(signPart ? -1 : 1, digits);
	}

	return [];
}

// ---------------------------------------------------------------------------
// 日時文字列 → タイムスタンプ（逆変換）
// ---------------------------------------------------------------------------

export interface ParsedDateTime {
	instantNanos: bigint;
	/** 入力にタイムゾーンオフセットが明示されていたか */
	hasExplicitOffset: boolean;
}

const ISO_LIKE_PATTERN =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const SLASH_PATTERN =
	/^(\d{4})\/(\d{2})\/(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function parseOffsetToMinutes(offset: string): number {
	if (offset === 'Z') return 0;
	const m = offset.match(/^([+-])(\d{2}):?(\d{2})$/);
	if (!m) return 0;
	const sign = m[1] === '-' ? -1 : 1;
	return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * 年月日時分秒の各コンポーネントが実在する値かどうかを検証する。
 * `Date.UTC` は範囲外の値（例: 2月31日、25時）を暗黙的に繰り上げてしまうため、
 * 構築した日付を再分解して入力値と一致するかをラウンドトリップ検証する。
 */
function isValidDateTimeComponents(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	second: number,
): boolean {
	if (month < 1 || month > 12) return false;
	if (hour < 0 || hour > 23) return false;
	if (minute < 0 || minute > 59) return false;
	if (second < 0 || second > 59) return false;

	const epochMs = Date.UTC(year, month - 1, day, hour, minute, second);
	const date = new Date(epochMs);
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day &&
		date.getUTCHours() === hour &&
		date.getUTCMinutes() === minute &&
		date.getUTCSeconds() === second
	);
}

/** 指定タイムゾーンにおける、あるUTC時刻でのオフセット(分)を求める */
function getTimeZoneOffsetMinutes(timeZone: string, epochMs: number): number {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
	const parts = dtf.formatToParts(new Date(epochMs));
	const map: Record<string, string> = {};
	for (const p of parts) map[p.type] = p.value;
	const asUtc = Date.UTC(
		Number(map.year),
		Number(map.month) - 1,
		Number(map.day),
		Number(map.hour === '24' ? '0' : map.hour),
		Number(map.minute),
		Number(map.second),
	);
	return (asUtc - epochMs) / 60000;
}

/** 指定タイムゾーンでの壁時計時刻をUTCエポックミリ秒に変換する（DST収束2回） */
function zonedWallTimeToEpochMs(
	y: number,
	mo: number,
	d: number,
	h: number,
	mi: number,
	s: number,
	ms: number,
	timeZone: string,
): number {
	const base = Date.UTC(y, mo - 1, d, h, mi, s, ms);
	let guess = base;
	for (let i = 0; i < 2; i++) {
		const offsetMin = getTimeZoneOffsetMinutes(timeZone, guess);
		guess = base - offsetMin * 60000;
	}
	return guess;
}

/**
 * 日時文字列をタイムスタンプ（Instant）に変換する。
 * ISO 8601 / RFC 3339（オフセット付き・Z）、`YYYY/MM/DD HH:mm:ss`、`YYYY-MM-DD` に対応する。
 * オフセットが明示されない場合は `timeZone` を用いて解釈する。
 */
export function parseDateTimeString(
	rawInput: string,
	timeZone: string,
): ParsedDateTime | null {
	const input = toHalfWidth(rawInput).trim();
	if (input === '') return null;

	const isoMatch = input.match(ISO_LIKE_PATTERN);
	if (isoMatch) {
		const [, y, mo, d, h, mi, s, frac, offset] = isoMatch;
		const year = Number(y);
		const month = Number(mo);
		const day = Number(d);
		const hour = h ? Number(h) : 0;
		const minute = mi ? Number(mi) : 0;
		const second = s ? Number(s) : 0;
		const fracDigits = (frac ?? '').slice(0, 9).padEnd(9, '0');
		const fracNanos = BigInt(fracDigits || '0');

		if (!isValidDateTimeComponents(year, month, day, hour, minute, second)) {
			return null;
		}

		let epochMs: number;
		if (offset) {
			const offsetMin = parseOffsetToMinutes(offset);
			epochMs =
				Date.UTC(year, month - 1, day, hour, minute, second) -
				offsetMin * 60000;
		} else {
			epochMs = zonedWallTimeToEpochMs(
				year,
				month,
				day,
				hour,
				minute,
				second,
				0,
				timeZone,
			);
		}
		if (Number.isNaN(epochMs)) return null;
		const instantNanos = BigInt(epochMs) * 1_000_000n + fracNanos;
		return { instantNanos, hasExplicitOffset: Boolean(offset) };
	}

	const slashMatch = input.match(SLASH_PATTERN);
	if (slashMatch) {
		const [, y, mo, d, h, mi, s] = slashMatch;
		const year = Number(y);
		const month = Number(mo);
		const day = Number(d);
		const hour = h ? Number(h) : 0;
		const minute = mi ? Number(mi) : 0;
		const second = s ? Number(s) : 0;

		if (!isValidDateTimeComponents(year, month, day, hour, minute, second)) {
			return null;
		}

		const epochMs = zonedWallTimeToEpochMs(
			year,
			month,
			day,
			hour,
			minute,
			second,
			0,
			timeZone,
		);
		if (Number.isNaN(epochMs)) return null;
		return {
			instantNanos: BigInt(epochMs) * 1_000_000n,
			hasExplicitOffset: false,
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// Instant → 各種出力フォーマット
// ---------------------------------------------------------------------------

export interface DiscordTags {
	t: string;
	T: string;
	d: string;
	D: string;
	f: string;
	F: string;
	R: string;
}

export interface TimestampOutputs {
	isoUtc: string;
	isoLocal: string;
	rfc3339: string;
	wareki: string;
	unixSeconds: string;
	unixMilliseconds: string;
	discord: DiscordTags;
	relative: string;
}

function splitInstant(instantNanos: bigint): {
	epochMs: number;
	subSecondNanos: bigint;
} {
	const epochMsBig = floorDivBigInt(instantNanos, 1_000_000n);
	const epochSecondsBig = floorDivBigInt(instantNanos, 1_000_000_000n);
	// 秒未満の端数はミリ秒成分も含めて丸ごと保持する（日付フォーマットは秒までしか
	// 含まないため、ミリ秒はここで fractional 文字列側に乗せる必要がある）。
	const subSecondNanos = instantNanos - epochSecondsBig * 1_000_000_000n;
	return { epochMs: Number(epochMsBig), subSecondNanos };
}

/** サブ秒の端数を、意味のある最小桁数（ms/us/ns）で ".NNN" 形式にする */
function formatFractional(remainderNanos: bigint): string {
	if (remainderNanos === 0n) return '';
	const padded = remainderNanos.toString().padStart(9, '0');
	if (padded.endsWith('000000')) return `.${padded.slice(0, 3)}`;
	if (padded.endsWith('000')) return `.${padded.slice(0, 6)}`;
	return `.${padded}`;
}

function formatOffset(offsetMinutes: number): string {
	const sign = offsetMinutes < 0 ? '-' : '+';
	const abs = Math.abs(offsetMinutes);
	const hh = String(Math.floor(abs / 60)).padStart(2, '0');
	const mm = String(abs % 60).padStart(2, '0');
	return `${sign}${hh}:${mm}`;
}

function formatInTimeZone(
	epochMs: number,
	timeZone: string,
	fractional: string,
): string {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
	const parts = dtf.formatToParts(new Date(epochMs));
	const map: Record<string, string> = {};
	for (const p of parts) map[p.type] = p.value;
	const hour = map.hour === '24' ? '00' : map.hour;
	const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, epochMs);
	const offsetStr = timeZone === 'UTC' ? 'Z' : formatOffset(offsetMinutes);
	return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}${fractional}${offsetStr}`;
}

function formatWareki(epochMs: number, timeZone: string): string {
	const date = new Date(epochMs);
	const dtf = new Intl.DateTimeFormat('ja-JP-u-ca-japanese', {
		timeZone,
		era: 'long',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
	});
	const parts = dtf.formatToParts(date);
	const map: Record<string, string> = {};
	for (const p of parts) map[p.type] = p.value;
	const era = map.era ?? '';
	const year = map.year ?? '';
	const yearLabel = year === '1' ? '元年' : `${year}年`;
	return `${era}${yearLabel}${map.month}月${map.day}日(${map.weekday}) ${map.hour}:${map.minute}:${map.second}`;
}

function formatRelative(epochMs: number, nowMs: number): string {
	const diffSeconds = Math.round((epochMs - nowMs) / 1000);
	const rtf = new Intl.RelativeTimeFormat('ja', { numeric: 'auto' });
	const abs = Math.abs(diffSeconds);

	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		['year', 60 * 60 * 24 * 365],
		['month', 60 * 60 * 24 * 30],
		['day', 60 * 60 * 24],
		['hour', 60 * 60],
		['minute', 60],
		['second', 1],
	];

	for (const [unit, secondsPerUnit] of units) {
		if (abs >= secondsPerUnit || unit === 'second') {
			const value = Math.round(diffSeconds / secondsPerUnit);
			return rtf.format(value, unit);
		}
	}
	return rtf.format(0, 'second');
}

/**
 * Instant（エポックナノ秒）から、UI表示に必要な全出力を一括生成する。
 * `nowMs` は相対時刻計算の基準時刻（テスト容易性のため注入可能。省略時は Date.now()）。
 */
export function formatTimestamp(
	instantNanos: bigint,
	timeZone: string,
	nowMs: number = Date.now(),
): TimestampOutputs {
	const { epochMs, subSecondNanos } = splitInstant(instantNanos);
	const fractional = formatFractional(subSecondNanos);

	const isoUtc = formatInTimeZone(epochMs, 'UTC', fractional);
	const isoLocal = formatInTimeZone(epochMs, timeZone, fractional);
	const rfc3339 = formatInTimeZone(epochMs, timeZone, fractional).replace(
		'Z',
		'+00:00',
	);

	// 符号を1度だけ適用し、絶対値側で秒・端数を求める（floor演算だと
	// 例えば -0.5 秒が「-1」+「.500」= -1.5 秒相当に化けてしまうため）。
	const isNegative = instantNanos < 0n;
	const absInstantNanos = isNegative ? -instantNanos : instantNanos;
	const absSeconds = absInstantNanos / 1_000_000_000n;
	const absSubSecondNanos = absInstantNanos % 1_000_000_000n;
	const unixSecondsSign = isNegative ? '-' : '';
	const unixSeconds =
		absSubSecondNanos === 0n
			? `${unixSecondsSign}${absSeconds.toString()}`
			: `${unixSecondsSign}${absSeconds.toString()}${formatFractional(absSubSecondNanos)}`;

	// Discordタグは端数を四捨五入せず切り捨てた整数秒を使う
	// （実際の表示値である unixSeconds の整数部と一致させるため）。
	const discordSeconds = Number(floorDivBigInt(instantNanos, 1_000_000_000n));

	return {
		isoUtc,
		isoLocal,
		rfc3339,
		wareki: formatWareki(epochMs, timeZone),
		unixSeconds,
		unixMilliseconds: epochMs.toString(),
		discord: {
			t: `<t:${discordSeconds}:t>`,
			T: `<t:${discordSeconds}:T>`,
			d: `<t:${discordSeconds}:d>`,
			D: `<t:${discordSeconds}:D>`,
			f: `<t:${discordSeconds}:f>`,
			F: `<t:${discordSeconds}:F>`,
			R: `<t:${discordSeconds}:R>`,
		},
		relative: formatRelative(epochMs, nowMs),
	};
}

// ---------------------------------------------------------------------------
// 一括変換
// ---------------------------------------------------------------------------

export interface BatchRow {
	input: string;
	ok: boolean;
	formatLabel: string;
	isoUtc: string;
	unixSeconds: string;
	unixMilliseconds: string;
	error?: string;
}

/**
 * 複数行の入力（1行1値）を一括変換する。
 * 空行はスキップし、数値・日時文字列いずれも自動判定する。
 * 数値の場合は最上位候補を採用する。
 */
export function convertBatch(text: string, timeZone: string): BatchRow[] {
	const lines = text.split(/\r\n|\r|\n/);
	const rows: BatchRow[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === '') continue;

		const numericCandidates = detectTimestampCandidates(trimmed);
		if (numericCandidates.length > 0) {
			const top = numericCandidates[0];
			const outputs = formatTimestamp(top.instantNanos, timeZone);
			rows.push({
				input: trimmed,
				ok: true,
				formatLabel: top.label,
				isoUtc: outputs.isoUtc,
				unixSeconds: outputs.unixSeconds,
				unixMilliseconds: outputs.unixMilliseconds,
			});
			continue;
		}

		const parsed = parseDateTimeString(trimmed, timeZone);
		if (parsed) {
			const outputs = formatTimestamp(parsed.instantNanos, timeZone);
			rows.push({
				input: trimmed,
				ok: true,
				formatLabel: '日時文字列',
				isoUtc: outputs.isoUtc,
				unixSeconds: outputs.unixSeconds,
				unixMilliseconds: outputs.unixMilliseconds,
			});
			continue;
		}

		rows.push({
			input: trimmed,
			ok: false,
			formatLabel: '',
			isoUtc: '',
			unixSeconds: '',
			unixMilliseconds: '',
			error: '解釈できません',
		});
	}

	return rows;
}

const CSV_HEADER = ['入力', '形式', 'ISO8601(UTC)', 'UNIX秒', 'UNIXミリ秒'];

function escapeCsvField(field: string, delimiter: string): string {
	if (
		field.includes(delimiter) ||
		field.includes('"') ||
		field.includes('\n')
	) {
		return `"${field.replace(/"/g, '""')}"`;
	}
	return field;
}

/** 一括変換結果をTSV/CSV文字列に整形する */
export function batchRowsToDelimitedText(
	rows: BatchRow[],
	delimiter: '\t' | ',',
): string {
	const lines = [
		CSV_HEADER.map((h) => escapeCsvField(h, delimiter)).join(delimiter),
	];
	for (const row of rows) {
		const fields = row.ok
			? [
					row.input,
					row.formatLabel,
					row.isoUtc,
					row.unixSeconds,
					row.unixMilliseconds,
				]
			: [row.input, 'エラー', row.error ?? '', '', ''];
		lines.push(fields.map((f) => escapeCsvField(f, delimiter)).join(delimiter));
	}
	return lines.join('\n');
}

/** 現在時刻からInstant（エポックナノ秒）を得る */
export function nowInstantNanos(): bigint {
	return BigInt(Date.now()) * 1_000_000n;
}
