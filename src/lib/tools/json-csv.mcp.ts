import Papa from 'papaparse';
import { exceedsMaxCharacters } from '../string-length.ts';
import { defineMcpTool } from '../webmcp/define-tool.ts';
import {
	type ConvertResult,
	type CsvDelimiter,
	csvToJson,
	detectDelimiter,
	flattenObject,
	jsonToCsv,
	stripBom,
} from './json-csv.ts';

const MAX_INPUT_CHARACTERS = 100_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_NESTING_DEPTH = 50;

const INPUT_LIMIT_MESSAGE = `入力の上限は${MAX_INPUT_CHARACTERS}文字です。`;
const OUTPUT_LIMIT_MESSAGE = '変換結果が上限（UTF-8で1MiB）を超えます。';
const DEPTH_LIMIT_MESSAGE = `ネストの深さが上限（${MAX_NESTING_DEPTH}段）を超えています。`;
const INDEX_LIMIT_MESSAGE =
	'ドット記法キーの配列インデックスが大きく、展開結果が上限を超えるため変換できません。';
const UNEXPECTED_MESSAGE = '変換中に予期しないエラーが発生しました。';

/** 利用者に返してよい固定文言のエラー。これ以外の例外は想定外として扱う */
class ConversionError extends Error {}

const DELIMITERS: Record<string, CsvDelimiter> = {
	comma: ',',
	tab: '\t',
	semicolon: ';',
};

/**
 * 文字列リテラルとエスケープを読み飛ばしながら `[` `{` の入れ子の深さを数え、
 * 既存パーサーに渡す前に上限超過を判定する。閉じていない入力も開いた分で判定する。
 */
function exceedsJsonDepth(text: string, limit: number): boolean {
	let depth = 0;
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (ch === '\\') i++;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === '[' || ch === '{') {
			if (++depth > limit) return true;
		} else if ((ch === ']' || ch === '}') && depth > 0) depth--;
	}
	return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 出力はヘッダー和集合 × 行数のセルを持ち、区切り文字だけで 行数 × (列数 - 1) バイトになる。
 * これが上限を超える入力は、巨大なCSVを生成する前に拒否する。構文エラー等は既存変換に任せる。
 */
function assertJsonToCsvWithinOutputLimit(
	text: string,
	flattenNested: boolean,
): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripBom(text));
	} catch {
		return;
	}
	const rows = Array.isArray(parsed) ? parsed : [parsed];
	if (rows.length === 0 || !rows.every(isRecord)) return;
	const headers = new Set<string>();
	for (const row of rows) {
		for (const key of Object.keys(flattenNested ? flattenObject(row) : row)) {
			headers.add(key);
		}
	}
	if (rows.length * Math.max(headers.size - 1, 0) > MAX_OUTPUT_BYTES) {
		throw new ConversionError(OUTPUT_LIMIT_MESSAGE);
	}
}

/**
 * 出力JSONの1要素（プロパティ行・配列要素行）は、インデント4以上・引用符・コロン・空白・値1文字以上・
 * 改行で、キーのUTF-8バイト数に8バイトを加えた長さ以上になる。変換前に出力の下限バイト数を
 * 計算して1MiBを超える入力を拒否し、巨大な中間オブジェクト・文字列の生成を防ぐ。
 */
const MIN_ENTRY_OVERHEAD_BYTES = 8;
/** `extra_N`（ヘッダーより多い列）の最短キー `extra_1` のバイト数 */
const MIN_EXTRA_KEY_BYTES = 7;
/** 配列添字として実在できる最大値（2^32 - 2） */
const MAX_ARRAY_INDEX = 4_294_967_294;

function utf8Bytes(text: string): number {
	let bytes = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0) as number;
		bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
	}
	return bytes;
}

/** JSON文字列としてエスケープした後の、引用符を除くキーのUTF-8バイト数 */
function jsonKeyBytes(key: string): number {
	return utf8Bytes(JSON.stringify(key)) - 2;
}

