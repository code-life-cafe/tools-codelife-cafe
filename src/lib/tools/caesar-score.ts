import { caesarBruteForce } from '../cipher/caesar.ts';
import type { BruteForceResult } from '../cipher/types.ts';

export interface ScoredCaesarCandidate extends BruteForceResult {
	score: number;
}

export type CaesarCandidateOrder = 'shift' | 'score';

// 小さな頻出語・連接の集合による推測。辞書照合や正解判定ではない。
const JAPANESE_WORDS = [
	'こんにちは',
	'ありがとう',
	'おはよう',
	'わたし',
	'あなた',
	'です',
	'ます',
	'でした',
	'ました',
	'して',
	'から',
	'こと',
	'この',
	'その',
	'きょう',
	'あした',
	'にほん',
	'てんき',
];
const COMMON_KANA = 'のはをにがてたすとしなもいか';
const ENGLISH_WORDS = new Set([
	'the',
	'and',
	'is',
	'are',
	'this',
	'that',
	'of',
	'to',
	'in',
	'a',
	'you',
	'it',
	'for',
	'hello',
	'world',
	'we',
	'with',
	'on',
	'be',
]);
// a-z の英語文字頻度（%）。対数尤度で極端に珍しい文字の連続を下げる。
const ENGLISH_FREQUENCIES = [
	8.2, 1.5, 2.8, 4.3, 12.7, 2.2, 2, 6.1, 7, 0.15, 0.77, 4, 2.4, 6.7, 7.5, 1.9,
	0.095, 6, 6.3, 9.1, 2.8, 0.98, 2.4, 0.15, 2, 0.074,
];

/** 日本語・英語の頻度による簡易スコア。値は確率・正解保証ではない。 */
export function scoreCaesarText(text: string): number {
	const lower = text.toLowerCase();
	// カタカナもひらがな相当の頻度で評価。濁点は保持する。
	const kana = lower.replace(/[ァ-ヶ]/g, (char) =>
		String.fromCharCode(char.charCodeAt(0) - 0x60),
	);
	let score = 0;
	for (const char of kana) {
		if (COMMON_KANA.includes(char)) score += 1;
	}
	for (const word of JAPANESE_WORDS) {
		score += (kana.split(word).length - 1) * word.length * 4;
	}
	for (const char of lower) {
		const index = char.charCodeAt(0) - 97;
		if (index >= 0 && index < 26) {
			score += Math.log(ENGLISH_FREQUENCIES[index]);
		}
	}
	for (const word of lower.match(/[a-z]+/g) ?? []) {
		if (ENGLISH_WORDS.has(word)) score += word.length * 4;
	}
	return score;
}

/** 全候補を維持し、同点ではシフト昇順にする。入力や外部状態は変更しない。 */
export function scoredCaesarCandidates(
	input: string,
	order: CaesarCandidateOrder = 'shift',
): ScoredCaesarCandidate[] {
	const candidates = caesarBruteForce(input).map((candidate) => ({
		...candidate,
		score: scoreCaesarText(candidate.output),
	}));
	return candidates.sort((a, b) =>
		order === 'score'
			? b.score - a.score || a.shift - b.shift
			: a.shift - b.shift,
	);
}
