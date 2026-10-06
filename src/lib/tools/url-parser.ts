// URLパラメータ解析・編集ロジック。DOM/React非依存の純粋関数。
// 入力URLへのアクセスは行わず、文字列の解析と再構築のみを行う。

export const MAX_URL_LENGTH = 100_000;
export const MAX_PARAMS = 1000;

export interface ParamRow {
	key: string;
	value: string;
	/** キーが不正なパーセント/UTF-8のためデコードできず、元の表記をそのまま保持している場合の原文 */
	rawKey?: string;
	/** 値が不正なパーセント/UTF-8のためデコードできず、元の表記をそのまま保持している場合の原文 */
	rawValue?: string;
}

export interface ParsedUrl {
	protocol: string;
	host: string;
	hostname: string;
	port: string;
	pathname: string;
	hash: string;
	hasCredentials: boolean;
	/** クエリを除いた再構築用のベースURL（パス・ハッシュを保持） */
	baseUrl: string;
	params: ParamRow[];
	warnings: string[];
}

export type ParseUrlResult =
	| { ok: true; value: ParsedUrl }
	| { ok: false; error: string };

type DecodeResult = { ok: true; text: string } | { ok: false };

/**
 * '+' を空白、%XX をUTF-8バイト列として一度だけデコードする。
 * 不正な%表記・不正なUTF-8は ok:false を返す（無言で置換しない）。
 */
export function decodeQueryComponent(raw: string): DecodeResult {
	const source = raw.replace(/\+/g, ' ');
	if (/%(?![0-9A-Fa-f]{2})/.test(source)) return { ok: false };
	const encoder = new TextEncoder();
	const bytes: number[] = [];
	let i = 0;
	while (i < source.length) {
		if (source[i] === '%') {
			bytes.push(Number.parseInt(source.slice(i + 1, i + 3), 16));
			i += 3;
			continue;
		}
		const str = String.fromCodePoint(source.codePointAt(i) as number);
		for (const b of encoder.encode(str)) bytes.push(b);
		i += str.length;
	}
	try {
		const text = new TextDecoder('utf-8', {
			fatal: true,
			ignoreBOM: true,
		}).decode(new Uint8Array(bytes));
		return { ok: true, text };
	} catch {
		return { ok: false };
	}
}

export function encodeQueryComponent(text: string): string {
	// 孤立サロゲートを含む場合は URIError を投げる（buildUrl 側で扱う）
	return encodeURIComponent(text);
}

function parseQuery(
	search: string,
	warnings: string[],
): { rows: ParamRow[]; tooMany: boolean } {
	const query = search.startsWith('?') ? search.slice(1) : search;
	const rows: ParamRow[] = [];
	if (query === '') return { rows, tooMany: false };
	for (const segment of query.split('&')) {
		if (segment === '') continue;
		if (rows.length >= MAX_PARAMS) return { rows, tooMany: true };
		const eq = segment.indexOf('=');
		const rawKey = eq === -1 ? segment : segment.slice(0, eq);
		const rawValue = eq === -1 ? '' : segment.slice(eq + 1);
		const row: ParamRow = { key: '', value: '' };
		const k = decodeQueryComponent(rawKey);
		if (k.ok) {
			row.key = k.text;
		} else {
			row.key = rawKey;
			row.rawKey = rawKey;
			warnings.push(
				`キー「${rawKey}」は不正なパーセントエンコードまたはUTF-8のため、デコードせず原文のまま保持しています。`,
			);
		}
		const v = decodeQueryComponent(rawValue);
		if (v.ok) {
			row.value = v.text;
		} else {
			row.value = rawValue;
			row.rawValue = rawValue;
			warnings.push(
				`キー「${row.key}」の値「${rawValue}」は不正なパーセントエンコードまたはUTF-8のため、デコードせず原文のまま保持しています。`,
			);
		}
		rows.push(row);
	}
	return { rows, tooMany: false };
}

export function parseUrl(input: string): ParseUrlResult {
	const text = input.trim();
	if (text === '') return { ok: false, error: 'URLを入力してください。' };
	if (text.length > MAX_URL_LENGTH) {
		return {
			ok: false,
			error: `URLが長すぎます（最大${MAX_URL_LENGTH.toLocaleString('ja-JP')}文字）。`,
		};
	}
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return {
			ok: false,
			error:
				'URLとして解析できません。https://example.com/path?key=value のように http:// または https:// から始まる絶対URLを入力してください。',
		};
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return {
			ok: false,
			error: `${url.protocol} は対象外です。http または https のURLを入力してください。`,
		};
	}
	const warnings: string[] = [];
	const { rows, tooMany } = parseQuery(url.search, warnings);
	if (tooMany) {
		return {
			ok: false,
			error: `クエリパラメータが多すぎます（最大${MAX_PARAMS.toLocaleString('ja-JP')}件）。`,
		};
	}
	const base = new URL(url.href);
	base.search = '';
	const hasCredentials = url.username !== '' || url.password !== '';
	if (hasCredentials) {
		warnings.push(
			'URLにユーザー名/パスワードが含まれています。コピーや共有の際は取り扱いに注意してください。',
		);
	}
	return {
		ok: true,
		value: {
			protocol: url.protocol,
			host: url.host,
			hostname: url.hostname,
			port: url.port,
			pathname: url.pathname,
			hash: url.hash,
			hasCredentials,
			baseUrl: base.href,
			params: rows,
			warnings,
		},
	};
}

export function serializeParams(rows: readonly ParamRow[]): string {
	const parts: string[] = [];
	for (const row of rows) {
		const key = row.rawKey ?? encodeQueryComponent(row.key);
		const value = row.rawValue ?? encodeQueryComponent(row.value);
		parts.push(`${key}=${value}`);
	}
	return parts.join('&');
}

export type BuildUrlResult =
	| { ok: true; url: string }
	| { ok: false; error: string };

/** ベースURL（パス・ハッシュ保持）にパラメータ行を再適用してURLを生成する。 */
export function buildUrl(
	baseUrl: string,
	rows: readonly ParamRow[],
): BuildUrlResult {
	try {
		const u = new URL(baseUrl);
		u.search = serializeParams(rows);
		return { ok: true, url: u.href };
	} catch {
		return {
			ok: false,
			error:
				'パラメータにエンコードできない文字（不正なサロゲートなど）が含まれているため、URLを生成できません。',
		};
	}
}

export function updateRow(
	rows: readonly ParamRow[],
	index: number,
	field: 'key' | 'value',
	text: string,
): ParamRow[] {
	return rows.map((row, i) => {
		if (i !== index) return row;
		if (field === 'key') {
			const { rawKey: _discard, ...rest } = row;
			return { ...rest, key: text };
		}
		const { rawValue: _discard, ...rest } = row;
		return { ...rest, value: text };
	});
}

export function addRow(rows: readonly ParamRow[]): ParamRow[] {
	if (rows.length >= MAX_PARAMS) return [...rows];
	return [...rows, { key: '', value: '' }];
}

export function removeRow(
	rows: readonly ParamRow[],
	index: number,
): ParamRow[] {
	return rows.filter((_, i) => i !== index);
}
