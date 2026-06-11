// zipcode.ts — 郵便番号→住所変換のコアロジック（純粋関数・fetch は注入）
// 住所データは同一オリジンの静的JSON（/data/zipcode/{nn}.json）からのみ取得し、
// ユーザー入力を外部へ送信しない。

/** 1レコード = [郵便番号7桁, 都道府県, 市区町村, 町域] */
export type ZipRecord = [string, string, string, string];

/** 上2桁チャンクを取得する関数（同一オリジンGET）。テスト時はモックを注入する */
export type FetchChunk = (prefix: string) => Promise<ZipRecord[]>;

export interface BulkResult {
	input: string;
	zip: string | null;
	prefecture?: string;
	city?: string;
	town?: string;
	candidates?: number;
	error?: 'format-error' | 'not-found' | 'fetch-error';
}

export const MAX_BULK_LINES = 10000;
const FETCH_CONCURRENCY = 4;

// 全角数字・全角ハイフン等を半角へ
const ZEN_TO_HAN: Record<string, string> = {
	'０': '0',
	'１': '1',
	'２': '2',
	'３': '3',
	'４': '4',
	'５': '5',
	'６': '6',
	'７': '7',
	'８': '8',
	'９': '9',
};

/**
 * 入力を正規化して7桁の郵便番号文字列を返す。不正な場合は null。
 * - 全角数字 → 半角
 * - ハイフン・空白・`〒` を除去
 * - 7桁の数字のみ受理（先頭ゼロは文字列のまま保持）
 */
export function normalizeZip(input: string): string | null {
	if (!input) return null;
	let s = '';
	for (const ch of input.trim()) {
		s += ZEN_TO_HAN[ch] ?? ch;
	}
	// ハイフン（半角/全角各種）・空白・〒 を除去
	s = s.replace(/[\s　\-‐-―ー−－〒]/g, '');
	return /^\d{7}$/.test(s) ? s : null;
}

/**
 * 1行のテキストから7桁の郵便番号を抽出する（1行1件想定）。
 * `123-4567` / `1234567` / 全角 / `〒` 付きに対応。見つからなければ null。
 */
function extractZipFromLine(line: string): string | null {
	// まず行全体の正規化を試みる（最も一般的な「1行=1郵便番号」ケース）
	const whole = normalizeZip(line);
	if (whole) return whole;
	// 行内に余分な文字がある場合は 3桁-4桁 / 連続7桁 のパターンを探す
	let s = '';
	for (const ch of line) s += ZEN_TO_HAN[ch] ?? ch;
	const match = s.match(/(\d{3})[\s　\-‐-―ー−]?(\d{4})/);
	if (match) return match[1] + match[2];
	return null;
}

/** 複数行テキストを行ごとに分解し、各行の抽出結果を返す（空行も保持） */
export function extractZipsFromLines(
	text: string,
): Array<{ line: string; zip: string | null }> {
	return text.split(/\r?\n/).map((line) => ({
		line,
		zip: extractZipFromLine(line),
	}));
}

/** 郵便番号の上2桁チャンクをキャッシュ付きで取得し、該当レコードを返す */
export function createZipLookup(fetchChunk: FetchChunk) {
	const cache = new Map<string, ZipRecord[]>();

	async function getChunk(prefix: string): Promise<ZipRecord[]> {
		const cached = cache.get(prefix);
		if (cached) return cached;
		const records = await fetchChunk(prefix);
		cache.set(prefix, records);
		return records;
	}

	async function lookup(zip7: string): Promise<ZipRecord[]> {
		const prefix = zip7.slice(0, 2);
		const records = await getChunk(prefix);
		return records.filter((r) => r[0] === zip7);
	}

	return { getChunk, lookup, cache };
}

/**
 * 単一の郵便番号を検索する（上2桁チャンクを lazy fetch + メモリキャッシュ）。
 * 該当なしは空配列。
 */
export async function lookupZip(
	zip7: string,
	fetchChunk: FetchChunk,
): Promise<ZipRecord[]> {
	return createZipLookup(fetchChunk).lookup(zip7);
}

/** 並列上限つきで各タスクを処理する */
async function runWithConcurrency<T>(
	items: readonly T[],
	limit: number,
	task: (item: T) => Promise<void>,
): Promise<void> {
	let index = 0;
	const workers = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			while (index < items.length) {
				const current = index++;
				await task(items[current]);
			}
		},
	);
	await Promise.all(workers);
}

/**
 * Excel列の貼り付けなど複数行をまとめて変換する。
 * - 必要チャンクを重複排除して並列(上限4)で事前fetch
 * - 行ごとに変換（同じ郵便番号が複数行あってもそれぞれ変換し、元の行順を維持）
 * - 複数町域該当時は1件目を採用し candidates に件数を入れる
 * - 進捗は onProgress(done, total) で通知（呼び出し側で 1,000行ごとに yield する）
 */
export async function bulkConvert(
	lines: readonly string[],
	fetchChunk: FetchChunk,
	onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<BulkResult[]> {
	const lookup = createZipLookup(fetchChunk);
	const parsed = lines.map((line) => ({ line, zip: extractZipFromLine(line) }));

	// 必要なチャンク（上2桁）を重複排除して事前fetch
	const prefixes = [
		...new Set(
			parsed
				.map((p) => p.zip)
				.filter((z): z is string => z != null)
				.map((z) => z.slice(0, 2)),
		),
	];
	const fetchErrors = new Set<string>();
	await runWithConcurrency(prefixes, FETCH_CONCURRENCY, async (prefix) => {
		try {
			await lookup.getChunk(prefix);
		} catch {
			fetchErrors.add(prefix);
		}
	});

	const results: BulkResult[] = [];
	for (let i = 0; i < parsed.length; i++) {
		const { line, zip } = parsed[i];
		if (zip == null) {
			results.push({ input: line, zip: null, error: 'format-error' });
		} else if (fetchErrors.has(zip.slice(0, 2))) {
			results.push({ input: line, zip, error: 'fetch-error' });
		} else {
			const matches = await lookup.lookup(zip);
			if (matches.length === 0) {
				results.push({ input: line, zip, error: 'not-found' });
			} else {
				const [, prefecture, city, town] = matches[0];
				results.push({
					input: line,
					zip,
					prefecture,
					city,
					town,
					candidates: matches.length,
				});
			}
		}
		if (onProgress && (i + 1) % 1000 === 0) {
			await onProgress(i + 1, parsed.length);
		}
	}
	if (onProgress) await onProgress(parsed.length, parsed.length);
	return results;
}

/** 都道府県・市区町村・町域を連結した住所文字列を作る */
export function formatAddress(record: ZipRecord): string {
	return `${record[1]}${record[2]}${record[3]}`;
}
