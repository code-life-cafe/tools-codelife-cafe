// ログ時間差分析ロジック。DOM/React非依存の純粋関数。
// 各行先頭のタイムスタンプだけを読み取り、解析可能な前行との間隔を計算する。
// 時刻は誤差を避けるためマイクロ秒（bigint）で保持する。

export const MAX_LINES = 10_000;
export const MAX_INPUT_BYTES = 1024 * 1024;
export const TOP_COUNT = 10;

export type TimeFormat = 'iso' | 'unix-s' | 'unix-ms';

export interface LogEntry {
	line: number;
	token: string;
	micros: bigint;
}

export interface InvalidLine {
	line: number;
	reason: string;
}

export interface DiffRow {
	fromLine: number;
	toLine: number;
	fromToken: string;
	toToken: string;
	diffMs: string;
	diffMicros: bigint;
	/** 解析可能な前行との間に、解析できない行または空行を挟んでいる */
	skippedBetween: boolean;
}

export interface AnalysisResult {
	totalLines: number;
	blankLines: number;
	validCount: number;
	invalidLines: InvalidLine[];
	/** 入力順に比較した全差分 */
	diffs: DiffRow[];
	/** 正の差分の上位（同値は元の順） */
	top: DiffRow[];
	/** 順序逆転（負の差分） */
	reversed: DiffRow[];
	zeroCount: number;
}

export type AnalyzeResult =
	| { ok: true; value: AnalysisResult }
	| { ok: false; error: string };

const ISO_PATTERN =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?(Z|[+-]\d{2}:?\d{2})$/;
const NUMBER_PATTERN = /^(\d{1,15})(?:\.(\d+))?$/;

