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
// 超える整数は JSON.parse で精度が失われるため、専用パーサーで値の構築と
// 桁保持を同時に行う（json-csv.ts の parseJsonPreservingIntegers と同じ
// 方式）。文字列プレースホルダーへの置換・復元は、ユーザー入力の文字列値・
// キーが偶然プレースホルダーと同じテキストになった場合に誤って数値化・
// 引用符除去される内部マーカー衝突を構造的に避けられないため、採用しない。
// パース・シリアライズとも再帰呼び出しではなく明示的なスタックで処理し、
// ネスト段数がコールスタックの深さに影響しない（Codexレビュー指摘対応）。
// ============================================================

/** Number.MAX_SAFE_INTEGER を超える整数リテラルの桁を保持するためのラッパー */
class BigIntLiteral {
	readonly digits: string;
	constructor(digits: string) {
		this.digits = digits;
	}
}

/**
 * ネスト段数の上限。既存の回帰テスト（5000段）を許容しつつ、
 * 数千段超の入力が整形時にインデントで二乗オーダーに膨張するのを防ぐ。
 */
const MAX_NESTING_DEPTH = 5000;
/** 整形後の推定出力文字数の上限（2Mi文字）。文字列を組み立てる前に失敗させる */
const MAX_PROJECTED_OUTPUT_LENGTH = 2 * 1024 * 1024;

/** 構文エラーではなく、安全上限（ネスト深さ・出力サイズ）超過を表すエラー */
class JsonLimitError extends Error {}

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
 * parseJsonPreservingIntegers内部の「構築中のコンテナ」1個を表す。
 * 再帰呼び出しの代わりにこれをスタックへ積むことで、ネストが深い入力でも
 * コールスタックを消費しない（V8のスタック上限での Maximum call stack size
 * exceeded を回避する）。
 */
type ParseFrame =
	| {
			kind: 'object';
			obj: Record<string, unknown>;
			// '{' 直後 or ',' 直後でまだ次のキーを読んでいない状態か
			awaitingKey: boolean;
			// ','の直後（空オブジェクトを許さない）かどうか
			afterComma: boolean;
			// コンテナ値を読んでいる間、attach先のキーを保持する
			pendingKey: string | null;
	  }
	| {
			kind: 'array';
			arr: unknown[];
			awaitingValue: boolean;
			afterComma: boolean;
	  };

/** readScalarOrOpen の戻り値。コンテナ開始とスカラー値を1つの判別可能な型で表す。 */
type ReadResult =
	| { kind: 'open'; container: 'object' | 'array' }
	| { kind: 'scalar'; value: unknown };

