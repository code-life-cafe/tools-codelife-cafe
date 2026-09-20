import Papa from 'papaparse';

export type CsvDelimiter = ',' | '\t' | ';';

export interface JsonToCsvOptions {
	delimiter: CsvDelimiter;
	includeHeader: boolean;
	flattenNested: boolean;
	newline: '\r\n' | '\n';
}

export interface CsvToJsonOptions {
	delimiter: CsvDelimiter | 'auto';
	hasHeader: boolean;
	inferTypes: boolean;
	unflattenDotKeys: boolean;
}

export type ConvertResult =
	| { ok: true; output: string; rowCount: number }
	| { ok: false; error: string; line?: number };

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------

/** 入力先頭のBOMを除去する */
export function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

function getOwnValue(obj: Record<string, unknown>, key: string): unknown {
	return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function setOwnValue(
	obj: Record<string, unknown>,
	key: string,
	value: unknown,
): void {
	Object.defineProperty(obj, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true,
	});
}

function makeUniqueHeaders(headers: readonly string[]): string[] {
	const used = new Set<string>();
	const counts = new Map<string, number>();
	return headers.map((header) => {
		let count = (counts.get(header) ?? 0) + 1;
		counts.set(header, count);
		let candidate = count === 1 ? header : `${header}_${count}`;
		while (used.has(candidate)) {
			count++;
			counts.set(header, count);
			candidate = `${header}_${count}`;
		}
		used.add(candidate);
		return candidate;
	});
}

function normalizeRecordNewlines(csvText: string): string {
	let normalized = '';
	let inQuotes = false;
	for (let i = 0; i < csvText.length; i++) {
		const ch = csvText[i];
		if (ch === '"') {
			normalized += ch;
			if (inQuotes && csvText[i + 1] === '"') {
				normalized += csvText[i + 1];
				i++;
				continue;
			}
			inQuotes = !inQuotes;
			continue;
		}
		if (!inQuotes && ch === '\r') {
			if (csvText[i + 1] === '\n') i++;
			normalized += '\n';
			continue;
		}
		normalized += ch;
	}
	return normalized;
}

/**
 * ネスト構造をドット記法（user.name）にフラット化する。配列はインデックス記法（items.0）。
 * 空オブジェクト・空配列はキーを生成しない（完全復元は対象外）。
 */
export function flattenObject(
	obj: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const walk = (value: unknown, prefix: string): void => {
		if (Array.isArray(value)) {
			value.forEach((item, index) => {
				walk(item, `${prefix}.${index}`);
			});
			return;
		}
		if (isPlainObject(value)) {
			for (const [key, child] of Object.entries(value)) {
				walk(child, `${prefix}.${key}`);
			}
			return;
		}
		setOwnValue(
			out,
			prefix,
			typeof value === 'object' && value !== null ? String(value) : value,
		);
	};
	for (const [key, value] of Object.entries(obj)) {
		walk(value, key);
	}
	return out;
}

/**
 * ドット記法キーをネスト構造へ復元する。数値セグメントは配列として解釈する。
 * 実キー名に `.` を含むケースや `items.0` 形式の実キーとの衝突は対象外（last-write-wins）。
 */
export function unflattenObject(
	flat: Record<string, unknown>,
): Record<string, unknown> {
	const root: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(flat)) {
		const segments = key.split('.');
		let current: Record<string, unknown> | unknown[] = root;
		for (let i = 0; i < segments.length - 1; i++) {
			const segment = segments[i];
			const nextIsIndex = /^\d+$/.test(segments[i + 1]);
			let child = Array.isArray(current)
				? current[Number(segment)]
				: getOwnValue(current, segment);
			if (child == null || typeof child !== 'object') {
				child = nextIsIndex ? [] : {};
				if (Array.isArray(current)) {
					current[Number(segment)] = child;
				} else {
					setOwnValue(current, segment, child);
				}
			}
			current = child as Record<string, unknown> | unknown[];
		}
		const last = segments[segments.length - 1];
		if (Array.isArray(current)) {
			current[Number(last)] = value;
		} else {
			setOwnValue(current, last, value);
		}
	}
	return root;
}

/**
 * 1行目のクォート外に出現する区切り文字候補の数で判定する。同数の場合はカンマを優先。
 */
export function detectDelimiter(csvText: string): CsvDelimiter {
	const counts: Record<CsvDelimiter, number> = { ',': 0, '\t': 0, ';': 0 };
	let inQuotes = false;
	for (let i = 0; i < csvText.length; i++) {
		const ch = csvText[i];
		if (ch === '"') {
			if (inQuotes && csvText[i + 1] === '"') {
				i++;
				continue;
			}
			inQuotes = !inQuotes;
			continue;
		}
		if (!inQuotes) {
			if (ch === '\n' || ch === '\r') break;
			if (ch === ',' || ch === '\t' || ch === ';') counts[ch]++;
		}
	}
	if (counts[','] >= counts['\t'] && counts[','] >= counts[';']) return ',';
	if (counts['\t'] >= counts[';']) return '\t';
	return ';';
}

