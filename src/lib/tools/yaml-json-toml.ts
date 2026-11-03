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
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	// smol-toml 1.9 以降はパース結果が null プロトタイプのオブジェクトになる
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
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

const YAML_INT_TOKEN =
	/(?<![\w.])[-+]?(?:0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|\d[\d_]*)(?![\w.])/g;

function yamlIntTokenToBigInt(token: string): bigint | null {
	const negative = token.startsWith('-');
	const body = token.replace(/^[-+]/, '').replace(/_/g, '');
	try {
		const value = BigInt(body);
		return negative ? -value : value;
	} catch {
		return null;
	}
}

/**
 * 引用符で囲んだ文字列とコメントを空白に置き換える（数値の字句を探す前処理）。
 * 引用符は行頭・空白・[ { , の直後だけを開始とみなし、it's のような通常の文字列内の
 * アポストロフィは対象にしない。
 */
function stripYamlStringsAndComments(text: string): string {
	let out = '';
	let i = 0;
	const n = text.length;
	while (i < n) {
		const ch = text[i];
		const prev = i === 0 ? undefined : text[i - 1];
		const atBoundary = prev === undefined || /[\s[{,]/.test(prev);
		if (ch === '#' && (prev === undefined || /\s/.test(prev))) {
			let j = i;
			while (j < n && text[j] !== '\n' && text[j] !== '\r') j++;
			out += ' '.repeat(j - i);
			i = j;
			continue;
		}
		if ((ch === '"' || ch === "'") && atBoundary) {
			let j = i + 1;
			while (j < n) {
				if (ch === '"' && text[j] === '\\') {
					j += 2;
					continue;
				}
				if (text[j] === ch) {
					if (ch === "'" && text[j + 1] === "'") {
						j += 2;
						continue;
					}
					j++;
					break;
				}
				j++;
			}
			j = Math.min(j, n);
			out += ' '.repeat(j - i);
			i = j;
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}

/**
 * YAMLの整数リテラルのうち、JavaScriptの数値に変換した時点で値が変わったもの（安全整数の範囲外で
 * 丸められたもの）のパスを返す。浮動小数点の表記（1.0e+20 など）や、丸めの起きない値は対象外。
 */
export function findLossyYamlIntegerPaths(
	value: unknown,
	text: string,
	limit = 5,
): string[] {
	const rounded = new Map<number, boolean>();
	for (const match of stripYamlStringsAndComments(text).matchAll(
		YAML_INT_TOKEN,
	)) {
		const exact = yamlIntTokenToBigInt(match[0]);
		if (exact === null) continue;
		const num = Number(exact);
		if (Number.isSafeInteger(num)) continue;
		// 桁数が多すぎて Infinity になった値も、丸められた値として扱う
		if (!Number.isFinite(num) || BigInt(num) !== exact) rounded.set(num, true);
	}
	if (rounded.size === 0) return [];

	const paths: string[] = [];
	const seen = new Set<unknown>();
	const stack: { node: unknown; path: string }[] = [{ node: value, path: '' }];
	while (stack.length > 0 && paths.length < limit) {
		const { node, path } = stack.pop() as { node: unknown; path: string };
		if (typeof node === 'number') {
			if (rounded.has(node)) paths.push(path || '(ルート)');
			continue;
		}
		if (node === null || typeof node !== 'object' || seen.has(node)) continue;
		seen.add(node);
		if (Array.isArray(node)) {
			for (let i = node.length - 1; i >= 0; i--)
				stack.push({ node: node[i], path: `${path}[${i}]` });
		} else if (isPlainObject(node)) {
			const entries = Object.entries(node);
			for (let i = entries.length - 1; i >= 0; i--) {
				const [key, child] = entries[i];
				stack.push({ node: child, path: path ? `${path}.${key}` : key });
			}
		}
	}
	return paths;
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
						// safeModeではエイリアス禁止、通常UIでもAlias Bombを防ぐため100個・深さ100段で制限する
						safeMode
							? { maxAliases: 0, maxDepth: 52 }
							: { maxAliases: 100, maxDepth: 100 },
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

/** 展開後のグラフをシリアライズ前に制限し、巨大出力や再帰・エイリアス爆弾を防ぐ。 */
function checkSafeStructure(value: unknown, safeMode = false): string | null {
	if (safeMode) {
		const stack: { value: unknown; depth: number; pathUnits: number }[] = [
			{ value, depth: 0, pathUnits: 0 },
		];
		const seen = new WeakSet<object>();
		// ルート容器は要素に含めず、配列の10000要素をそのまま受理する。
		let nodes = -1;
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

	// 通常UIモード: 共有参照（合法なエイリアス）は許容しつつ、循環参照およびAlias Bomb（延べノード数爆発）を防御する
	const maxNodes = 100_000;
	const maxDepth = 100;
	const maxBytes = 16 * 1024 * 1024;
	const maxStringUnits = 5_000_000;

	type StackItem = {
		value: unknown;
		depth: number;
		pathUnits: number;
		ancestors: Set<object>;
	};
	const stack: StackItem[] = [
		{ value, depth: 0, pathUnits: 0, ancestors: new Set() },
	];
	let nodes = -1;
	let stringUnits = 0;
	let estimatedBytes = 0;

	while (stack.length) {
		const current = stack.pop();
		if (!current) break;
		if (++nodes > maxNodes) return '安全上限（100,000要素）を超えています。';
		if (current.depth > maxDepth)
			return '安全上限（ネスト100段）を超えています。';
		estimatedBytes += 64 + current.pathUnits * 6 + (current.depth + 2) * 8;
		if (typeof current.value === 'string') {
			stringUnits += current.value.length;
			estimatedBytes += current.value.length * 6;
			for (const character of current.value) {
				if (character === '\n') estimatedBytes += (current.depth + 2) * 4;
			}
		}
		if (current.value !== null && typeof current.value === 'object') {
			if (current.ancestors.has(current.value)) {
				return '循環参照には対応していません。';
			}
			const nextAncestors = new Set(current.ancestors);
			nextAncestors.add(current.value);

			const entries = Object.entries(current.value);
			if (nodes + stack.length + entries.length > maxNodes)
				return '安全上限（100,000要素）を超えています。';
			for (const [key, child] of entries) {
				stringUnits += key.length;
				stack.push({
					value: child,
					depth: current.depth + 1,
					pathUnits: current.pathUnits + key.length + 2,
					ancestors: nextAncestors,
				});
			}
		}
		if (estimatedBytes > maxBytes)
			return '出力見積もりが安全上限を超えています。';
		if (stringUnits > maxStringUnits)
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

	const error = checkSafeStructure(parsed.value, Boolean(options.safeMode));
	if (error) return { ok: false, error };

	if (from === 'yaml') {
		const lossy = findLossyYamlIntegerPaths(parsed.value, text);
		if (lossy.length > 0) {
			return {
				ok: false,
				error: `JavaScriptで正確に扱える範囲（±9007199254740991）を超える整数があり、変換すると値が変わるため変換を中止しました: ${lossy.join(', ')}。値を引用符で囲んで文字列にしてください。`,
			};
		}
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
