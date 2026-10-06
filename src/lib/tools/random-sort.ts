// ランダム並べ替え・グループ分けロジック。DOM/React非依存の純粋関数。

export const MAX_ITEMS = 10_000;
export const MAX_INPUT_BYTES = 1024 * 1024;

/** 0以上 maxExclusive 未満の整数を返す乱数関数 */
export type RandomInt = (maxExclusive: number) => number;

export type ParseItemsResult =
	| { ok: true; items: string[]; skippedEmptyLines: number }
	| { ok: false; error: string };

/**
 * 改行区切りで項目を取り出す。空行・空白のみの行は除外し、件数を返す。
 * 非空行の本文はtrimせず、重複行も別項目として保持する。
 */
export function parseItems(text: string): ParseItemsResult {
	if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) {
		return { ok: false, error: '入力が大きすぎます（上限1MiB）。' };
	}
	const items: string[] = [];
	let skippedEmptyLines = 0;
	const lines = text.split(/\r\n|\r|\n/);
	if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	for (const line of lines) {
		if (line.trim() === '') {
			skippedEmptyLines++;
			continue;
		}
		items.push(line);
		if (items.length > MAX_ITEMS) {
			return {
				ok: false,
				error: `項目が多すぎます（上限${MAX_ITEMS.toLocaleString('ja-JP')}項目）。`,
			};
		}
	}
	return { ok: true, items, skippedEmptyLines };
}

/**
 * Web Cryptoによる一様乱数。rejection samplingで剰余バイアスを排除する。
 * 利用できない環境では例外を投げる。
 */
export function secureRandomInt(
	maxExclusive: number,
	cryptoObj: Pick<Crypto, 'getRandomValues'> | undefined = globalThis.crypto,
): number {
	if (
		!Number.isInteger(maxExclusive) ||
		maxExclusive < 1 ||
		maxExclusive > 0x100000000
	) {
		throw new RangeError('乱数の範囲が不正です。');
	}
	if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
		throw new Error(
			'このブラウザでは安全な乱数（Web Crypto）を利用できないため、処理できません。',
		);
	}
	if (maxExclusive === 1) return 0;
	const range = 0x100000000;
	const limit = range - (range % maxExclusive);
	const buf = new Uint32Array(1);
	for (;;) {
		cryptoObj.getRandomValues(buf);
		const r = buf[0] as number;
		if (r < limit) return r % maxExclusive;
	}
}

/** Fisher-Yatesで並べ替えた新しい配列を返す（入力は変更しない）。 */
export function shuffle<T>(
	items: readonly T[],
	randomInt: RandomInt = secureRandomInt,
): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		if (!Number.isInteger(j) || j < 0 || j > i) {
			throw new RangeError('乱数関数が範囲外の値を返しました。');
		}
		const tmp = out[i] as T;
		out[i] = out[j] as T;
		out[j] = tmp;
	}
	return out;
}

export type SplitResult =
	| { ok: true; groups: string[][] }
	| { ok: false; error: string };

/** 先頭から均等に分配する。各グループの人数差は最大1。 */
export function splitIntoGroups(
	items: readonly string[],
	groupCount: number,
): SplitResult {
	if (items.length === 0) {
		return { ok: false, error: '項目がありません。' };
	}
	if (!Number.isInteger(groupCount) || groupCount < 1) {
		return { ok: false, error: 'グループ数は1以上の整数で指定してください。' };
	}
	if (groupCount > items.length) {
		return {
			ok: false,
			error: `グループ数は項目数（${items.length}）以下にしてください。`,
		};
	}
	const base = Math.floor(items.length / groupCount);
	const remainder = items.length % groupCount;
	const groups: string[][] = [];
	let cursor = 0;
	for (let g = 0; g < groupCount; g++) {
		const size = base + (g < remainder ? 1 : 0);
		groups.push(items.slice(cursor, cursor + size));
		cursor += size;
	}
	return { ok: true, groups };
}

export function formatShuffled(items: readonly string[]): string {
	return items.join('\n');
}

export function formatGroups(groups: readonly (readonly string[])[]): string {
	return groups
		.map((g, i) => `グループ${i + 1}（${g.length}件）\n${g.join('\n')}`)
		.join('\n\n');
}