function daysInMonth(year: number, month: number): number {
	if (month === 2) {
		return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
	}
	return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 小数部を unitDigits 桁（秒=6, ミリ秒=3）に揃えて整数化する。超過分は切り捨て。 */
function fractionMicros(
	digits: string | undefined,
	unitDigits: number,
): bigint {
	if (!digits) return 0n;
	return BigInt(digits.slice(0, unitDigits).padEnd(unitDigits, '0'));
}

export type ParseTimeResult =
	| { ok: true; micros: bigint }
	| { ok: false; reason: string };

export function parseTimestamp(
	token: string,
	format: TimeFormat,
): ParseTimeResult {
	if (format === 'iso') {
		const m = ISO_PATTERN.exec(token);
		if (!m) {
			return {
				ok: false,
				reason: 'ISO 8601（Zまたはオフセット付き）の形式ではありません',
			};
		}
		const year = Number(m[1]);
		const month = Number(m[2]);
		const day = Number(m[3]);
		const hour = Number(m[4]);
		const minute = Number(m[5]);
		const second = Number(m[6]);
		const zone = m[8] as string;
		if (
			month < 1 ||
			month > 12 ||
			day < 1 ||
			day > daysInMonth(year, month) ||
			hour > 23 ||
			minute > 59 ||
			second > 59
		) {
			return { ok: false, reason: '存在しない日時です' };
		}
		let offsetMinutes = 0;
		if (zone !== 'Z') {
			const sign = zone.startsWith('-') ? -1 : 1;
			const digits = zone.slice(1).replace(':', '');
			const oh = Number(digits.slice(0, 2));
			const om = Number(digits.slice(2, 4));
			if (oh > 23 || om > 59) {
				return { ok: false, reason: 'UTCオフセットが不正です' };
			}
			offsetMinutes = sign * (oh * 60 + om);
		}
		const d = new Date(0);
		d.setUTCFullYear(year, month - 1, day);
		d.setUTCHours(hour, minute, second, 0);
		const seconds = BigInt(Math.floor(d.getTime() / 1000));
		const adjusted = seconds - BigInt(offsetMinutes * 60);
		return {
			ok: true,
			micros: adjusted * 1_000_000n + fractionMicros(m[7], 6),
		};
	}
	const m = NUMBER_PATTERN.exec(token);
	if (!m) {
		return {
			ok: false,
			reason:
				format === 'unix-s'
					? 'UNIX秒（数値）の形式ではありません'
					: 'UNIXミリ秒（数値）の形式ではありません',
		};
	}
	const whole = BigInt(m[1] as string);
	if (format === 'unix-s') {
		return { ok: true, micros: whole * 1_000_000n + fractionMicros(m[2], 6) };
	}
	return { ok: true, micros: whole * 1000n + fractionMicros(m[2], 3) };
}

/** 行頭（任意の角括弧付き）のタイムスタンプ文字列を取り出す。 */
export function extractToken(
	line: string,
): { ok: true; token: string } | { ok: false; reason: string } {
	const text = line.trimStart();
	if (text.startsWith('[')) {
		const end = text.indexOf(']');
		if (end === -1) {
			return { ok: false, reason: '角括弧が閉じられていません' };
		}
		const token = text.slice(1, end).trim();
		if (token === '') return { ok: false, reason: '時刻が空です' };
		return { ok: true, token };
	}
	const match = /^\S+/.exec(text);
	if (!match) return { ok: false, reason: '時刻が空です' };
	return { ok: true, token: match[0] };
}

/** マイクロ秒差をミリ秒の10進文字列へ（小数は最大3桁、末尾0は省略）。 */
export function formatMs(micros: bigint): string {
	const negative = micros < 0n;
	const abs = negative ? -micros : micros;
	const whole = abs / 1000n;
	const frac = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
	return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

export function analyzeLog(text: string, format: TimeFormat): AnalyzeResult {
	if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) {
		return { ok: false, error: '入力が大きすぎます（上限1MiB）。' };
	}
	const lines = text.split(/\r\n|\r|\n/);
	if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	if (lines.length > MAX_LINES) {
		return {
			ok: false,
			error: `行数が多すぎます（上限${MAX_LINES.toLocaleString('ja-JP')}行）。`,
		};
	}
	const entries: LogEntry[] = [];
	const invalidLines: InvalidLine[] = [];
	let blankLines = 0;
	lines.forEach((raw, index) => {
		const line = index + 1;
		if (raw.trim() === '') {
			blankLines++;
			return;
		}
		const tok = extractToken(raw);
		if (!tok.ok) {
			invalidLines.push({ line, reason: tok.reason });
			return;
		}
		const parsed = parseTimestamp(tok.token, format);
		if (!parsed.ok) {
			invalidLines.push({ line, reason: parsed.reason });
			return;
		}
		entries.push({ line, token: tok.token, micros: parsed.micros });
	});

	const diffs: DiffRow[] = [];
	for (let i = 1; i < entries.length; i++) {
		const prev = entries[i - 1] as LogEntry;
		const cur = entries[i] as LogEntry;
		const diffMicros = cur.micros - prev.micros;
		diffs.push({
			fromLine: prev.line,
			toLine: cur.line,
			fromToken: prev.token,
			toToken: cur.token,
			diffMs: formatMs(diffMicros),
			diffMicros,
			skippedBetween: cur.line - prev.line > 1,
		});
	}
	// Array.prototype.sort は安定ソートのため、同値は元の順序を保つ
	const top = diffs
		.filter((d) => d.diffMicros > 0n)
		.sort((a, b) =>
			a.diffMicros === b.diffMicros ? 0 : a.diffMicros > b.diffMicros ? -1 : 1,
		)
		.slice(0, TOP_COUNT);
	return {
		ok: true,
		value: {
			totalLines: lines.length,
			blankLines,
			validCount: entries.length,
			invalidLines,
			diffs,
			top,
			reversed: diffs.filter((d) => d.diffMicros < 0n),
			zeroCount: diffs.filter((d) => d.diffMicros === 0n).length,
		},
	};
}

/** 表計算ソフトで数式として解釈され得る先頭文字を無害化する。 */
export function sanitizeCsvCell(value: string): string {
	return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvField(value: string): string {
	return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function diffKind(d: DiffRow): string {
	if (d.diffMicros > 0n) return '正の間隔';
	if (d.diffMicros === 0n) return '同時刻';
	return '順序逆転';
}

/** 全差分をCSV化（BOM付きUTF-8, CRLF）。ログ本文は含めない。 */
export function buildCsv(diffs: readonly DiffRow[]): string {
	const header = [
		'前の行番号',
		'前の時刻',
		'行番号',
		'時刻',
		'差分(ms)',
		'区分',
		'間に解析できない行あり',
	];
	const rows = diffs.map((d) =>
		[
			String(d.fromLine),
			sanitizeCsvCell(d.fromToken),
			String(d.toLine),
			sanitizeCsvCell(d.toToken),
			d.diffMs,
			diffKind(d),
			d.skippedBetween ? 'はい' : 'いいえ',
		]
			.map(csvField)
			.join(','),
	);
	return `﻿${[header.map(csvField).join(','), ...rows].join('\r\n')}\r\n`;
}