/** json-csv.ts の makeUniqueHeaders と同じ規則（非公開のため同一規則で再現） */
function uniqueHeaders(headers: readonly string[]): string[] {
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

function isRealArrayIndex(n: number): boolean {
	return Number.isInteger(n) && n >= 0 && n <= MAX_ARRAY_INDEX;
}

/** オブジェクトの列挙順（整数様キーを昇順で先頭、その他は挿入順）に並べる */
function inObjectKeyOrder(keys: readonly string[]): string[] {
	const indexLike: string[] = [];
	const others: string[] = [];
	for (const key of keys) {
		const n = Number(key);
		if (String(n) === key && isRealArrayIndex(n)) indexLike.push(key);
		else others.push(key);
	}
	indexLike.sort((a, b) => Number(a) - Number(b));
	return indexLike.concat(others);
}

/** unflattenObject の構築結果を、配列を実体化せずに表すノード。スカラーは null */
interface ShapeNode {
	array: boolean;
	children: Map<string, ShapeNode | null>;
	maxIndex: number;
}

/**
 * 既存 unflattenObject と同じ順序・コンテナ種別・スカラー上書きの規則でキー構造だけを再現し、
 * 1行あたりの出力下限バイト数と、実際に配列へ入る要素数（疎配列の長さ）を返す。
 * 既に確定したオブジェクト配下の数値キーは通常のプロパティとして扱い、配列要素に数えない。
 */
function estimateUnflattenedRow(keys: readonly string[]): {
	bytes: number;
	slots: number;
} {
	const root: ShapeNode = { array: false, children: new Map(), maxIndex: -1 };
	const slotKey = (node: ShapeNode, segment: string): string =>
		node.array ? String(Number(segment)) : segment;
	const noteIndex = (node: ShapeNode, segment: string): void => {
		if (!node.array) return;
		const n = Number(segment);
		if (isRealArrayIndex(n)) node.maxIndex = Math.max(node.maxIndex, n);
	};
	for (const key of inObjectKeyOrder(keys)) {
		const segments = key.split('.');
		if (segments.length > MAX_NESTING_DEPTH) {
			throw new ConversionError(DEPTH_LIMIT_MESSAGE);
		}
		let current = root;
		for (let i = 0; i < segments.length - 1; i++) {
			const slot = slotKey(current, segments[i]);
			let child = current.children.get(slot) ?? null;
			if (child === null) {
				child = {
					array: /^\d+$/.test(segments[i + 1]),
					children: new Map(),
					maxIndex: -1,
				};
				current.children.set(slot, child);
				noteIndex(current, segments[i]);
			}
			current = child;
		}
		const last = segments[segments.length - 1];
		current.children.set(slotKey(current, last), null);
		noteIndex(current, last);
	}
	let bytes = 0;
	let slots = 0;
	const walk = (node: ShapeNode): void => {
		if (node.array) {
			const length = node.maxIndex + 1;
			slots += length;
			bytes += length * MIN_ENTRY_OVERHEAD_BYTES;
			for (const [slot, child] of node.children) {
				if (child && isRealArrayIndex(Number(slot))) walk(child);
			}
			return;
		}
		for (const [slot, child] of node.children) {
			bytes += MIN_ENTRY_OVERHEAD_BYTES + jsonKeyBytes(slot);
			if (child) walk(child);
		}
	};
	walk(root);
	return { bytes, slots };
}

/**
 * csvToJson 呼び出し前に、出力JSONの下限バイト数（キー文字列の反復を含む）を行ごとに積算して
 * 1MiB超を拒否する。解析結果は入力文字数に比例する文字列配列のみで、行×列のオブジェクトや
 * 巨大な文字列は作らない。通常・hasHeader=false・型推論・重複ヘッダー・extra_N・展開を対象とする。
 * 展開時は構造だけを再現した下限で評価し、疎配列の長さも出力バイトに含める。
 */
function assertCsvWithinBudget(
	text: string,
	options: {
		delimiter: CsvDelimiter | 'auto';
		hasHeader: boolean;
		unflattenDotKeys: boolean;
	},
): void {
	const body = stripBom(text);
	if (!body.trim()) return;
	const delimiter =
		options.delimiter === 'auto' ? detectDelimiter(body) : options.delimiter;
	const rows = Papa.parse<string[]>(body.replace(/\r\n?/g, '\n'), {
		delimiter,
		header: false,
		skipEmptyLines: 'greedy',
	}).data;
	if (rows.length === 0 || (options.hasHeader && rows.length === 1)) return;

	let totalBytes = 0;
	if (options.hasHeader) {
		const headerLength = rows[0].length;
		const keys = uniqueHeaders(rows[0]);
		let rowBytes = 0;
		if (options.unflattenDotKeys) {
			const shape = estimateUnflattenedRow(keys);
			rowBytes = shape.bytes;
			if (
				shape.slots * MIN_ENTRY_OVERHEAD_BYTES * (rows.length - 1) >
				MAX_OUTPUT_BYTES
			) {
				throw new ConversionError(INDEX_LIMIT_MESSAGE);
			}
		} else {
			for (const key of keys) {
				rowBytes += MIN_ENTRY_OVERHEAD_BYTES + jsonKeyBytes(key);
			}
		}
		for (let i = 1; i < rows.length; i++) {
			const extraColumns = Math.max(0, rows[i].length - headerLength);
			totalBytes +=
				rowBytes +
				extraColumns * (MIN_ENTRY_OVERHEAD_BYTES + MIN_EXTRA_KEY_BYTES);
		}
	} else {
		let maxColumns = 0;
		for (const row of rows) maxColumns = Math.max(maxColumns, row.length);
		let rowBytes = 0;
		for (let i = 1; i <= maxColumns; i++) {
			rowBytes += MIN_ENTRY_OVERHEAD_BYTES + `column_${i}`.length;
		}
		totalBytes = rowBytes * rows.length;
	}
	if (totalBytes > MAX_OUTPUT_BYTES) {
		throw new ConversionError(OUTPUT_LIMIT_MESSAGE);
	}
}

function unwrap(result: ConvertResult): {
	output: string;
	rowCount: number;
} {
	if (!result.ok) throw new ConversionError(result.error);
	if (new TextEncoder().encode(result.output).byteLength > MAX_OUTPUT_BYTES) {
		throw new ConversionError(OUTPUT_LIMIT_MESSAGE);
	}
	return { output: result.output, rowCount: result.rowCount };
}

/** 想定外の例外（原文を含み得る内部メッセージ）をそのまま返さない */
function guarded<T>(run: () => T): T {
	try {
		return run();
	} catch (error) {
		if (error instanceof ConversionError) throw error;
		throw new Error(UNEXPECTED_MESSAGE);
	}
}

interface JsonToCsvInput {
	text: string;
	delimiter: 'comma' | 'tab' | 'semicolon';
	includeHeader: boolean;
	flattenNested: boolean;
	newline: 'crlf' | 'lf';
}

interface CsvToJsonInput {
	text: string;
	delimiter: 'auto' | 'comma' | 'tab' | 'semicolon';
	hasHeader: boolean;
	inferTypes: boolean;
	unflattenDotKeys: boolean;
}

interface ConvertOutput {
	output: string;
	rowCount: number;
}

export const jsonToCsvMcpTool = defineMcpTool<JsonToCsvInput, ConvertOutput>({
	toolId: 'json-csv',
	name: 'json_to_csv',
	description:
		'Convert a JSON array of objects (or one object) to CSV locally without changing the page UI. Input up to 100000 characters, nesting up to 50 levels, output up to 1 MiB (UTF-8); over-limit requests are rejected, never truncated. / JSON（オブジェクトの配列または単一オブジェクト）をブラウザ内でCSVへ変換する。画面の入力・結果は変更しない。入力上限100000文字、ネスト50段、出力UTF-8で1MiB。上限超過は省略せず拒否する。',
	params: {
		text: {
			type: 'string',
			maxLength: MAX_INPUT_CHARACTERS,
			description: '変換するJSON。上限100000文字。',
		},
		delimiter: {
			type: 'string',
			enum: ['comma', 'tab', 'semicolon'],
			required: false,
			default: 'comma',
			description: 'CSVの区切り文字',
		},
		includeHeader: {
			type: 'boolean',
			required: false,
			default: true,
			description: 'ヘッダー行を出力する',
		},
		flattenNested: {
			type: 'boolean',
			required: false,
			default: false,
			description:
				'ネストをドット記法（user.name、items.0）に展開する。falseではJSON文字列セルにする',
		},
		newline: {
			type: 'string',
			enum: ['crlf', 'lf'],
			required: false,
			default: 'crlf',
			description: '改行コード',
		},
	},
	returns: {
		output: { type: 'string', description: '変換後のCSV' },
		rowCount: { type: 'number', description: '変換したデータ行数' },
	},
	annotations: { readOnlyHint: true, untrustedContentHint: true },
	handler(input) {
		return guarded(() => {
			if (exceedsMaxCharacters(input.text, MAX_INPUT_CHARACTERS)) {
				throw new ConversionError(INPUT_LIMIT_MESSAGE);
			}
			if (exceedsJsonDepth(input.text, MAX_NESTING_DEPTH)) {
				throw new ConversionError(DEPTH_LIMIT_MESSAGE);
			}
			assertJsonToCsvWithinOutputLimit(input.text, input.flattenNested);
			return unwrap(
				jsonToCsv(input.text, {
					delimiter: DELIMITERS[input.delimiter],
					includeHeader: input.includeHeader,
					flattenNested: input.flattenNested,
					newline: input.newline === 'lf' ? '\n' : '\r\n',
				}),
			);
		});
	},
});

export const csvToJsonMcpTool = defineMcpTool<CsvToJsonInput, ConvertOutput>({
	toolId: 'json-csv',
	name: 'csv_to_json',
	description:
		'Convert CSV to a JSON array of objects locally without changing the page UI. Values stay strings (leading zeros preserved) unless inferTypes is true. Input up to 100000 characters, dot-key nesting up to 50 levels, output up to 1 MiB (UTF-8); over-limit requests are rejected, never truncated. / CSVをブラウザ内でJSON配列へ変換する。画面の入力・結果は変更しない。既定では全て文字列のまま保持し先頭ゼロも維持する。入力上限100000文字、ドット記法のネスト50段、出力UTF-8で1MiB。上限超過は省略せず拒否する。',
	params: {
		text: {
			type: 'string',
			maxLength: MAX_INPUT_CHARACTERS,
			description: '変換するCSV。上限100000文字。',
		},
		delimiter: {
			type: 'string',
			enum: ['auto', 'comma', 'tab', 'semicolon'],
			required: false,
			default: 'auto',
			description: '区切り文字。autoは1行目から判定する',
		},
		hasHeader: {
			type: 'boolean',
			required: false,
			default: true,
			description: '1行目をヘッダーとして扱う。falseでは column_1 から採番する',
		},
		inferTypes: {
			type: 'boolean',
			required: false,
			default: false,
			description:
				'数値・true/false・空セル(null)を推論する。安全整数外や先頭ゼロの数値は文字列のまま',
		},
		unflattenDotKeys: {
			type: 'boolean',
			required: false,
			default: false,
			description:
				'ドット記法のヘッダー（user.name、items.0）をネストへ復元する。深さ50段まで。巨大な配列インデックスなど展開結果が出力上限を超える場合は拒否',
		},
	},
	returns: {
		output: { type: 'string', description: '変換後のJSON（インデント2）' },
		rowCount: { type: 'number', description: '変換したデータ行数' },
	},
	annotations: { readOnlyHint: true, untrustedContentHint: true },
	handler(input) {
		return guarded(() => {
			if (exceedsMaxCharacters(input.text, MAX_INPUT_CHARACTERS)) {
				throw new ConversionError(INPUT_LIMIT_MESSAGE);
			}
			const options = {
				delimiter:
					input.delimiter === 'auto' ? 'auto' : DELIMITERS[input.delimiter],
				hasHeader: input.hasHeader,
				inferTypes: input.inferTypes,
			} as const;
			assertCsvWithinBudget(input.text, {
				delimiter: options.delimiter,
				hasHeader: input.hasHeader,
				unflattenDotKeys: input.unflattenDotKeys,
			});
			return unwrap(
				csvToJson(input.text, {
					...options,
					unflattenDotKeys: input.unflattenDotKeys,
				}),
			);
		});
	},
});
