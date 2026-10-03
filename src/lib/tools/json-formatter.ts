// JSON整形ロジック（純粋関数）

export type IndentType = '2' | '4' | 'tab';

const VALID_INDENT_TYPES: readonly IndentType[] = ['2', '4', 'tab'];

export interface FormatResult {
	success: boolean;
	output: string;
	error?: string;
	errorPosition?: number;
}

export interface JsonFormatterSettings {
	indent: IndentType;
}

// 共有URL/localStorage経由の復元値を検証し、不正値はデフォルトへフォールバックする
export function sanitizeJsonFormatterSettings(
	value: unknown,
	defaults: JsonFormatterSettings,
): JsonFormatterSettings {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return defaults;
	}
	const v = value as Record<string, unknown>;
	const indent =
		typeof v.indent === 'string' &&
		(VALID_INDENT_TYPES as readonly string[]).includes(v.indent)
			? (v.indent as IndentType)
			: defaults.indent;
	return { indent };
}

// ============================================================
// 大整数精度保持: Number.MAX_SAFE_INTEGER (9007199254740991) を
// 超える整数は JSON.parse で精度が失われるため、専用の再帰下降パーサーで
// 値の構築と桁保持を同時に行う（json-csv.ts の parseJsonPreservingIntegers
// と同じ方式）。文字列プレースホルダーへの置換・復元は、ユーザー入力の
// 文字列値・キーが偶然プレースホルダーと同じテキストになった場合に誤って
// 数値化・引用符除去される内部マーカー衝突を構造的に避けられないため、
// 採用しない。
// ============================================================

/** Number.MAX_SAFE_INTEGER を超える整数リテラルの桁を保持するためのラッパー */
class BigIntLiteral {
	readonly digits: string;
	constructor(digits: string) {
		this.digits = digits;
	}
}

class JsonSyntaxError extends Error {
	readonly position: number;
	constructor(message: string, position: number) {
		super(`${message} at position ${position}`);
		this.position = position;
	}
}

/**
 * obj[key] = value ではなく own property として直接定義する。
 * key が "__proto__" の場合、ブラケット代入は Object.prototype の
 * アクセサ（setter）を呼び出してしまい、own property を作らずに
 * obj 自身のプロトタイプを書き換えてしまう（値が消える・意図しない継承が
 * 生じる）。Object.defineProperty は常に own property を作るため、
 * どのキー文字列でも安全に値を保持できる（json-csv.ts の setOwnValue と同じ方式）。
 */
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

/**
 * JSON.parse 相当の再帰下降パーサー。安全整数範囲外の整数リテラルは Number ではなく
 * BigIntLiteral として桁を保持する（小数・指数表記は従来どおり Number化）。
 * プレースホルダー文字列を経由しないため、エラー位置も常に元入力基準になる。
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
			setOwnValue(obj, key, parseValue());
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
				// エスケープ種別文字（バックスラッシュの次の文字）の位置。
				// 不正なエスケープはバックスラッシュの位置ではなく、この
				// 種別文字（または不正な16進文字）の位置で報告する。
				const escapeIndex = i + 1;
				const next = text[escapeIndex];
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
						const hexStart = escapeIndex + 1;
						const hex = text.slice(hexStart, hexStart + 4);
						if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
							let badOffset = 0;
							while (
								badOffset < hex.length &&
								/[0-9a-fA-F]/.test(hex[badOffset])
							) {
								badOffset++;
							}
							i = hexStart + badOffset;
							fail('Invalid unicode escape in JSON string');
						}
						result += String.fromCharCode(Number.parseInt(hex, 16));
						i += 6;
						continue;
					}
					default:
						i = escapeIndex;
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
 * JSON.stringify 相当だが、BigIntLiteral を桁文字列のまま（未クォートの数値として）
 * 出力する。indentUnit が空文字列ならminify、非空なら1階層ごとに付加して整形する。
 */
