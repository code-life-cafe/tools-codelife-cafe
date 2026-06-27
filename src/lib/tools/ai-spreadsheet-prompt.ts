export type SpreadsheetInputFormat = 'auto' | 'csv' | 'tsv';
export type PromptTask =
	| 'analyze'
	| 'summarize'
	| 'clean'
	| 'transform'
	| 'custom';

export interface SpreadsheetPromptOptions {
	input: string;
	format: SpreadsheetInputFormat;
	task: PromptTask;
	customInstruction?: string;
	maxRows: number;
}

export interface SpreadsheetPromptResult {
	prompt: string;
	detectedDelimiter: ',' | '\t';
	rowCount: number;
	columnCount: number;
	includedRows: number;
	truncated: boolean;
	warnings: string[];
}

const TASK_INSTRUCTIONS: Record<PromptTask, string> = {
	analyze:
		'以下の表データを分析し、重要な傾向・外れ値・確認すべきポイントを日本語で箇条書きにしてください。',
	summarize:
		'以下の表データの内容を、意思決定に使いやすい日本語の要約にしてください。',
	clean:
		'以下の表データを確認し、表記ゆれ・欠損値・重複・形式不備の可能性を指摘してください。修正案も示してください。',
	transform:
		'以下の表データを、扱いやすいJSON配列に変換してください。値の意味を保ち、列名をキーにしてください。',
	custom: '',
};

function detectDelimiter(
	input: string,
	format: SpreadsheetInputFormat,
): ',' | '\t' {
	if (format === 'csv') return ',';
	if (format === 'tsv') return '\t';

	const firstLines = input
		.split(/\r?\n/)
		.filter((line) => line.trim().length > 0)
		.slice(0, 10);
	const tabCount = firstLines.reduce(
		(count, line) => count + (line.match(/\t/g)?.length ?? 0),
		0,
	);
	const commaCount = firstLines.reduce(
		(count, line) => count + (line.match(/,/g)?.length ?? 0),
		0,
	);

	return tabCount > commaCount ? '\t' : ',';
}

function parseDelimited(input: string, delimiter: ',' | '\t'): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let inQuotes = false;

	for (let index = 0; index < input.length; index += 1) {
		const char = input[index];
		const next = input[index + 1];

		if (char === '"') {
			if (inQuotes && next === '"') {
				cell += '"';
				index += 1;
			} else {
				inQuotes = !inQuotes;
			}
			continue;
		}

		if (!inQuotes && char === delimiter) {
			row.push(cell);
			cell = '';
			continue;
		}

		if (!inQuotes && (char === '\n' || char === '\r')) {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
			if (char === '\r' && next === '\n') index += 1;
			continue;
		}

		cell += char;
	}

	if (cell.length > 0 || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}

	return rows.filter((cells) => cells.some((value) => value.trim().length > 0));
}

function escapeMarkdownCell(value: string): string {
	return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
}

function toMarkdownTable(rows: string[][]): string {
	if (rows.length === 0) return '';
	const columnCount = Math.max(...rows.map((row) => row.length));
	const normalized = rows.map((row) =>
		Array.from({ length: columnCount }, (_, index) =>
			escapeMarkdownCell(row[index] ?? ''),
		),
	);
	const header = normalized[0].map((value, index) => value || `列${index + 1}`);
	const separator = Array.from({ length: columnCount }, () => '---');
	const body = normalized.slice(1);
	return [header, separator, ...body]
		.map((row) => `| ${row.join(' | ')} |`)
		.join('\n');
}

export function generateSpreadsheetPrompt({
	input,
	format,
	task,
	customInstruction,
	maxRows,
}: SpreadsheetPromptOptions): SpreadsheetPromptResult {
	const trimmedInput = input.trim();
	if (!trimmedInput) {
		return {
			prompt: '',
			detectedDelimiter: format === 'tsv' ? '\t' : ',',
			rowCount: 0,
			columnCount: 0,
			includedRows: 0,
			truncated: false,
			warnings: ['表データを入力してください。'],
		};
	}

	const detectedDelimiter = detectDelimiter(trimmedInput, format);
	const rows = parseDelimited(trimmedInput, detectedDelimiter);
	const rowCount = rows.length;
	const columnCount =
		rows.length > 0 ? Math.max(...rows.map((row) => row.length)) : 0;
	const safeMaxRows = Math.max(2, Math.min(maxRows, 200));
	const includedRows = Math.min(rowCount, safeMaxRows);
	const includedRowsData = rows.slice(0, includedRows);
	const truncated = rowCount > includedRows;
	const warnings: string[] = [];

	if (truncated) {
		warnings.push(
			`入力は${rowCount}行あります。プロンプトには先頭${includedRows}行のみ含めています。`,
		);
	}
	if (columnCount >= 12) {
		warnings.push(
			'列数が多いため、AIには分析観点を具体的に指定すると精度が上がります。',
		);
	}

	const instruction =
		task === 'custom'
			? customInstruction?.trim() ||
				'以下の表データを確認し、必要な処理を日本語で実行してください。'
			: TASK_INSTRUCTIONS[task];
	const delimiterLabel =
		detectedDelimiter === '\t' ? 'TSV/Excel貼り付け' : 'CSV';
	const omittedLine = truncated
		? `\n※元データは${rowCount}行です。長すぎるため、ここでは先頭${includedRows}行のみ共有します。必要なら追加行を分割して送ります。`
		: '';

	return {
		prompt: `${instruction}\n\n# 前提\n- データ形式: ${delimiterLabel}\n- 行数: ${rowCount}行\n- 列数: ${columnCount}列${omittedLine}\n\n# 表データ\n${toMarkdownTable(includedRowsData)}\n\n# 出力条件\n- 日本語で回答してください。\n- 推測した点は「推測」と明記してください。\n- 不明点や追加で必要な列があれば最後に確認事項として列挙してください。`,
		detectedDelimiter,
		rowCount,
		columnCount,
		includedRows,
		truncated,
		warnings,
	};
}
