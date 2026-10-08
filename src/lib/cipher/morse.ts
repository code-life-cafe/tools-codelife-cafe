import type { MorseDecodeResult, MorseEncodeResult } from './types.ts';

const MORSE_TABLE: Record<string, string> = {
	// Letters
	A: '.-',
	B: '-...',
	C: '-.-.',
	D: '-..',
	E: '.',
	F: '..-.',
	G: '--.',
	H: '....',
	I: '..',
	J: '.---',
	K: '-.-',
	L: '.-..',
	M: '--',
	N: '-.',
	O: '---',
	P: '.--.',
	Q: '--.-',
	R: '.-.',
	S: '...',
	T: '-',
	U: '..-',
	V: '...-',
	W: '.--',
	X: '-..-',
	Y: '-.--',
	Z: '--..',
	// Digits
	'0': '-----',
	'1': '.----',
	'2': '..---',
	'3': '...--',
	'4': '....-',
	'5': '.....',
	'6': '-....',
	'7': '--...',
	'8': '---..',
	'9': '----.',
	// Punctuation
	'.': '.-.-.-',
	',': '--..--',
	'?': '..--..',
	"'": '.----.',
	'!': '-.-.--',
	'/': '-..-.',
	'(': '-.--.',
	')': '-.--.-',
	'&': '.-...',
	':': '---...',
	';': '-.-.-.',
	'=': '-...-',
	'+': '.-.-.',
	'-': '-....-',
	_: '..--.-',
	'"': '.-..-.',
	$: '...-..-',
	'@': '.--.-.',
};

const REVERSE_MORSE_TABLE: Record<string, string> = Object.fromEntries(
	Object.entries(MORSE_TABLE).map(([char, morse]) => [morse, char]),
);

export function morseEncode(input: string): MorseEncodeResult {
	const words = input.split(/\s+/);
	const unsupported: string[] = [];

	const encodedWords = words.map((word) =>
		Array.from(word)
			.map((char) => {
				const key = /^[a-z]$/.test(char) ? char.toUpperCase() : char;
				const code = Object.hasOwn(MORSE_TABLE, key)
					? MORSE_TABLE[key]
					: undefined;
				if (!code) unsupported.push(char);
				return code;
			})
			.filter(Boolean)
			.join(' '),
	);

	// Filter out empty words and join with ' / '
	const output = encodedWords.filter(Boolean).join(' / ');

	return {
		output,
		algorithm: 'morse',
		inputLength: input.length,
		outputLength: output.length,
		unsupportedChars: [...new Set(unsupported)],
		unsupportedCount: unsupported.length,
	};
}

export function morseDecode(input: string): MorseDecodeResult {
	// Morse decoder needs to handle words split by ' / ' and letters split by ' '
	const words = input.split('/').map((w) => w.trim());
	const unknown: string[] = [];

	const decodedWords = words.map((word) =>
		word
			.split(/\s+/)
			.map((morseChar) => {
				if (!morseChar) return '';
				const char = Object.hasOwn(REVERSE_MORSE_TABLE, morseChar)
					? REVERSE_MORSE_TABLE[morseChar]
					: undefined;
				if (char === undefined) {
					unknown.push(morseChar);
					return '?';
				}
				return char;
			})
			.join(''),
	);

	const output = decodedWords.filter(Boolean).join(' ');

	return {
		output,
		algorithm: 'morse',
		inputLength: input.length,
		outputLength: output.length,
		unknownCodes: [...new Set(unknown)],
		unknownCount: unknown.length,
	};
}
