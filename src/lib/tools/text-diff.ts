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
		const lineCount = part.value.split('\n').filter((l) => l !== '').length;
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

export function readFileAsText(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () =>
			reject(new Error('ファイルの読み込みに失敗しました'));
		reader.readAsText(file);
	});
}
