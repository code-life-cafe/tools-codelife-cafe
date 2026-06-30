import type { CipherResult } from './types.ts';

export function reverseString(input: string): CipherResult {
	let output = '';

	if (typeof Intl !== 'undefined' && Intl.Segmenter) {
		const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
		const segments = Array.from(segmenter.segment(input));
		output = segments
			.map((s) => s.segment)
			.reverse()
			.join('');
	} else {
		// Fallback for environments without Intl.Segmenter
		output = Array.from(input).reverse().join('');
	}

	return {
		output,
		algorithm: 'reverse',
		inputLength: input.length,
		outputLength: output.length,
	};
}