/**
 * セル値の型推論。
 * - 空セルのみ null
 * - 完全小文字の "true" / "false" のみ boolean
 * - "null" は文字列のまま保持
 * - 先頭ゼロ付き数値（"007"・"001.23"）は文字列のまま保持（"0" は number）
 * - Number.MAX_SAFE_INTEGER を超える整数は桁落ちを避けるため文字列のまま保持
 * - 日付文字列は変換しない
 */
export function inferCellValue(raw: string): string | number | boolean | null {
	if (raw === '') return null;
	if (raw === 'true') return true;
	if (raw === 'false') return false;
	if (raw === 'null') return raw;
	if (/^-?(0|[1-9]\d*)$/.test(raw)) {
		const num = Number(raw);
		return Number.isSafeInteger(num) ? num : raw;
	}
	if (/^-?(0|[1-9]\d*)\.\d+$/.test(raw)) {
		const num = Number(raw);
		if (Number.isFinite(num)) return num;
	}
	return raw;
}

function jsonErrorLine(text: string, message: string): number | undefined {
	const lineMatch = message.match(/line (\d+)/);
	if (lineMatch) return Number(lineMatch[1]);
	const posMatch = message.match(/position (\d+)/);
	if (posMatch) {
		return text.slice(0, Number(posMatch[1])).split('\n').length;
	}
	return undefined;
}

/**
 * Number.MAX_SAFE_INTEGER を超える整数リテラルの桁を保持するためのラッパー。
 * parseJsonPreservingIntegers 内でのみ生成され、CSV出力直前に digits（元の桁文字列）へ戻す。
 */
class BigIntLiteral {
	readonly digits: string;
	constructor(digits: string) {
		this.digits = digits;
	}
	toString(): string {
		return this.digits;
	}
}

class JsonSyntaxError extends Error {
	constructor(message: string, position: number) {
		super(`${message} at position ${position}`);
	}
}

/**
 * JSON.parse 相当の再帰下降パーサー。安全整数範囲外の整数リテラルは Number ではなく
 * BigIntLiteral として桁を保持する（小数・指数表記は従来どおり Number化）。
 *
 * ネイティブ JSON.parse の reviver は、オブジェクトの数値様キー（"1"・"2" 等）を
 * ソース出現順ではなく昇順に並べ替えて呼び出すため、パース後に外部で走査した数値
 * リテラルの出現順と突き合わせる方式では対応関係がずれて値を取り違える。値の構築
 * と桁保持を同時に行うことでこの問題を避ける。
 */
