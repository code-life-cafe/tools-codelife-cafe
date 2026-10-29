import Papa from 'papaparse';
import { exceedsMaxCharacters } from '../string-length.ts';
import { exportCsv, getColumnLabel } from './csv-editor.ts';
import { type Column, type FilterOperator, queryRows } from './table-query.ts';

export const MAX_CSV_QUERY_TEXT = 100_000;
export const MAX_CSV_QUERY_VALUE = 1_000;
export const MAX_CSV_QUERY_ROWS = 1_000;
export const MAX_CSV_QUERY_COLUMNS = 50;
export const MAX_CSV_QUERY_CELLS = 20_000;
export const MAX_CSV_QUERY_OUTPUT_BYTES = 1024 * 1024;
export const CSV_QUERY_COLUMN_LABELS = [
	'',
	...Array.from({ length: MAX_CSV_QUERY_COLUMNS }, (_, i) => getColumnLabel(i)),
];
export const CSV_QUERY_OPERATORS = [
	'none',
	'eq',
	'neq',
	'contains',
	'notContains',
	'startsWith',
	'endsWith',
	'gt',
	'gte',
	'lt',
	'lte',
	'empty',
	'notEmpty',
] as const;
export const CSV_QUERY_ERRORS = {
	options: '抽出・並べ替えの条件の組合せが正しくありません。',
	syntax: 'CSVの形式が正しくありません。引用符や区切りを確認してください。',
	limit: '入力データが処理上限を超えています。',
	column: '指定した列が入力データに存在しません。',
	numeric: '数値として比較できない値が含まれています。',
	output: '処理結果のサイズが上限を超えています。入力を短くしてください。',
	unknown: 'CSV処理に失敗しました。入力と条件を確認してください。',
} as const;
export interface CsvQueryInput {
	text: string;
	format: 'csv' | 'tsv';
	hasHeader: boolean;
	filterColumn: string;
	filterOperator: (typeof CSV_QUERY_OPERATORS)[number];
	filterCompare: 'text' | 'number';
	filterValue: string;
	sortColumn: string;
	sortDirection: 'asc' | 'desc';
	sortCompare: 'text' | 'number';
}
export interface CsvQueryOutput {
	result: string;
	inputRows: number;
	outputRows: number;
	columns: number;
}
function validateOptions(input: CsvQueryInput) {
	const {
		filterColumn,
		filterOperator,
		filterCompare,
		filterValue,
		sortColumn,
		sortDirection,
		sortCompare,
	} = input;
	const numericOps = ['gt', 'gte', 'lt', 'lte'];
	const textOps = ['contains', 'notContains', 'startsWith', 'endsWith'];
	const emptyOp = filterOperator === 'empty' || filterOperator === 'notEmpty';
	if (
		(!filterColumn &&
			(filterOperator !== 'none' ||
				filterCompare !== 'text' ||
				filterValue !== '')) ||
		(filterColumn && filterOperator === 'none') ||
		(!sortColumn && (sortDirection !== 'asc' || sortCompare !== 'text')) ||
		(numericOps.includes(filterOperator) && filterCompare !== 'number') ||
		(textOps.includes(filterOperator) &&
			(filterCompare !== 'text' || filterValue === '')) ||
		(emptyOp && filterValue !== '') ||
		(filterColumn !== '' &&
			filterColumn === sortColumn &&
			filterCompare !== sortCompare)
	)
		throw Error(CSV_QUERY_ERRORS.options);
}
// 型を明示するquery_csvは、自動型推定用の厳密パーサとは別に従来の入力契約を保持する。
function parseQueryNumber(value: string | number | undefined): number | null {
	if (value === undefined || value === null) return null;
	if (typeof value === 'number') return Number.isNaN(value) ? null : value;
	let str = String(value).trim();
	if (!str) return null;
	str = str.replace(/[０-９]/g, (ch) =>
		String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
	);
	str = str.replace(/[¥￥$,]/g, '').trim();
	const number = Number(str);
	return Number.isNaN(number) ? null : number;
}
function checkedNumber(value: string) {
	const number = parseQueryNumber(value);
	if (
		number === null ||
		!Number.isFinite(number) ||
		Math.abs(number) > Number.MAX_SAFE_INTEGER
	)
		throw Error(CSV_QUERY_ERRORS.numeric);
}
/** API専用adapter。通常UI・共有関数・入力セルの文字列を変更しない。 */
export function queryCsv(input: CsvQueryInput): CsvQueryOutput {
	if (
		exceedsMaxCharacters(input.text, MAX_CSV_QUERY_TEXT) ||
		exceedsMaxCharacters(input.filterValue, MAX_CSV_QUERY_VALUE)
	)
		throw Error(CSV_QUERY_ERRORS.limit);
	validateOptions(input);
	const delimiter = input.format === 'tsv' ? '\t' : ',';
	const parsed = !input.text.trim()
		? { data: [] as string[][], errors: [] }
		: Papa.parse<string[]>(input.text, {
				delimiter,
				download: false,
				dynamicTyping: false,
				header: false,
				skipEmptyLines: false,
			});
	// 構文全体を先に評価。壊れた入力の部分結果は公開しない。
	if (parsed.errors.length) throw Error(CSV_QUERY_ERRORS.syntax);
	const width = parsed.data.reduce((max, row) => Math.max(max, row.length), 0);
	const inputRows = Math.max(0, parsed.data.length - (input.hasHeader ? 1 : 0));
	if (
		inputRows > MAX_CSV_QUERY_ROWS ||
		width > MAX_CSV_QUERY_COLUMNS ||
		parsed.data.length * width > MAX_CSV_QUERY_CELLS
	)
		throw Error(CSV_QUERY_ERRORS.limit);
	const filterIndex = CSV_QUERY_COLUMN_LABELS.indexOf(input.filterColumn) - 1;
	const sortIndex = CSV_QUERY_COLUMN_LABELS.indexOf(input.sortColumn) - 1;
	if (
		(input.filterColumn && (filterIndex < 0 || filterIndex >= width)) ||
		(input.sortColumn && (sortIndex < 0 || sortIndex >= width))
	)
		throw Error(CSV_QUERY_ERRORS.column);
	const rows = parsed.data.map((row) =>
		Array.from({ length: width }, (_, i) => row[i] ?? ''),
	);
	const header = input.hasHeader && rows.length ? rows[0] : undefined;
	const data = header ? rows.slice(1) : rows;
	const columns: Column[] = Array.from({ length: width }, (_, i) => ({
		id: `c${i}`,
		name: getColumnLabel(i),
		type: 'text',
	}));
	if (filterIndex >= 0) columns[filterIndex].type = input.filterCompare;
	if (sortIndex >= 0) columns[sortIndex].type = input.sortCompare;
	// フィルタで隠れる行も含め、数値対象列を先に検証する。
	for (let col = 0; col < width; col++)
		if (columns[col].type === 'number')
			for (const row of data) if (row[col] !== '') checkedNumber(row[col]);
	if (
		filterIndex >= 0 &&
		input.filterCompare === 'number' &&
		input.filterOperator !== 'empty' &&
		input.filterOperator !== 'notEmpty'
	)
		checkedNumber(input.filterValue);
	const indices = queryRows(data, columns, {
		parseNumeric: parseQueryNumber,
		filter:
			filterIndex < 0
				? undefined
				: {
						combinator: 'and',
						conditions: [
							{
								columnId: `c${filterIndex}`,
								operator: input.filterOperator as FilterOperator,
								value: input.filterValue,
							},
						],
					},
		sortKeys:
			sortIndex < 0
				? undefined
				: [{ columnId: `c${sortIndex}`, direction: input.sortDirection }],
	});
	const outputRows = indices.map((i) => data[i]);
	return {
		result: exportCsv(
			{ rows: header ? [header, ...outputRows] : outputRows, colCount: width },
			delimiter,
		),
		inputRows,
		outputRows: outputRows.length,
		columns: width,
	};
}
