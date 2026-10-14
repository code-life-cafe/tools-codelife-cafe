import { exceedsMaxCharacters } from '../string-length.ts';
import {
	computeDiff,
	DiffBudgetExceededError,
	type DiffMode,
	type DiffResult,
} from './text-diff.ts';

export const MAX_DIFF_INPUT_CHARACTERS = 20_000;
export const MAX_DIFF_PARTS = 5_000;
export const MAX_DIFF_OUTPUT_BYTES = 1024 * 1024;
export const DIFF_WORKER_DEADLINE_MS = 2_000;
export const DIFF_MESSAGES = {
	budget:
		'比較の計算量または時間の上限を超えました。入力を短くして再試行してください。',
	input:
		'比較元と比較先は各20000文字以内の文字列、比較モードはlinesまたはcharsで指定してください。',
	output:
		'差分結果の上限（5000断片・UTF-8で1MiB）を超えました。入力を分割してください。',
	timeout:
		'比較処理が2秒の上限を超えたため中止しました。入力を短くして再試行してください。',
	busy: '比較処理が実行中です。完了後に再試行してください。',
	unavailable: 'このブラウザではWeb Workerを利用できません。',
	worker: '比較Workerを実行できませんでした。再試行してください。',
	reply: '差分結果を受信できませんでした。再試行してください。',
	unexpected: 'テキストの比較に失敗しました。入力を確認してください。',
} as const;
export class TextDiffMcpError extends Error {}
export interface TextDiffInput {
	textA: string;
	textB: string;
	mode: DiffMode;
}
export interface TextDiffOutput extends DiffResult {
	mode: DiffMode;
	hasChanges: boolean;
}

export function safeDiffError(error: unknown): string {
	if (
		(error instanceof TextDiffMcpError ||
			error instanceof DiffBudgetExceededError) &&
		Object.values(DIFF_MESSAGES).some((message) => message === error.message)
	)
		return error.message;
	return DIFF_MESSAGES.unexpected;
}

export function computeBoundedDiff(input: TextDiffInput): TextDiffOutput {
	if (
		!input ||
		typeof input.textA !== 'string' ||
		typeof input.textB !== 'string' ||
		(input.mode !== 'lines' && input.mode !== 'chars') ||
		exceedsMaxCharacters(input.textA, MAX_DIFF_INPUT_CHARACTERS) ||
		exceedsMaxCharacters(input.textB, MAX_DIFF_INPUT_CHARACTERS)
	)
		throw new TextDiffMcpError(DIFF_MESSAGES.input);
	const result = computeDiff(input.textA, input.textB, input.mode, {
		maxEditLength: 1000,
		timeout: 500,
	});
	return {
		mode: input.mode,
		hasChanges: result.parts.some(
			(p) => p.type !== 'unchanged' && p.value !== '',
		),
		...result,
	};
}

export function serializeDiffOutput(output: TextDiffOutput): string {
	if (output.parts.length > MAX_DIFF_PARTS)
		throw new TextDiffMcpError(DIFF_MESSAGES.output);
	const json = JSON.stringify(output);
	if (new TextEncoder().encode(json).byteLength > MAX_DIFF_OUTPUT_BYTES)
		throw new TextDiffMcpError(DIFF_MESSAGES.output);
	return json;
}

/** Workerとの境界ではサイズ・全フィールドの型を検査し、未知のエラー本文を返さない。 */
export function parseDiffReply(data: unknown): TextDiffOutput {
	const fail = () => new TextDiffMcpError(DIFF_MESSAGES.reply);
	if (
		typeof data !== 'string' ||
		data.length > MAX_DIFF_OUTPUT_BYTES ||
		new TextEncoder().encode(data).byteLength > MAX_DIFF_OUTPUT_BYTES
	)
		throw fail();
	let output: unknown;
	try {
		output = JSON.parse(data);
	} catch {
		throw fail();
	}
	if (!output || typeof output !== 'object' || Array.isArray(output))
		throw fail();
	const value = output as Record<string, unknown>;
	if ('error' in value) {
		if (
			Object.keys(value).length === 1 &&
			Object.values(DIFF_MESSAGES).some((message) => message === value.error)
		)
			throw new TextDiffMcpError(value.error as string);
		throw fail();
	}
	if (
		Object.keys(value).length !== 7 ||
		(value.mode !== 'lines' && value.mode !== 'chars') ||
		typeof value.hasChanges !== 'boolean' ||
		!Array.isArray(value.parts) ||
		value.parts.length > MAX_DIFF_PARTS
	)
		throw fail();
	for (const key of [
		'addedLines',
		'removedLines',
		'addedChars',
		'removedChars',
	]) {
		const count = value[key];
		if (
			typeof count !== 'number' ||
			!Number.isSafeInteger(count) ||
			count < 0 ||
			count > MAX_DIFF_OUTPUT_BYTES
		)
			throw fail();
	}
	if (
		!value.parts.every(
			(part) =>
				part &&
				typeof part === 'object' &&
				!Array.isArray(part) &&
				Object.keys(part).length === 2 &&
				typeof part.value === 'string' &&
				['added', 'removed', 'unchanged'].includes(part.type),
		)
	)
		throw fail();
	const result = value as unknown as TextDiffOutput;
	if (
		result.hasChanges !==
		result.parts.some((p) => p.type !== 'unchanged' && p.value !== '')
	)
		throw fail();
	return result;
}
