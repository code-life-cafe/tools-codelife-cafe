import {
	type DiscordTags,
	detectTimestampCandidates,
	formatTimestamp,
	instantFromExplicitFormat,
	parseDateTimeString,
	type TimestampFormatId,
} from '../../tools/unix-time.ts';
import { failure } from '../errors.ts';
import { createWebMcpTool } from '../tool-factory.ts';
import {
	checkSizeLimit,
	isObject,
	optionalEnum,
	requireString,
} from '../validation.ts';

const SUPPORTED_FORMATS = [
	'auto',
	'unix-s',
	'unix-ms',
	'unix-us',
	'unix-ns',
	'slack-ts',
] as const;
type WebMcpFormat = (typeof SUPPORTED_FORMATS)[number];

interface UnixTimeInput {
	value: string;
	format: WebMcpFormat;
	timeZone: string;
}

interface UnixTimeOutput {
	resolvedFormat: string;
	isoUtc: string;
	isoLocal: string;
	rfc3339: string;
	wareki: string;
	unixSeconds: string;
	unixMilliseconds: string;
	discord: DiscordTags;
	relative: string;
}

const MAX_VALUE_CHARS = 64;

export const unixTimeTool = createWebMcpTool<UnixTimeInput, UnixTimeOutput>({
	name: 'convert_unix_time',
	description:
		'Convert between UNIX timestamps (seconds / milliseconds / microseconds / nanoseconds / Slack TS) and datetime strings (ISO 8601, RFC 3339, YYYY/MM/DD HH:mm:ss). Deterministic, runs entirely in the browser. / UNIXタイムスタンプ（秒〜ナノ秒・Slack TS）と日時文字列を相互変換する。ブラウザ内で完結する決定的変換。',
	inputSchema: {
		type: 'object',
		properties: {
			value: {
				type: 'string',
				description:
					'Timestamp number or datetime string to convert / 変換対象のタイムスタンプ数値または日時文字列',
			},
			format: {
				type: 'string',
				enum: SUPPORTED_FORMATS,
				description:
					'Explicit source unit for numeric input, or "auto" to auto-detect by digit count / 数値入力の単位を明示指定。省略時は桁数から自動判定',
			},
			timeZone: {
				type: 'string',
				description:
					'IANA time zone for local output and for parsing datetime strings without an explicit offset (default: UTC) / 出力および日時文字列解釈に使うIANAタイムゾーン（省略時UTC）',
			},
		},
		required: ['value'],
	},
	outputSchema: {
		type: 'object',
		properties: {
			resolvedFormat: { type: 'string' },
			isoUtc: { type: 'string' },
			isoLocal: { type: 'string' },
			rfc3339: { type: 'string' },
			wareki: { type: 'string' },
			unixSeconds: { type: 'string' },
			unixMilliseconds: { type: 'string' },
			discord: { type: 'object' },
			relative: { type: 'string' },
		},
		required: [
			'resolvedFormat',
			'isoUtc',
			'isoLocal',
			'rfc3339',
			'wareki',
			'unixSeconds',
			'unixMilliseconds',
			'discord',
			'relative',
		],
	},
	validate(input) {
		if (!isObject(input))
			return failure('Input must be an object / 入力値が不正です');
		const value = requireString(input, 'value');
		if (!value.ok) return value;
		const sizeChecked = checkSizeLimit(value.value, MAX_VALUE_CHARS, '"value"');
		if (!sizeChecked.ok) return sizeChecked;
		const format = optionalEnum(input, 'format', SUPPORTED_FORMATS, 'auto');
		if (!format.ok) return format;
		const timeZone =
			typeof input.timeZone === 'string' && input.timeZone.trim() !== ''
				? input.timeZone
				: 'UTC';
		try {
			Intl.DateTimeFormat(undefined, { timeZone });
		} catch {
			return failure(
				'"timeZone" must be a valid IANA time zone / "timeZone" は有効なIANAタイムゾーン名で指定してください',
			);
		}
		return {
			ok: true,
			value: { value: value.value, format: format.value, timeZone },
		};
	},
	execute({ value, format, timeZone }) {
		let instantNanos: bigint | null = null;
		let resolvedFormat = format;

		if (format === 'auto') {
			const candidates = detectTimestampCandidates(value);
			if (candidates.length > 0) {
				instantNanos = candidates[0].instantNanos;
				resolvedFormat = candidates[0].format as WebMcpFormat;
			} else {
				const parsed = parseDateTimeString(value, timeZone);
				if (parsed) {
					instantNanos = parsed.instantNanos;
					resolvedFormat = 'auto';
				}
			}
		} else {
			instantNanos = instantFromExplicitFormat(
				value,
				format as TimestampFormatId,
			);
		}

		if (instantNanos === null) {
			throw new Error(
				`Unable to interpret "${value}" as a timestamp or datetime / "${value}" をタイムスタンプまたは日時として解釈できません`,
			);
		}

		const outputs = formatTimestamp(instantNanos, timeZone);
		return { resolvedFormat, ...outputs };
	},
});
