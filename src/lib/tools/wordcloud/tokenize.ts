import TinySegmenter from 'tiny-segmenter';
import type { Analyzer, TextInputValidation, Token } from './types.ts';

export const MAX_INPUT_CHARS = 500_000;

export function validateText(text: string): TextInputValidation {
	if (!text || text.trim().length === 0) {
		return {
			ok: false,
			reason: 'empty',
			message: 'テキストを入力してください。',
		};
	}
	if (text.length > MAX_INPUT_CHARS) {
		return {
			ok: false,
			reason: 'too-large',
			message: `テキストの文字数が上限（${MAX_INPUT_CHARS.toLocaleString()}文字）を超えています。`,
		};
	}
	return { ok: true };
}

export async function tokenize(
	text: string,
	_analyzer: Analyzer = 'tiny-segmenter',
	onProgress?: (progress: number) => void,
): Promise<Token[]> {
	const validation = validateText(text);
	if (!validation.ok) {
		return [];
	}

	onProgress?.(10);

	const segmenter = new TinySegmenter();
	const segments: string[] = segmenter.segment(text);

	onProgress?.(80);

	const tokens: Token[] = segments.map((seg) => ({
		surface: seg,
		base: seg,
		pos: 'other',
	}));

	onProgress?.(100);

	return tokens;
}
