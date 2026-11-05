import Papa from 'papaparse';

export interface CsvData {
	rows: string[][];
	colCount: number;
}

export type CsvTextEncoding = 'utf-8' | 'shift-jis' | 'utf-16le' | 'utf-16be';

/** BOMを優先し、BOMなしでは厳密UTF-8、Shift-JISの順に試し、両方不正ならnullを返す。 */
export function decodeCsvBytes(
	bytes: Uint8Array,
	encoding: CsvTextEncoding | 'auto' = 'auto',
): string | null {
	const decode = (label: CsvTextEncoding) => {
		try {
			return new TextDecoder(label, { fatal: true }).decode(bytes);
		} catch {
			throw new Error(
				'指定した文字コードで読み込めません。文字コードまたはファイルを確認してください。',
			);
		}
	};
	if (encoding !== 'auto') return decode(encoding);
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
		return decode('utf-8');
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return decode('utf-16le');
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return decode('utf-16be');

	for (const label of ['utf-8', 'shift-jis'] as const) {
		try {
			return decode(label);
		} catch {
			// 不正なバイトを置換文字へ変換せず、次の文字コードを試す。
		}
	}
	return null;
}

export function exportCsvJson(data: CsvData, hasHeader: boolean): string {
	if (hasHeader && data.rows.length > 1) {
		const headers = data.rows[0].map((h, i) => h || `Column${i + 1}`);
		if (new Set(headers).size !== headers.length) {
			throw new Error(
				'ヘッダーが重複しているためJSONを保存できません。列名を変更するか、CSVで保存してください。',
			);
		}
		const jsonArray = data.rows
			.slice(1)
			.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
		return JSON.stringify(jsonArray, null, 2);
	}
	return JSON.stringify(data.rows, null, 2);
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
