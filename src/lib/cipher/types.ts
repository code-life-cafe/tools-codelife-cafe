export type CipherAlgorithm = 'caesar' | 'rot13' | 'reverse' | 'morse';
export type CipherDirection = 'encode' | 'decode';

export type CaesarOptions = {
	shift: number;
	direction: CipherDirection;
};

export type MorseOptions = {
	direction: CipherDirection;
	separator?: string;
};

export type CipherResult = {
	output: string;
	algorithm: CipherAlgorithm;
	inputLength: number;
	outputLength: number;
};

export type MorseEncodeResult = CipherResult & {
	/** 変換できず除外した文字（重複を除き、出現順） */
	unsupportedChars: string[];
	/** 変換できず除外した文字の総数（重複を含む） */
	unsupportedCount: number;
};

export type MorseDecodeResult = CipherResult & {
	/** 未定義の符号（重複を除き、出現順）。出力では「?」に置換される */
	unknownCodes: string[];
	/** 未定義の符号の総数（重複を含む） */
	unknownCount: number;
};

export type BruteForceResult = {
	shift: number;
	output: string;
};
