import type { CipherResult } from './types.ts';

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

export function morseEncode(input: string): CipherResult {
	const words = input.toUpperCase().split(/\s+/);

	const encodedWords = words.map((word) => {
		return (
			Array.from(word)
				.map((char) => MORSE_TABLE[char] || '') // skip unknown silently if we just return ''
				// Let's filter out empty strings to avoid extra spaces
				.filter(Boolean)
				.join(' ')
		);
	});

	// Filter out empty words and join with ' / '
	const output = encodedWords.filter(Boolean).join(' / ');

	return {
		output,
		algorithm: 'morse',
		inputLength: input.length,
		outputLength: output.length,
	};
}

export function morseDecode(input: string): CipherResult {
	// Morse decoder needs to handle words split by ' / ' and letters split by ' '
	const words = input.split('/').map((w) => w.trim());

	const decodedWords = words.map((word) => {
		const letters = word.split(/\s+/);
		return letters
			.map((morseChar) => {
				if (!morseChar) return '';
				return REVERSE_MORSE_TABLE[morseChar] || '?';
			})
			.join('');
	});

	const output = decodedWords.filter(Boolean).join(' ');

	return {
		output,
		algorithm: 'morse',
		inputLength: input.length,
		outputLength: output.length,
	};
}