function stringifyPreservingIntegers(
	value: unknown,
	indentUnit: string,
): string {
	const render = (val: unknown, depth: number): string => {
		if (val instanceof BigIntLiteral) return val.digits;
		if (Array.isArray(val)) {
			if (val.length === 0) return '[]';
			const items = val.map((item) => render(item, depth + 1));
			if (!indentUnit) return `[${items.join(',')}]`;
			const pad = indentUnit.repeat(depth + 1);
			return `[\n${items.map((s) => pad + s).join(',\n')}\n${indentUnit.repeat(depth)}]`;
		}
		if (val !== null && typeof val === 'object') {
			const entries = Object.entries(val as Record<string, unknown>);
			if (entries.length === 0) return '{}';
			const items = entries.map(
				([key, v]) =>
					`${JSON.stringify(key)}${indentUnit ? ': ' : ':'}${render(v, depth + 1)}`,
			);
			if (!indentUnit) return `{${items.join(',')}}`;
			const pad = indentUnit.repeat(depth + 1);
			return `{\n${items.map((s) => pad + s).join(',\n')}\n${indentUnit.repeat(depth)}}`;
		}
		return JSON.stringify(val);
	};
	return render(value, 0);
}

function getIndentUnit(indent: IndentType): string {
	switch (indent) {
		case '2':
			return '  ';
		case '4':
			return '    ';
		case 'tab':
			return '\t';
	}
}

export function formatJson(
	input: string,
	indent: IndentType = '2',
): FormatResult {
	if (!input.trim()) {
		return { success: true, output: '' };
	}
	try {
		const parsed = parseJsonPreservingIntegers(input);
		const formatted = stringifyPreservingIntegers(
			parsed,
			getIndentUnit(indent),
		);
		return { success: true, output: formatted };
	} catch (e) {
		const error = e as JsonSyntaxError;
		return {
			success: false,
			output: input,
			error: `JSON構文エラー: ${error.message}`,
			errorPosition: error.position,
		};
	}
}

export function minifyJson(input: string): FormatResult {
	if (!input.trim()) {
		return { success: true, output: '' };
	}
	try {
		const parsed = parseJsonPreservingIntegers(input);
		const minified = stringifyPreservingIntegers(parsed, '');
		return { success: true, output: minified };
	} catch (e) {
		const error = e as Error;
		return {
			success: false,
			output: input,
			error: `JSON構文エラー: ${error.message}`,
		};
	}
}

/**
 * 整形済みJSON文字列をHTMLエスケープしつつ、文字列/キー/数値/真偽値/nullを
 * それぞれ色分けする <span> タグ付きのHTML文字列に変換する。
 * CodeBlock の htmlContent に渡すための表示専用ロジック。
 */
export function highlightJson(json: string): string {
	if (!json) return '';
	const jsonStr = json
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	return jsonStr.replace(
		/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
		(match) => {
			let cls = 'text-green-600 dark:text-green-400'; // number
			if (/^"/.test(match)) {
				if (/:$/.test(match)) {
					cls = 'text-blue-600 dark:text-blue-400 font-semibold'; // key
				} else {
					cls = 'text-amber-600 dark:text-amber-400'; // string
				}
			} else if (/true|false/.test(match)) {
				cls = 'text-purple-600 dark:text-purple-400'; // boolean
			} else if (/null/.test(match)) {
				cls = 'text-gray-500 dark:text-gray-400'; // null
			}
			return `<span class="${cls}">${match}</span>`;
		},
	);
}

export function validateJson(input: string): FormatResult {
	if (!input.trim()) {
		return { success: true, output: '有効なJSONです' };
	}
	try {
		// バリデーションは精度よりも構文チェックが目的のため通常のparseを使用
		JSON.parse(input);
		return { success: true, output: '有効なJSONです' };
	} catch (e) {
		const error = e as SyntaxError;
		return {
			success: false,
			output: '',
			error: error.message,
		};
	}
}
