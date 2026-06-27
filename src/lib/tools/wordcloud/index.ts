import { buildFrequencies, toCsv } from './frequency.ts';
import { DEFAULT_JA_STOPWORDS } from './stopwords.ts';
import { MAX_INPUT_CHARS, tokenize, validateText } from './tokenize.ts';
import type { AnalyzeOptions, AnalyzeResult } from './types.ts';

export * from './layout.ts';
export * from './types.ts';
export {
	buildFrequencies,
	DEFAULT_JA_STOPWORDS,
	MAX_INPUT_CHARS,
	toCsv,
	tokenize,
	validateText,
};

export async function analyze(
	text: string,
	opts: AnalyzeOptions,
	onProgress?: (progress: number) => void,
): Promise<AnalyzeResult> {
	const validation = validateText(text);
	if (!validation.ok) {
		throw new Error(validation.message);
	}

	const warnings: string[] = [];
	if (opts.analyzer === 'tiny-segmenter') {
		if (opts.posFilter && opts.posFilter.length > 0) {
			warnings.push(
				'かんたんモード（TinySegmenter）では品詞フィルタは利用できません。',
			);
		}
	}

	const tokens = await tokenize(text, opts.analyzer, onProgress);
	const frequencies = buildFrequencies(tokens, opts);

	return {
		frequencies,
		totalTokens: tokens.length,
		analyzer: opts.analyzer,
		warnings,
	};
}
