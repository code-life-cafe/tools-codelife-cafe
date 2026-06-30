import type { BruteForceResult, CaesarOptions, CipherResult } from './types.ts';

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const HIRAGANA =
	'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
const KATAKANA =
	'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';

export function isCleanHiragana(char: string): boolean {
	return HIRAGANA.includes(char);
}

export function isCleanKatakana(char: string): boolean {
	return KATAKANA.includes(char);
}

export function hasJapaneseKana(input: string): boolean {
	const normalized = input.normalize('NFD');
	for (const char of normalized) {
		if (isCleanHiragana(char) || isCleanKatakana(char)) {
			return true;
		}
	}
	return false;
}

export function getMaxShift(input: string): number {
	return hasJapaneseKana(input) ? 45 : 25;
}

function shiftChar(char: string, shift: number, charset: string): string {
	const index = charset.indexOf(char);
	if (index === -1) return char;

	const length = charset.length;
	// Ensure positive modulo
	const shiftedIndex = (((index + shift) % length) + length) % length;
	return charset[shiftedIndex];
}

export function caesarCipher(
	input: string,
	options: CaesarOptions,
): CipherResult {
	const { shift, direction } = options;
	const actualShift = direction === 'encode' ? shift : -shift;

	// Use NFD to decompose combined characters like が into か + ゛
	const normalized = input.normalize('NFD');
	let output = '';

	for (let i = 0; i < normalized.length; i++) {
		const char = normalized[i];

		if (UPPERCASE.includes(char)) {
			output += shiftChar(char, actualShift, UPPERCASE);
		} else if (LOWERCASE.includes(char)) {
			output += shiftChar(char, actualShift, LOWERCASE);
		} else if (isCleanHiragana(char)) {
			output += shiftChar(char, actualShift, HIRAGANA);
		} else if (isCleanKatakana(char)) {
			output += shiftChar(char, actualShift, KATAKANA);
		} else {
			// Pass through small kana, combining marks, spaces, symbols, etc.
			output += char;
		}
	}

	// Re-compose characters with NFC (e.g., か + ゛ -> が)
	const finalOutput = output.normalize('NFC');

	return {
		output: finalOutput,
		algorithm: 'caesar',
		inputLength: input.length,
		outputLength: finalOutput.length,
	};
}

export function caesarBruteForce(input: string): BruteForceResult[] {
	const maxShift = getMaxShift(input);
	const results: BruteForceResult[] = [];

	for (let shift = 1; shift <= maxShift; shift++) {
		const result = caesarCipher(input, { shift, direction: 'decode' });
		results.push({
			shift,
			output: result.output,
		});
	}

	return results;
}