/**
 * JSON.parse 相当のパーサー。安全整数範囲外の整数リテラルは Number ではなく
 * BigIntLiteral として桁を保持する（小数・指数表記は従来どおり Number化）。
 * プレースホルダー文字列を経由しないため、エラー位置も常に元入力基準になる。
 * ネストしたオブジェクト・配列は再帰呼び出しではなく明示的なスタック
 * （ParseFrame[]）で処理するため、ネスト段数がコールスタックの深さに
 * 影響しない（任意の深さのネストを安全に処理できる）。
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

	/** スカラー値、またはコンテナ開始('{'/'[')を読む。コンテナの中身は読まない。 */
	const readScalarOrOpen = (): ReadResult => {
		skipWhitespace();
		if (i >= len) fail('Unexpected end of JSON input');
		const ch = text[i];
		if (ch === '{') {
			i++;
			return { kind: 'open', container: 'object' };
		}
		if (ch === '[') {
			i++;
			return { kind: 'open', container: 'array' };
		}
		if (ch === '"') return { kind: 'scalar', value: parseString() };
		if (ch === '-' || (ch >= '0' && ch <= '9'))
			return { kind: 'scalar', value: parseNumber() };
		if (ch === 't' || ch === 'f' || ch === 'n') {
			const literal = ch === 't' ? 'true' : ch === 'f' ? 'false' : 'null';
			for (const expected of literal) {
				if (i >= len) fail('Unexpected end of JSON input');
				if (text[i] !== expected) fail('Unexpected token in JSON');
				i++;
			}
			return {
				kind: 'scalar',
				value: ch === 't' ? true : ch === 'f' ? false : null,
			};
		}
		return fail('Unexpected token in JSON');
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

	// 構築中のコンテナをスタックで管理し、ネストしたオブジェクト・配列を
	// 再帰呼び出しなしで処理する。
	const stack: ParseFrame[] = [];
	let result: unknown;
	let done = false;

	/** コンテナが閉じたときに、親フレーム（スタックが空ならトップレベル結果）へ値を渡す */
	const attachContainer = (container: unknown): void => {
		if (stack.length === 0) {
			result = container;
			done = true;
			return;
		}
		const parent = stack[stack.length - 1];
		if (parent.kind === 'array') {
			parent.arr.push(container);
		} else {
			setOwnValue(parent.obj, parent.pendingKey as string, container);
			parent.pendingKey = null;
		}
	};

	{
		const first = readScalarOrOpen();
		if (first.kind === 'open' && first.container === 'object') {
			stack.push({
				obj: {},
				kind: 'object',
				awaitingKey: true,
				afterComma: false,
				pendingKey: null,
			});
		} else if (first.kind === 'open') {
			stack.push({
				arr: [],
				kind: 'array',
				awaitingValue: true,
				afterComma: false,
			});
		} else {
			result = first.value;
			done = true;
		}
	}

	while (!done) {
		if (stack.length > MAX_NESTING_DEPTH) {
			throw new JsonLimitError(
				`JSONのネストが深すぎます（上限${MAX_NESTING_DEPTH}段）`,
			);
		}
		const frame = stack[stack.length - 1];
		skipWhitespace();
		if (frame.kind === 'object') {
			if (frame.awaitingKey) {
				if (!frame.afterComma && text[i] === '}') {
					i++;
					stack.pop();
					attachContainer(frame.obj);
					continue;
				}
				if (text[i] !== '"') fail('Expected property name in JSON');
				const key = parseString();
				skipWhitespace();
				if (text[i] !== ':') fail("Expected ':' after property name in JSON");
				i++;
				const v = readScalarOrOpen();
				frame.awaitingKey = false;
				if (v.kind === 'open' && v.container === 'object') {
					frame.pendingKey = key;
					stack.push({
						obj: {},
						kind: 'object',
						awaitingKey: true,
						afterComma: false,
						pendingKey: null,
					});
				} else if (v.kind === 'open') {
					frame.pendingKey = key;
					stack.push({
						arr: [],
						kind: 'array',
						awaitingValue: true,
						afterComma: false,
					});
				} else {
					setOwnValue(frame.obj, key, v.value);
				}
				continue;
			}
			// 値を読み終えた直後: ',' または '}' を期待する
			if (text[i] === ',') {
				i++;
				frame.awaitingKey = true;
				frame.afterComma = true;
				continue;
			}
			if (text[i] === '}') {
				i++;
				stack.pop();
				attachContainer(frame.obj);
				continue;
			}
			fail("Expected ',' or '}' in JSON object");
		} else {
			// array
			if (frame.awaitingValue) {
				if (!frame.afterComma && text[i] === ']') {
					i++;
					stack.pop();
					attachContainer(frame.arr);
					continue;
				}
				const v = readScalarOrOpen();
				frame.awaitingValue = false;
				if (v.kind === 'open' && v.container === 'object') {
					stack.push({
						obj: {},
						kind: 'object',
						awaitingKey: true,
						afterComma: false,
						pendingKey: null,
					});
				} else if (v.kind === 'open') {
					stack.push({
						arr: [],
						kind: 'array',
						awaitingValue: true,
						afterComma: false,
					});
				} else {
					frame.arr.push(v.value);
				}
				continue;
			}
			if (text[i] === ',') {
				i++;
				frame.awaitingValue = true;
				frame.afterComma = true;
				continue;
			}
			if (text[i] === ']') {
				i++;
				stack.pop();
				attachContainer(frame.arr);
				continue;
			}
			fail("Expected ',' or ']' in JSON array");
		}
	}

	skipWhitespace();
	if (i < len) fail('Unexpected non-whitespace character after JSON value');
	return result;
}