function parseJsonPreservingIntegers(text: string): unknown {
	const len = text.length;
	let i = 0;

	const fail = (message: string): never => {
		throw new JsonSyntaxError(message, i);
	};

	const skipWhitespace = (): void => {
		while (i < len) {
			const ch = text[i];
			if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
				i++;
			} else {
				break;
			}
		}
	};

	const parseValue = (): unknown => {
		skipWhitespace();
		if (i >= len) fail('Unexpected end of JSON input');
		const ch = text[i];
		if (ch === '{') return parseObject();
		if (ch === '[') return parseArray();
		if (ch === '"') return parseString();
		if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber();
		if (text.startsWith('true', i)) {
			i += 4;
			return true;
		}
		if (text.startsWith('false', i)) {
			i += 5;
			return false;
		}
		if (text.startsWith('null', i)) {
			i += 4;
			return null;
		}
		return fail('Unexpected token in JSON');
	};

	const parseObject = (): Record<string, unknown> => {
		const obj: Record<string, unknown> = {};
		i++; // '{'
		skipWhitespace();
		if (text[i] === '}') {
			i++;
			return obj;
		}
		for (;;) {
			skipWhitespace();
			if (text[i] !== '"') fail('Expected property name in JSON');
			const key = parseString();
			skipWhitespace();
			if (text[i] !== ':') fail("Expected ':' after property name in JSON");
			i++;
			const value = parseValue();
			setOwnValue(obj, key, value);
			skipWhitespace();
			if (text[i] === ',') {
				i++;
				continue;
			}
			if (text[i] === '}') {
				i++;
				return obj;
			}
			fail("Expected ',' or '}' in JSON object");
		}
	};

	const parseArray = (): unknown[] => {
		const arr: unknown[] = [];
		i++; // '['
		skipWhitespace();
		if (text[i] === ']') {
			i++;
			return arr;
		}
		for (;;) {
			arr.push(parseValue());
			skipWhitespace();
			if (text[i] === ',') {
				i++;
				continue;
			}
			if (text[i] === ']') {
				i++;
				return arr;
			}
			fail("Expected ',' or ']' in JSON array");
		}
	};

	const parseString = (): string => {
		i++; // opening quote
		let result = '';
		while (i < len) {
			const ch = text[i];
			if (ch === '"') {
				i++;
				return result;
			}
			if (ch === '\\') {
				const next = text[i + 1];
				switch (next) {
					case '"':
						result += '"';
						break;
					case '\\':
						result += '\\';
						break;
					case '/':
						result += '/';
						break;
					case 'b':
						result += '\b';
						break;
					case 'f':
						result += '\f';
						break;
					case 'n':
						result += '\n';
						break;
					case 'r':
						result += '\r';
						break;
					case 't':
						result += '\t';
						break;
					case 'u': {
						const hex = text.slice(i + 2, i + 6);
						if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
							fail('Invalid unicode escape in JSON string');
						}
						result += String.fromCharCode(Number.parseInt(hex, 16));
						i += 4;
						break;
					}
					default:
						fail('Invalid escape character in JSON string');
				}
				i += 2;
				continue;
			}
			if (ch.charCodeAt(0) < 0x20)
				fail('Invalid control character in JSON string');
			result += ch;
			i++;
		}
		return fail('Unterminated JSON string');
	};

	const parseNumber = (): number | BigIntLiteral => {
		const start = i;
		if (text[i] === '-') i++;
		if (text[i] === '0') {
			i++;
		} else if (text[i] >= '1' && text[i] <= '9') {
			while (i < len && text[i] >= '0' && text[i] <= '9') i++;
		} else {
			fail('Invalid number in JSON');
		}
		const intEnd = i;
		let isInteger = true;
		if (text[i] === '.') {
			isInteger = false;
			i++;
			if (!(text[i] >= '0' && text[i] <= '9')) fail('Invalid number in JSON');
			while (i < len && text[i] >= '0' && text[i] <= '9') i++;
		}
		if (text[i] === 'e' || text[i] === 'E') {
			isInteger = false;
			i++;
			if (text[i] === '+' || text[i] === '-') i++;
			if (!(text[i] >= '0' && text[i] <= '9')) fail('Invalid number in JSON');
			while (i < len && text[i] >= '0' && text[i] <= '9') i++;
		}
		if (isInteger) {
			const digits = text.slice(start, intEnd);
			const num = Number(digits);
			if (!Number.isSafeInteger(num)) return new BigIntLiteral(digits);
			return num;
		}
		return Number(text.slice(start, i));
	};

	const result = parseValue();
	skipWhitespace();
	if (i < len) fail('Unexpected non-whitespace character after JSON value');
	return result;
}

/**
 * JSON.stringify相当だが、ネストした BigIntLiteral を桁文字列のまま（未クォートの
 * 数値として）出力する。flattenNested OFF でネスト値をJSON文字列セルにする際に使う。
 */
function stringifyWithBigInt(value: unknown): string {
	if (value instanceof BigIntLiteral) return value.digits;
	if (Array.isArray(value)) {
		return `[${value.map((item) => stringifyWithBigInt(item ?? null)).join(',')}]`;
	}
	if (isPlainObject(value)) {
		const entries = Object.entries(value).map(
			([key, v]) => `${JSON.stringify(key)}:${stringifyWithBigInt(v)}`,
		);
		return `{${entries.join(',')}}`;
	}
	return JSON.stringify(value);
}

function cellToString(value: unknown): string {
	if (value == null) return '';
	if (value instanceof BigIntLiteral) return value.digits;
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return stringifyWithBigInt(value);
}

// ---------------------------------------------------------------------------
// JSON → CSV
// ---------------------------------------------------------------------------

