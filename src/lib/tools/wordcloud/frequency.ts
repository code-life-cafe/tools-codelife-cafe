import { DEFAULT_JA_STOPWORDS } from './stopwords.ts';
import type { AnalyzeOptions, Token, WordFrequency } from './types.ts';

const URL_REGEX = /^https?:\/\/\S+$/i;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const NUMERIC_REGEX = /^[0-9０-９,.-]+$/;
const SYMBOL_REGEX = /^[\p{P}\p{S}\s\n\r\t]+$/u;
const SINGLE_HIRAGANA_REGEX = /^[\u3041-\u309F]$/;

function isNoise(word: string): boolean {
	if (!word || word.trim().length === 0) return true;
	const trimmed = word.trim();
	if (SYMBOL_REGEX.test(trimmed)) return true;
	if (URL_REGEX.test(trimmed)) return true;
	if (EMAIL_REGEX.test(trimmed)) return true;
	if (NUMERIC_REGEX.test(trimmed)) return true;
	if (SINGLE_HIRAGANA_REGEX.test(trimmed)) return true;
	return false;
}

export function buildFrequencies(
	tokens: Token[],
	opts: AnalyzeOptions,
): WordFrequency[] {
	const counts = new Map<
		string,
		{ count: number; pos: WordFrequency['pos'] }
	>();
	const customStopwordsSet = new Set(
		(opts.customStopwords || [])
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean),
	);

	for (const token of tokens) {
		const targetWord = opts.useBaseForm ? token.base : token.surface;
		if (!targetWord) continue;

		// 1. ノイズ除外
		if (isNoise(targetWord)) continue;

		const lowerWord = targetWord.toLowerCase();

		// 2. 品詞フィルタ (TinySegmenterでは pos は 'other' であり、品詞フィルタは無視/バイパスする)
		if (
			opts.analyzer === 'sudachi' &&
			opts.posFilter &&
			opts.posFilter.length > 0
		) {
			if (token.pos !== 'other' && !opts.posFilter.includes(token.pos)) {
				continue;
			}
		}

		// 3. ストップワード除去
		if (opts.useStopwords && DEFAULT_JA_STOPWORDS.has(targetWord)) {
			continue;
		}
		if (opts.useStopwords && DEFAULT_JA_STOPWORDS.has(lowerWord)) {
			continue;
		}
		if (customStopwordsSet.has(lowerWord)) {
			continue;
		}

		const existing = counts.get(targetWord);
		if (existing) {
			existing.count += 1;
		} else {
			counts.set(targetWord, { count: 1, pos: token.pos });
		}
	}

	let freqs: WordFrequency[] = Array.from(counts.entries()).map(
		([word, data]) => ({
			word,
			pos: data.pos,
			count: data.count,
		}),
	);

	// 4. 最小出現回数フィルタ
	freqs = freqs.filter((f) => f.count >= opts.minCount);

	// 5. 出現回数降順ソート
	freqs.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));

	// 6. 最大語数適用
	if (opts.maxWords > 0 && freqs.length > opts.maxWords) {
		freqs = freqs.slice(0, opts.maxWords);
	}

	return freqs;
}

export function toCsv(freqs: WordFrequency[]): string {
	const header = '順位,単語,品詞,出現回数';
	const rows: string[] = [header];

	const posLabelMap: Record<string, string> = {
		noun: '名詞',
		'proper-noun': '固有名詞',
		verb: '動詞',
		adjective: '形容詞',
		adverb: '副詞',
		other: 'その他',
	};

	freqs.forEach((item, index) => {
		const rank = index + 1;
		const word =
			item.word.includes(',') ||
			item.word.includes('"') ||
			item.word.includes('\n')
				? `"${item.word.replace(/"/g, '""')}"`
				: item.word;
		const posStr = posLabelMap[item.pos] || 'その他';
		rows.push(`${rank},${word},${posStr},${item.count}`);
	});

	// UTF-8 BOM + CRLF
	return `\uFEFF${rows.join('\r\n')}`;
}
