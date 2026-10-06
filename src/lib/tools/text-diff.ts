// テキスト差分比較ロジック（純粋関数）

import { type Change, diffChars, diffLines } from 'diff';

export type DiffMode = 'lines' | 'chars';

export interface DiffPart {
	value: string;
	type: 'added' | 'removed' | 'unchanged';
}

export interface DiffResult {
	parts: DiffPart[];
	addedLines: number;
	removedLines: number;
	addedChars: number;
	removedChars: number;
}

function mapChanges(changes: Change[]): DiffPart[] {
	return changes.map((change) => ({
		value: change.value,
		type: change.added
			? ('added' as const)
			: change.removed
				? ('removed' as const)
				: ('unchanged' as const),
	}));
}

// 差分断片に含まれる行数を数える。空行・空白だけの行も1行として数え、
// 末尾の改行で終端された分の空セグメントだけを除外する（終端から架空の行を作らない）。
// charsモードの断片にも同じ定義を使う（断片内の行区切りで分かれた区間数）。
function countLines(value: string): number {
	if (value === '') return 0;
	const segments = value.split('\n');
	if (value.endsWith('\n')) segments.pop();
	return segments.length;
}

export function computeDiff(
	textA: string,
	textB: string,
	mode: DiffMode,
): DiffResult {
	let changes: Change[];
	if (mode === 'lines') {
		const normA = textA === '' || textA.endsWith('\n') ? textA : `${textA}\n`;
		const normB = textB === '' || textB.endsWith('\n') ? textB : `${textB}\n`;
		changes = diffLines(normA, normB);
	} else {
		changes = diffChars(textA, textB);
	}
	const parts = mapChanges(changes);

	let addedLines = 0;
	let removedLines = 0;
	let addedChars = 0;
	let removedChars = 0;

	for (const part of parts) {
		const lineCount = countLines(part.value);
		const charCount = [...part.value].length;

		if (part.type === 'added') {
			addedLines += lineCount;
			addedChars += charCount;
		}
		if (part.type === 'removed') {
			removedLines += lineCount;
			removedChars += charCount;
		}
	}

	return { parts, addedLines, removedLines, addedChars, removedChars };
}

export interface SplitCell {
	type: 'added' | 'removed' | 'unchanged';
	content: string;
	lineNum: number;
}

export interface SplitPair {
	left: SplitCell | null;
	right: SplitCell | null;
}

// Split（左右分割）表示用の行ペアを構築する。
// 追加・削除で片側だけ行が増える場合、反対側に null（スペーサー）を入れて
// 同じインデックスの左右が同じ縦位置になるようにする。
export function buildSplitPairs(parts: DiffPart[]): SplitPair[] {
	const pairs: SplitPair[] = [];
	let lineA = 1;
	let lineB = 1;

	for (const part of parts) {
		const partLines = part.value.split('\n');
		if (part.value.endsWith('\n')) {
			partLines.pop();
		}
		for (const line of partLines) {
			if (part.type === 'removed') {
				pairs.push({
					left: { type: 'removed', content: line, lineNum: lineA },
					right: null,
				});
				lineA++;
			} else if (part.type === 'added') {
				pairs.push({
					left: null,
					right: { type: 'added', content: line, lineNum: lineB },
				});
				lineB++;
			} else {
				pairs.push({
					left: { type: 'unchanged', content: line, lineNum: lineA },
					right: { type: 'unchanged', content: line, lineNum: lineB },
				});
				lineA++;
				lineB++;
			}
		}
	}
	return pairs;
}

export function readFileAsText(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () =>
			reject(new Error('ファイルの読み込みに失敗しました'));
		reader.readAsText(file);
	});
}
