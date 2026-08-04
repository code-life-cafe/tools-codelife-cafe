import Papa from 'papaparse';

export interface CsvData {
	rows: string[][];
	colCount: number;
}

const VALID_DELIMITERS = [',', '\t', ';', '|'];

export interface CsvEditorSettings {
	delimiter: string;
	hasHeader: boolean;
}

// 共有URL/localStorage経由の復元値を検証し、不正値はデフォルトへフォールバックする
export function sanitizeCsvEditorSettings(
	value: unknown,
	defaults: CsvEditorSettings,
): CsvEditorSettings {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return defaults;
	}
	const v = value as Record<string, unknown>;
	const delimiter =
		typeof v.delimiter === 'string' && VALID_DELIMITERS.includes(v.delimiter)
			? v.delimiter
			: defaults.delimiter;
	const hasHeader =
		typeof v.hasHeader === 'boolean' ? v.hasHeader : defaults.hasHeader;
	return { delimiter, hasHeader };
}

// Excel-style column labels (A, B, ..., Z, AA, AB...)
export function getColumnLabel(index: number): string {
	let label = '';
	let i = index;
	while (i >= 0) {
		label = String.fromCharCode(65 + (i % 26)) + label;
		i = Math.floor(i / 26) - 1;
	}
	return label;
}

export function parseCsv(
	text: string,
	delimiter: string = ',',
): { data: CsvData; error?: string } {
	if (!text.trim()) {
		return { data: { rows: [], colCount: 0 } };
	}

	try {
		const results = Papa.parse<string[]>(text, {
			delimiter: delimiter,
			header: false,
			skipEmptyLines: false, // Keep all data
		});

		if (results.errors.length > 0 && results.data.length === 0) {
			return {
				data: { rows: [], colCount: 0 },
				error: results.errors[0].message,
			};
		}

		const rows = results.data;
		const maxCols = Math.max(...rows.map((r) => r.length), 1);

		// Normalize all rows to have exactly `maxCols` elements
		const normalizedRows = rows.map((r) => {
			if (r.length < maxCols) {
				return [...r, ...Array(maxCols - r.length).fill('')];
			}
			return r.slice(0, maxCols);
		});

		return {
			data: {
				rows: normalizedRows,
				colCount: maxCols,
			},
		};
	} catch (err: unknown) {
		return {
			data: { rows: [], colCount: 0 },
			error:
				err instanceof Error
					? err.message
					: String(err) || 'CSVの解析に失敗しました。',
		};
	}
}

export function exportCsv(data: CsvData, delimiter: string = ','): string {
	if (data.rows.length === 0) return '';
	return Papa.unparse(data.rows, { delimiter });
}
