import type { MermaidRepairResult, RepairChange } from './mermaid-repair.ts';

export const MAX_REPAIR_RESPONSE_BYTES = 1024 * 1024;
export const MAX_REPAIR_CHANGES = 200;
export const MAX_REPAIR_CHANGE_CHARACTERS = 500;
export interface RepairChangePreview extends RepairChange {
	originalTruncated: boolean;
	fixedTruncated: boolean;
}
export interface MermaidRepairOutput {
	code: string;
	modified: boolean;
	changes: RepairChangePreview[];
	svg: string;
	totalChanges: number;
	changesTruncated: boolean;
}

function preview(text: string): { text: string; truncated: boolean } {
	let result = '';
	let count = 0;
	for (const character of text) {
		if (count === MAX_REPAIR_CHANGE_CHARACTERS)
			return { text: result, truncated: true };
		result += character;
		count++;
	}
	return { text: result, truncated: false };
}

/** 履歴を有界化し、公開結果のUTF-8予算をWorker送信前に検査する。 */
export function serializeRepairOutput(repaired: MermaidRepairResult): string {
	if (repaired.error) throw new Error(repaired.error);
	const changes = repaired.changes
		.slice(0, MAX_REPAIR_CHANGES)
		.map((change) => {
			const original = preview(change.original),
				fixed = preview(change.fixed);
			return {
				...change,
				original: original.text,
				fixed: fixed.text,
				originalTruncated: original.truncated,
				fixedTruncated: fixed.truncated,
			};
		});
	const output: MermaidRepairOutput = {
		code: repaired.repairedCode,
		modified: repaired.isModified,
		changes,
		svg: '',
		totalChanges: repaired.changes.length,
		changesTruncated:
			repaired.changes.length > changes.length ||
			changes.some(
				(change) => change.originalTruncated || change.fixedTruncated,
			),
	};
	const json = JSON.stringify(output);
	if (new TextEncoder().encode(json).byteLength > MAX_REPAIR_RESPONSE_BYTES)
		throw new Error(
			'修復結果の上限は1MiBです。入力を分割して再試行してください。',
		);
	return json;
}