/**
 * 整形後の出力文字数を、文字列を1文字も組み立てる前に反復走査で見積もり、
 * 上限を超えるなら JsonLimitError を投げる。スカラー・キー・区切り・インデントの
 * 全てを含み、超過した時点で走査を打ち切る（巨大スカラーでも迂回できない）。
 */
function assertProjectedOutputWithinLimit(
	root: unknown,
	indentLength: number,
): void {
	const tooLarge = (): never => {
		throw new JsonLimitError(
			'整形後の出力が大きすぎます。ネストを浅くするか、インデントを小さくするか、圧縮を使用してください',
		);
	};
	let total = 0;
	const add = (n: number): void => {
		total += n;
		if (total > MAX_PROJECTED_OUTPUT_LENGTH) tooLarge();
	};
	/** JSON.stringify(s).length を一時文字列を作らずに数える（引用符込み） */
	const stringLength = (s: string): number => {
		let n = 2;
		for (let i = 0; i < s.length; i++) {
			const c = s.charCodeAt(i);
			if (c === 0x22 || c === 0x5c) {
				n += 2;
			} else if (c < 0x20) {
				// \b \t \n \f \r は2文字、それ以外の制御文字は \u00XX の6文字
				n += c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6;
			} else if (c >= 0xd800 && c <= 0xdbff) {
				const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
				if (next >= 0xdc00 && next <= 0xdfff) {
					n += 2; // 正しいサロゲートペアはそのまま出力される
					i++;
				} else {
					n += 6; // 孤立した上位サロゲートは \udXXX
				}
			} else if (c >= 0xdc00 && c <= 0xdfff) {
				n += 6; // 孤立した下位サロゲート
			} else {
				n += 1;
			}
			// 巨大文字列でも走査中に打ち切る
			if (total + n > MAX_PROJECTED_OUTPUT_LENGTH) tooLarge();
		}
		return n;
	};

	const work: [unknown, number][] = [[root, 0]];
	while (work.length > 0) {
		const [val, depth] = work.pop() as [unknown, number];
		if (val instanceof BigIntLiteral) {
			add(val.digits.length);
		} else if (typeof val === 'string') {
			add(stringLength(val));
		} else if (typeof val === 'number') {
			add(JSON.stringify(val).length);
		} else if (val === null || typeof val === 'boolean') {
			add(val === false ? 5 : 4);
		} else if (typeof val === 'object') {
			const isArr = Array.isArray(val);
			const keys = isArr ? null : Object.keys(val);
			const n = isArr ? val.length : (keys as string[]).length;
			if (n === 0) {
				add(2);
				continue;
			}
			if (indentLength) {
				// "[\n" + 各要素のインデント + 要素間",\n" + "\n" + 閉じインデント + "]"
				add(
					4 +
						2 * (n - 1) +
						n * indentLength * (depth + 1) +
						indentLength * depth,
				);
			} else {
				add(2 + (n - 1)); // 括弧 + カンマ
			}
			if (keys) {
				for (const k of keys) {
					add(stringLength(k) + (indentLength ? 2 : 1)); // ": " / ":"
					work.push([(val as Record<string, unknown>)[k], depth + 1]);
				}
			} else {
				for (const item of val as unknown[]) work.push([item, depth + 1]);
			}
		}
	}
}

/**
 * stringifyPreservingIntegers内部の「レンダリング中のコンテナ」1個を表す。
 * 再帰呼び出しの代わりにこれをスタックへ積むことで、parseJsonPreservingIntegers
 * と同様に深いネストでもコールスタックを消費しない。
 */
type RenderFrame =
	| { kind: 'array'; items: unknown[]; index: number; parts: string[] }
	| {
			kind: 'object';
			entries: [string, unknown][];
			index: number;
			parts: string[];
			pendingPrefix: string | null;
	  };

