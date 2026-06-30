import { caesarCipher } from './caesar.ts';
import type { CipherResult } from './types.ts';

export function rot13(input: string): CipherResult {
	const result = caesarCipher(input, { shift: 13, direction: 'encode' });

	return {
		output: result.output,
		algorithm: 'rot13',
		inputLength: input.length,
		outputLength: result.outputLength,
	};
}