export function jsonToCsv(
	jsonText: string,
	options: JsonToCsvOptions,
): ConvertResult {
	const text = stripBom(jsonText);
	if (!text.trim()) {
		return { ok: false, error: 'JSONを入力してください。' };
	}

	// 安全整数範囲外の整数を桁落ちさせずに保持するため、専用パーサーで値の構築と
	// 桁保持を同時に行う（ネイティブJSON.parseのreviverは数値様キーの列挙順が
	// ソース出現順と一致しないため使えない）。
	let parsed: unknown;
	try {
		parsed = parseJsonPreservingIntegers(text);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const line = jsonErrorLine(text, message);
		return {
			ok: false,
			error:
				line != null
					? `${line}行目付近: JSONの構文エラーです。`
					: 'JSONの構文エラーです。入力内容を確認してください。',
			line,
		};
	}

	let rows: Record<string, unknown>[];
	if (Array.isArray(parsed)) {
		if (parsed.length === 0) {
			return {
				ok: false,
				error: '変換できるデータがありません（空の配列です）。',
			};
		}
		if (!parsed.every(isPlainObject)) {
			return {
				ok: false,
				error:
					'CSVに変換できるのはオブジェクトの配列です。プリミティブ値やnullを含む配列は変換できません。',
			};
		}
		rows = parsed;
	} else if (isPlainObject(parsed)) {
		// 単一オブジェクトは1行として扱う
		rows = [parsed];
	} else {
		return {
			ok: false,
			error:
				'CSVに変換できるのはオブジェクトまたはオブジェクトの配列です。文字列・数値・nullは変換できません。',
		};
	}

	const flatRows = options.flattenNested
		? rows.map((row) => flattenObject(row))
		: rows;

	// ヘッダーは全行のキーの和集合（出現順）
	const headers: string[] = [];
	const seen = new Set<string>();
	for (const row of flatRows) {
		for (const key of Object.keys(row)) {
			if (!seen.has(key)) {
				seen.add(key);
				headers.push(key);
			}
		}
	}

	const data = flatRows.map((row) =>
		headers.map((header) => cellToString(row[header])),
	);

	const csv = options.includeHeader
		? Papa.unparse(
				{ fields: headers, data },
				{ delimiter: options.delimiter, newline: options.newline },
			)
		: Papa.unparse(data, {
				delimiter: options.delimiter,
				newline: options.newline,
			});

	return { ok: true, output: csv, rowCount: flatRows.length };
}

// ---------------------------------------------------------------------------
// CSV → JSON
// ---------------------------------------------------------------------------

export function csvToJson(
	csvText: string,
	options: CsvToJsonOptions,
): ConvertResult {
	const text = stripBom(csvText);
	if (!text.trim()) {
		return { ok: false, error: 'CSVを入力してください。' };
	}

	const delimiter =
		options.delimiter === 'auto' ? detectDelimiter(text) : options.delimiter;
	const parseText = normalizeRecordNewlines(text);

	// ヘッダー処理・列数調整・型推論は自前で行うため header: false 固定
	const result = Papa.parse<string[]>(parseText, {
		delimiter,
		header: false,
		skipEmptyLines: 'greedy',
	});

	for (const err of result.errors) {
		// Papa の row はクォート内改行を含む場合、論理行番号になる
		const line = err.row != null ? err.row + 1 : undefined;
		if (err.code === 'MissingQuotes') {
			return {
				ok: false,
				error:
					line != null
						? `${line}行目付近: 引用符（"）が閉じられていません。`
						: '引用符（"）が閉じられていません。',
				line,
			};
		}
		if (err.code === 'InvalidQuotes') {
			return {
				ok: false,
				error:
					line != null
						? `${line}行目付近: 引用符で囲まれたセルの後に不正な文字があります。`
						: '引用符で囲まれたセルの後に不正な文字があります。',
				line,
			};
		}
	}

	const rawRows = result.data;
	if (rawRows.length === 0 || (options.hasHeader && rawRows.length === 1)) {
		return { ok: false, error: '変換できるデータ行がありません。' };
	}

	let headers: string[];
	let dataRows: string[][];
	if (options.hasHeader) {
		headers = makeUniqueHeaders(rawRows[0]);
		dataRows = rawRows.slice(1);
	} else {
		const maxCols = Math.max(...rawRows.map((row) => row.length));
		headers = Array.from({ length: maxCols }, (_, i) => `column_${i + 1}`);
		dataRows = rawRows;
	}

	const objects = dataRows.map((row) => {
		const record: Record<string, unknown> = {};
		// 列数不足は空文字として扱い、超過分は extra_1, extra_2 ... に格納する
		const colCount = Math.max(headers.length, row.length);
		for (let i = 0; i < colCount; i++) {
			const key =
				i < headers.length ? headers[i] : `extra_${i - headers.length + 1}`;
			const raw = i < row.length ? row[i] : '';
			setOwnValue(record, key, options.inferTypes ? inferCellValue(raw) : raw);
		}
		return options.unflattenDotKeys ? unflattenObject(record) : record;
	});

	return {
		ok: true,
		output: JSON.stringify(objects, null, 2),
		rowCount: objects.length,
	};
}

/** CSV文字列からBlobを生成する。withBom: true で先頭にBOM（Excel文字化け対策） */
export function buildCsvBlob(csv: string, withBom: boolean): Blob {
	const content = withBom ? '\u{FEFF}'.concat(csv) : csv;
	return new Blob([content], {
		type: 'text/csv;charset=utf-8',
	});
}
