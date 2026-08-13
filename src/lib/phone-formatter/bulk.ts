/**
 * 一括処理モジュール
 * 複数の電話番号をCSV形式で入力・変換・出力する
 */
import Papa from 'papaparse';
import { getNumberTypeLabel } from './classify.ts';
import { parsePhoneNumber } from './parse.ts';
import type { BulkResult, ParseResult } from './types.ts';

const MAX_BULK_ITEMS = 10000;

/**
 * 複数の電話番号文字列を一括でパースする
 *
 * @param inputs - 電話番号の配列
 * @param defaultCountry - デフォルト国コード（デフォルト: 'JP'）
 * @returns BulkResult
 * @throws Error - 10,000件超過の場合
 */
export function processBulk(
	inputs: string[],
	defaultCountry: string = 'JP',
): BulkResult {
	if (inputs.length > MAX_BULK_ITEMS) {
		throw new Error(
			`処理できる電話番号の上限は${MAX_BULK_ITEMS.toLocaleString()}件です。件数を減らしてから再度お試しください。`,
		);
	}

	const results: ParseResult[] = inputs
		.filter((input) => input.trim() !== '')
		.map((input) => parsePhoneNumber(input, defaultCountry));

	const validCount = results.filter((r) => r.valid).length;
	const invalidCount = results.filter((r) => !r.valid).length;

	return {
		results,
		summary: {
			total: results.length,
			valid: validCount,
			invalid: invalidCount,
		},
	};
}

/**
 * CSVテキストから特定カラムの電話番号を抽出する
 *
 * @param csvText - CSVのテキスト内容
 * @param columnIndex - 対象カラムのインデックス（0始まり）
 * @param hasHeader - ヘッダー行があるか
 * @returns 電話番号文字列の配列
 */
export function parseCsvColumn(
	csvText: string,
	columnIndex: number,
	hasHeader: boolean,
): string[] {
	const result = Papa.parse<string[]>(csvText, {
		header: false,
		skipEmptyLines: true,
	});

	const rows = result.data as string[][];
	const startRow = hasHeader ? 1 : 0;

	return rows
		.slice(startRow)
		.map((row) => row[columnIndex] ?? '')
		.filter((val) => val.trim() !== '');
}

/**
 * ParseResultの配列からCSV文字列を生成する
 * UTF-8 BOM付き（Excel対応）
 *
 * @param results - ParseResultの配列
 * @param includeColumns - 含めるカラム名の配列
 * @returns CSV文字列（BOM付きUTF-8）
 */
export function generateCsvOutput(
	results: ParseResult[],
	includeColumns: string[],
): string {
	type Row = Record<string, string>;

	const columnLabels: Record<string, string> = {
		input: '入力',
		e164: 'E.164',
		international: '国際表記',
		national: '国内表記',
		rfc3966: 'RFC3966',
		type: '種別',
		region: '地域',
		valid: '有効',
	};

	// ヘッダー行
	const headers = includeColumns.map((col) => columnLabels[col] ?? col);

	// データ行
	const rows = results.map((result): Row => {
		const row: Row = {};

		for (const col of includeColumns) {
			switch (col) {
				case 'input':
					row[columnLabels[col]] = result.input;
					break;
				case 'e164':
					row[columnLabels[col]] = result.formats?.e164 ?? '';
					break;
				case 'international':
					row[columnLabels[col]] = result.formats?.international ?? '';
					break;
				case 'national':
					row[columnLabels[col]] = result.formats?.national ?? '';
					break;
				case 'rfc3966':
					row[columnLabels[col]] = result.formats?.rfc3966 ?? '';
					break;
				case 'type':
					row[columnLabels[col]] = getNumberTypeLabel(result.numberType);
					break;
				case 'region':
					row[columnLabels[col]] = result.regionName ?? '';
					break;
				case 'valid':
					row[columnLabels[col]] = result.valid ? '有効' : '無効';
					break;
				default:
					row[columnLabels[col]] = '';
			}
		}

		return row;
	});

	// BOM付きCSV生成
	const csv = Papa.unparse({
		fields: headers,
		data: rows.map((row) => headers.map((h) => row[h] ?? '')),
	});
	return `\uFEFF${csv}`; // UTF-8 BOM
}
