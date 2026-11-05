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

export class DiffBudgetExceededError extends Error {
	constructor() {
		super(
			'比較の計算量または時間の上限を超えました。入力を短くして再試行してください。',
		);
	}
}

export function computeDiff(
	textA: string,
	textB: string,
	mode: DiffMode,
	budget?: { maxEditLength: number; timeout: number },
): DiffResult {
	let changes: Change[] | undefined;
	if (mode === 'lines') {
		const normA = textA === '' || textA.endsWith('\n') ? textA : `${textA}\n`;
		const normB = textB === '' || textB.endsWith('\n') ? textB : `${textB}\n`;
		changes = budget
			? diffLines(normA, normB, budget)
			: diffLines(normA, normB);
	} else {
		changes = budget
			? diffChars(textA, textB, budget)
			: diffChars(textA, textB);
	}
	if (changes === undefined) throw new DiffBudgetExceededError();
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
	parts?: DiffPart[];
	lineBreak?: boolean;
}

export interface SplitPair {
	left: SplitCell | null;
	right: SplitCell | null;
}

// Split（左右分割）表示用の行ペアを構築する。
// 追加・削除で片側だけ行が増える場合、反対側に null（スペーサー）を入れて
// 同じインデックスの左右が同じ縦位置になるようにする。
export function buildSplitPairs(
	parts: DiffPart[],
	mode: DiffMode = 'lines',
): SplitPair[] {
	if (mode === 'chars') return buildCharacterPairs(parts);
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

// 文字差分は断片の境界では改行しない。左右それぞれの実改行で行を閉じ、
// 共通の行境界までの変更ブロックを対応付ける。
function buildCharacterPairs(parts: DiffPart[]): SplitPair[] {
	const pairs: SplitPair[] = [];
	const pending: { left: SplitCell[]; right: SplitCell[] } = {
		left: [],
		right: [],
	};
	const current: { left: DiffPart[]; right: DiffPart[] } = {
		left: [],
		right: [],
	};
	const lineNums = { left: 1, right: 1 };
	const flush = () => {
		for (
			let i = 0;
			i < Math.max(pending.left.length, pending.right.length);
			i++
		) {
			pairs.push({
				left: pending.left[i] ?? null,
				right: pending.right[i] ?? null,
			});
		}
		pending.left = [];
		pending.right = [];
	};
	const finishLine = (side: 'left' | 'right', lineBreak: boolean) => {
		const segments = current[side];
		const value = segments.map((segment) => segment.value).join('');
		pending[side].push({
			type: segments.some((segment) => segment.type !== 'unchanged')
				? side === 'left'
					? 'removed'
					: 'added'
				: 'unchanged',
			content: lineBreak ? value.slice(0, -1) : value,
			lineNum: lineNums[side]++,
			parts: segments,
			lineBreak,
		});
		current[side] = [];
	};
	for (const part of parts) {
		const chunks = part.value.match(/[^\n]+|\n/g) ?? [];
		for (const value of chunks) {
			if (
				part.type === 'unchanged' &&
				current.left.length === 0 &&
				current.right.length === 0
			)
				flush();
			for (const side of ['left', 'right'] as const) {
				if (
					(side === 'left' && part.type === 'added') ||
					(side === 'right' && part.type === 'removed')
				)
					continue;
				current[side].push({ type: part.type, value });
				if (value === '\n') finishLine(side, true);
			}
			if (part.type === 'unchanged' && value === '\n') flush();
		}
	}
	for (const side of ['left', 'right'] as const) {
		if (current[side].length > 0) finishLine(side, false);
	}
	flush();
	return pairs;
}

export interface UnifiedLine extends Omit<SplitCell, 'lineNum'> {
	lineA: number | null;
	lineB: number | null;
}

export function buildUnifiedLines(
	parts: DiffPart[],
	mode: DiffMode,
): UnifiedLine[] {
	const lines: UnifiedLine[] = [];
	for (const { left, right } of buildSplitPairs(parts, mode)) {
		if (
			left &&
			right &&
			left.type === 'unchanged' &&
			right.type === 'unchanged' &&
			left.content === right.content &&
			left.lineBreak === right.lineBreak
		) {
			lines.push({ ...left, lineA: left.lineNum, lineB: right.lineNum });
		} else {
			if (left)
				lines.push({
					...left,
					type: 'removed',
					lineA: left.lineNum,
					lineB: null,
				});
			if (right)
				lines.push({
					...right,
					type: 'added',
					lineA: null,
					lineB: right.lineNum,
				});
		}
	}
	return lines;
}

export function formatDiffText(parts: DiffPart[], mode: DiffMode): string {
	return buildUnifiedLines(parts, mode)
		.map((line) => {
			const prefix =
				line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  ';
			const noNewline =
				mode === 'chars' && !line.lineBreak ? '\n\\ 末尾に改行なし' : '';
			return `${prefix}${line.content}${noNewline}`;
		})
		.join('\n');
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