/**
 * JSON.stringify 相当だが、BigIntLiteral を桁文字列のまま（未クォートの数値として）
 * 出力する。indentUnit が空文字列ならminify、非空なら1階層ごとに付加して整形する。
 * ネストしたオブジェクト・配列は再帰呼び出しではなく明示的なスタック
 * （RenderFrame[]）で処理するため、任意の深さのネストを安全に処理できる。
 */
function stringifyPreservingIntegers(
	value: unknown,
	indentUnit: string,
): string {
	const renderScalar = (val: unknown): string => {
		if (val instanceof BigIntLiteral) return val.digits;
		return JSON.stringify(val);
	};

	const isContainer = (
		val: unknown,
	): val is unknown[] | Record<string, unknown> =>
		Array.isArray(val) ||
		(val !== null &&
			typeof val === 'object' &&
			!(val instanceof BigIntLiteral));

	const pushFrame = (
		stack: RenderFrame[],
		val: unknown[] | Record<string, unknown>,
	): void => {
		if (Array.isArray(val)) {
			stack.push({ kind: 'array', items: val, index: 0, parts: [] });
		} else {
			stack.push({
				kind: 'object',
				entries: Object.entries(val),
				index: 0,
				parts: [],
				pendingPrefix: null,
			});
		}
	};

	assertProjectedOutputWithinLimit(value, indentUnit.length);

	const closeFrame = (frame: RenderFrame, depth: number): string => {
		if (frame.parts.length === 0) return frame.kind === 'array' ? '[]' : '{}';
		if (!indentUnit) {
			return frame.kind === 'array'
				? `[${frame.parts.join(',')}]`
				: `{${frame.parts.join(',')}}`;
		}
		const pad = indentUnit.repeat(depth + 1);
		const closePad = indentUnit.repeat(depth);
		const body = frame.parts.map((s) => pad + s).join(',\n');
		return frame.kind === 'array'
			? `[\n${body}\n${closePad}]`
			: `{\n${body}\n${closePad}}`;
	};

	if (!isContainer(value)) return renderScalar(value);

	const stack: RenderFrame[] = [];
	pushFrame(stack, value);
	let finalResult = '';

	while (stack.length > 0) {
		const frame = stack[stack.length - 1];
		if (frame.kind === 'array') {
			if (frame.index >= frame.items.length) {
				const rendered = closeFrame(frame, stack.length - 1);
				stack.pop();
				if (stack.length === 0) {
					finalResult = rendered;
				} else {
					const parent = stack[stack.length - 1];
					if (parent.kind === 'object' && parent.pendingPrefix !== null) {
						parent.parts.push(parent.pendingPrefix + rendered);
						parent.pendingPrefix = null;
					} else {
						parent.parts.push(rendered);
					}
				}
				continue;
			}
			const item = frame.items[frame.index++];
			if (isContainer(item)) {
				pushFrame(stack, item);
			} else {
				frame.parts.push(renderScalar(item));
			}
			continue;
		}
		// object
		if (frame.index >= frame.entries.length) {
			const rendered = closeFrame(frame, stack.length - 1);
			stack.pop();
			if (stack.length === 0) {
				finalResult = rendered;
			} else {
				const parent = stack[stack.length - 1];
				if (parent.kind === 'object' && parent.pendingPrefix !== null) {
					parent.parts.push(parent.pendingPrefix + rendered);
					parent.pendingPrefix = null;
				} else {
					parent.parts.push(rendered);
				}
			}
			continue;
		}
		const [key, v] = frame.entries[frame.index++];
		const keyPrefix = `${JSON.stringify(key)}${indentUnit ? ': ' : ':'}`;
		if (isContainer(v)) {
			frame.pendingPrefix = keyPrefix;
			pushFrame(stack, v);
		} else {
			frame.parts.push(`${keyPrefix}${renderScalar(v)}`);
		}
	}
	return finalResult;
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
		if (e instanceof JsonLimitError) {
			return { success: false, output: input, error: e.message };
		}
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
		if (e instanceof JsonLimitError) {
			return { success: false, output: input, error: e.message };
		}
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
