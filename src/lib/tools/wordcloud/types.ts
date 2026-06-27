export type Analyzer = 'sudachi' | 'tiny-segmenter';
export type PartOfSpeech =
	| 'noun'
	| 'proper-noun'
	| 'verb'
	| 'adjective'
	| 'adverb';

export type Token = {
	surface: string; // 表層形
	base: string; // 原形（基本形）。TinySegmenter時は surface と同一
	pos: PartOfSpeech | 'other'; // TinySegmenter時は常に 'other'
};

export type AnalyzeOptions = {
	analyzer: Analyzer;
	posFilter: PartOfSpeech[]; // 含める品詞
	useBaseForm: boolean; // 原形で集計するか
	useStopwords: boolean; // 既定ストップワード適用
	customStopwords: string[]; // ユーザー追加の除外語
	minCount: number; // 最小出現回数
	maxWords: number; // 最大語数
};

export type WordFrequency = {
	word: string;
	pos: PartOfSpeech | 'other';
	count: number;
};

export type WordCloudLayoutOptions = {
	width: number;
	height: number;
	fontFamily: string; // 既定 'Noto Sans JP'
	scale: 'sqrt' | 'log' | 'linear';
	rotation: 'none' | 'orthogonal' | 'random'; // 既定 'orthogonal' (0/90度)
	palette: string; // d3-scale-chromatic スキーム名 or サイトテーマ
};

export type PlacedWord = {
	text: string;
	size: number; // px
	x: number;
	y: number;
	rotate: number; // deg
	color: string;
};

export type AnalyzeResult = {
	frequencies: WordFrequency[];
	totalTokens: number;
	analyzer: Analyzer;
	warnings: string[];
};

export type TextInputValidation =
	| { ok: true }
	| { ok: false; reason: 'empty' | 'too-large'; message: string };
