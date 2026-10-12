import * as yaml from 'js-yaml';
import {
	parse as parseToml,
	stringify as stringifyToml,
	TomlError,
} from 'smol-toml';

export type Format = 'yaml' | 'json' | 'toml';
export type Indent = 2 | 4 | 0;

export interface ConvertOptions {
	indent: Indent;
	sortKeys: boolean;
	/** WebMCPで未信頼データを扱う場合の展開・出力制限。通常UIは既存挙動を維持。 */
	safeMode?: boolean;
}

export type ConvertResult =
	| { ok: true; output: string; note?: string }
	| { ok: false; error: string; row?: number; col?: number; raw?: string };

interface ParseError {
	error: string;
	row?: number;
	col?: number;
	raw?: string;
}

export const FORMAT_LABEL: Record<Format, string> = {
	yaml: 'YAML',
	json: 'JSON',
	toml: 'TOML',
};

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

/** オブジェクトキーを辞書順に再帰ソートする。配列要素の順序は維持する */
export function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeysDeep);
	if (isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			Object.defineProperty(out, key, {
				value: sortKeysDeep(value[key]),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return out;
	}
	return value;
}

/**
 * TOML由来の日時値（TomlDate、Dateのサブクラス）をISO文字列へ変換する。
 * JSON.stringifyの暗黙のtoJSON呼び出しに頼らず、YAML出力でも一貫して文字列化するために事前に変換する。
 */
function normalizeTomlDates(value: unknown): unknown {
	if (value instanceof Date) return value.toJSON();
	if (Array.isArray(value)) return value.map(normalizeTomlDates);
	if (isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value)) {
			Object.defineProperty(out, key, {
				value: normalizeTomlDates(child),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return out;
	}
	return value;
}

/** null値のパスを列挙する（例: settings.apiKey, items[2].name）。ルート自体がnullなら "(ルート)" */
function findNullPaths(value: unknown, prefix = ''): string[] {
	if (value === null) return [prefix || '(ルート)'];
	if (Array.isArray(value)) {
		return value.flatMap((item, index) =>
			findNullPaths(item, `${prefix}[${index}]`),
		);
	}
	if (isPlainObject(value)) {
		return Object.entries(value).flatMap(([key, child]) =>
			findNullPaths(child, prefix ? `${prefix}.${key}` : key),
		);
	}
	return [];
}

// ---------------------------------------------------------------------------
// エラーマッピング
// ---------------------------------------------------------------------------

function mapYamlError(err: unknown): ParseError {
	const raw = err instanceof Error ? err.message : String(err);
	if (raw.includes('expected a single document in the stream')) {
		return {
			error:
				'複数のYAMLドキュメント（--- 区切り）には対応していません。単一ドキュメントのみ入力してください。',
			raw,
		};
	}
	const mark = err instanceof yaml.YAMLException ? err.mark : undefined;
	if (raw.includes('duplicated mapping key')) {
		return {
			error:
				'同じキーが複数回定義されています。重複するキーを解消してください。',
			row: mark ? mark.line + 1 : undefined,
			col: mark ? mark.column + 1 : undefined,
			raw,
		};
	}
	return {
		error: 'YAMLの構文エラーです。',
		row: mark ? mark.line + 1 : undefined,
		col: mark ? mark.column + 1 : undefined,
		raw,
	};
}

function mapTomlError(err: unknown): ParseError {
	const raw = err instanceof Error ? err.message : String(err);
	if (err instanceof TomlError) {
		return {
			error: 'TOMLの構文エラーです。',
			row: err.line,
			col: err.column,
			raw,
		};
	}
	return { error: 'TOMLの構文エラーです。', raw };
}

function mapJsonError(text: string, err: unknown): ParseError {
	const raw = err instanceof Error ? err.message : String(err);
	const lineColMatch = raw.match(/\(line (\d+) column (\d+)\)/);
	if (lineColMatch) {
		return {
			error: 'JSONの構文エラーです。',
			row: Number(lineColMatch[1]),
			col: Number(lineColMatch[2]),
			raw,
		};
	}
	const posMatch = raw.match(/position (\d+)/);
	if (posMatch) {
		const pos = Number(posMatch[1]);
		const before = text.slice(0, pos);
		const lastNewline = before.lastIndexOf('\n');
		return {
			error: 'JSONの構文エラーです。',
			row: before.split('\n').length,
			col: pos - lastNewline,
			raw,
		};
	}
	return { error: 'JSONの構文エラーです。', raw };
}

/** パース例外を日本語メッセージ＋行・列（取得できる場合）へ正規化する */
export function mapParseError(
	format: Format,
	err: unknown,
	text: string,
): ParseError {
	if (format === 'yaml') return mapYamlError(err);
	if (format === 'toml') return mapTomlError(err);
	return mapJsonError(text, err);
}

// ---------------------------------------------------------------------------
// パース
// ---------------------------------------------------------------------------

type ParseValueResult =
	| { ok: true; value: unknown }
	| ({ ok: false } & ParseError);

function parseValue(
	format: Format,
	text: string,
	safeMode = false,
): ParseValueResult {
	if (!text.trim()) {
		return { ok: false, error: `${FORMAT_LABEL[format]}を入力してください。` };
	}
	try {
		if (format === 'json') {
			return { ok: true, value: JSON.parse(text) };
		}
		if (format === 'yaml') {
			return {
				ok: true,
				value:
					yaml.load(
						text,
						safeMode ? { maxAliases: 0, maxDepth: 50 } : undefined,
					) ?? null,
			};
		}
		return { ok: true, value: normalizeTomlDates(parseToml(text)) };
	} catch (err) {
		return { ok: false, ...mapParseError(format, err, text) };
	}
}

// ---------------------------------------------------------------------------
// シリアライズ
// ---------------------------------------------------------------------------

type SerializeValueResult =
	| { ok: true; output: string; note?: string }
	| { ok: false; error: string };

function serializeValue(
	format: Format,
	value: unknown,
	options: ConvertOptions,
): SerializeValueResult {
	if (format === 'json') {
		return {
			ok: true,
			output:
				options.indent === 0
					? JSON.stringify(value)
					: JSON.stringify(value, null, options.indent),
		};
	}
	if (format === 'yaml') {
		const output =
			options.indent === 0
				? yaml.dump(value, { flowLevel: 0, lineWidth: -1, noRefs: true })
				: yaml.dump(value, {
						indent: options.indent,
						lineWidth: -1,
						noRefs: true,
					});
		return { ok: true, output };
	}

	// toml
	if (Array.isArray(value)) {
		return {
			ok: false,
			error:
				'TOMLの出力にはルート要素にオブジェクト（テーブル）が必要です。配列を直接ルートに変換することはできません。',
		};
	}
	if (!isPlainObject(value)) {
		return {
			ok: false,
			error:
				'TOMLの出力にはオブジェクト（テーブル）が必要です。文字列・数値などの単一値は変換できません。',
		};
	}
	const nullPaths = findNullPaths(value);
	if (nullPaths.length > 0) {
		return {
			ok: false,
			error: `TOMLはnull値に対応していません。次のキーにnullが含まれています: ${nullPaths.join(', ')}`,
		};
	}
	try {
		const output = stringifyToml(value);
		const note =
			options.indent === 0
				? 'TOMLはコンパクト表示（1行化）に対応していないため、通常のインデント幅で出力しました。'
				: undefined;
		return { ok: true, output, note };
	} catch (err) {
		return {
			ok: false,
			error: `TOMLへの変換に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

// ---------------------------------------------------------------------------
// 変換エントリポイント
// ---------------------------------------------------------------------------

/** 展開後のグラフをシリアライズ前に制限し、巨大出力や再帰を防ぐ。 */
function checkSafeStructure(value: unknown): string | null {
	const stack: { value: unknown; depth: number; pathUnits: number }[] = [
		{ value, depth: 0, pathUnits: 0 },
	];
	const seen = new WeakSet<object>();
	let nodes = 0;
	let stringUnits = 0;
	let estimatedBytes = 0;
	while (stack.length) {
		const current = stack.pop();
		if (!current) break;
		if (++nodes > 10_000) return '安全上限（10000要素）を超えています。';
		if (current.depth > 50) return '安全上限（ネスト50段）を超えています。';
		estimatedBytes += 64 + current.pathUnits * 6 + (current.depth + 2) * 8;
		if (typeof current.value === 'string') {
			stringUnits += current.value.length;
			estimatedBytes += current.value.length * 6;
			// YAMLのブロック文字列は各改行にネスト分のインデントを追加する。
			for (const character of current.value) {
				if (character === '\n') estimatedBytes += (current.depth + 2) * 4;
			}
		}
		if (current.value !== null && typeof current.value === 'object') {
			if (seen.has(current.value))
				return '循環または共有参照には対応していません。';
			seen.add(current.value);
			const entries = Object.entries(current.value);
			if (nodes + stack.length + entries.length > 10_000)
				return '安全上限（10000要素）を超えています。';
			for (const [key, child] of entries) {
				stringUnits += key.length;
				stack.push({
					value: child,
					depth: current.depth + 1,
					pathUnits: current.pathUnits + key.length + 2,
				});
			}
		}
		if (estimatedBytes > 4 * 1024 * 1024)
			return '出力見積もりが安全上限（4MiB）を超えています。';
		if (stringUnits > 1_000_000)
			return '展開後の文字列が安全上限を超えています。';
	}
	return null;
}

/**
 * from形式のテキストをto形式へ変換する。from===toの場合は整形のみ（indent/キーソート適用）。
 * parse → （keySort） → serialize の3段。例外はすべて日本語メッセージへ正規化して返す。
 */
export function convertFormats(
	from: Format,
	to: Format,
	text: string,
	options: ConvertOptions,
): ConvertResult {
	const parsed = parseValue(from, text, options.safeMode);
	if (!parsed.ok) {
		return {
			ok: false,
			error: parsed.error,
			row: parsed.row,
			col: parsed.col,
			raw: parsed.raw,
		};
	}

	if (options.safeMode) {
		const error = checkSafeStructure(parsed.value);
		if (error) return { ok: false, error };
	}

	const value = options.sortKeys ? sortKeysDeep(parsed.value) : parsed.value;

	const serialized = serializeValue(to, value, options);
	if (!serialized.ok) {
		return { ok: false, error: serialized.error };
	}

	if (
		options.safeMode &&
		new TextEncoder().encode(serialized.output).byteLength > 4 * 1024 * 1024
	)
		return { ok: false, error: '出力の安全上限（4MiB）を超えています。' };
	return { ok: true, output: serialized.output, note: serialized.note };
}
