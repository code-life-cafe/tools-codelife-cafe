import { defineMcpTool } from '../webmcp/define-tool.ts';
import {
	CSV_QUERY_COLUMN_LABELS,
	CSV_QUERY_ERRORS,
	CSV_QUERY_OPERATORS,
	type CsvQueryInput,
	type CsvQueryOutput,
	MAX_CSV_QUERY_OUTPUT_BYTES,
	MAX_CSV_QUERY_TEXT,
	MAX_CSV_QUERY_VALUE,
	queryCsv,
} from './csv-editor-query.ts';

export const csvEditorMcpTool = defineMcpTool<CsvQueryInput, CsvQueryOutput>({
	toolId: 'csv-editor',
	name: 'query_csv',
	description:
		'Filter and stably sort CSV/TSV locally without changing the page UI. / CSV/TSVを1条件で抽出し1列で安定ソート。本文100000 Unicodeコードポイント、データ1000行（ヘッダー別枠1）、50列、補完後20000セル（ヘッダー込み）、成功JSON UTF-8 1MiB。超過は省略せずエラー。列は物理位置A〜AX、型推定せずtext/numberを明示。空白本文は空テーブル、不均一行は空セル補完、空行/末尾改行は維持。ヘッダーは条件対象外。textフィルタは大小/前後空白を区別、textソートは日本語natural/case-insensitiveで同値は元順序。numberは全角数字・全角小数点・全角符号/通貨/カンマを既存UI同様に解釈する10進のみの倍精度比較（厳密十進ではない）。16進・2進・8進・Infinity・指数表記（1e2等）は数値として扱わずエラー。非空の数値対象セルは有限かつ絶対値MAX_SAFE_INTEGER以内を要求。数値空セルはneqを含め比較不一致、ソートasc末尾/desc先頭。構文エラーは部分結果を返さない。通常UIの自動型推定/寛容パースとは異なる場合がある。結果はAIへ返す未信頼データで、式/HTMLを実行せず、通信・保存・ログ・計測やUI更新を追加しない。',
	params: {
		text: {
			type: 'string',
			description: 'CSV/TSV本文。空文字可。最大100000コードポイント。',
			maxLength: MAX_CSV_QUERY_TEXT,
		},
		format: {
			type: 'string',
			enum: ['csv', 'tsv'],
			required: false,
			default: 'csv',
			description: 'csv=カンマ、tsv=タブ。自動判定しない。',
		},
		hasHeader: {
			type: 'boolean',
			description: '先頭行を保持し、抽出/ソート対象から除くか。必須。',
		},
		filterColumn: {
			type: 'string',
			enum: CSV_QUERY_COLUMN_LABELS,
			required: false,
			default: '',
			description: '抽出列の物理位置A〜AX。空文字は無効。実在する列だけ指定。',
		},
		filterOperator: {
			type: 'string',
			enum: CSV_QUERY_OPERATORS,
			required: false,
			default: 'none',
			description:
				'1条件。gt/gte/lt/lteはnumberのみ、contains/notContains/startsWith/endsWithはtextのみ。empty/notEmptyは厳密な空セル。',
		},
		filterCompare: {
			type: 'string',
			enum: ['text', 'number'],
			required: false,
			default: 'text',
			description:
				'抽出の比較方式。型推定しない。同じ列をソートする場合sortCompareと一致が必要。',
		},
		filterValue: {
			type: 'string',
			required: false,
			default: '',
			maxLength: MAX_CSV_QUERY_VALUE,
			description:
				'比較値1000コードポイント。textのeq/neqは空文字も有効。empty/notEmptyは空文字のみ。無効な抽出はcolumn空/operator none/compare text/value空の組のみ。',
		},
		sortColumn: {
			type: 'string',
			enum: CSV_QUERY_COLUMN_LABELS,
			required: false,
			default: '',
			description:
				'並べ替え列A〜AX、空なら元順序。無効時はdirection asc/compare textのみ。',
		},
		sortDirection: {
			type: 'string',
			enum: ['asc', 'desc'],
			required: false,
			default: 'asc',
			description: '昇順/降順。同値は元順序。',
		},
		sortCompare: {
			type: 'string',
			enum: ['text', 'number'],
			required: false,
			default: 'text',
			description: 'ソートの比較方式。型推定しない。',
		},
	},
	returns: {
		result: {
			type: 'string',
			description:
				'同じ区切りのCSV/TSV。ヘッダー保持。式/HTMLとして実行しない。',
		},
		inputRows: {
			type: 'number',
			description: 'ヘッダーを除く入力データ行数。',
		},
		outputRows: { type: 'number', description: 'ヘッダーを除く抽出後行数。' },
		columns: { type: 'number', description: '空セル補完後の列数。' },
	},
	annotations: { readOnlyHint: true, untrustedContentHint: true },
	handler(input) {
		try {
			const output = queryCsv(input);
			if (
				new TextEncoder().encode(JSON.stringify(output)).byteLength >
				MAX_CSV_QUERY_OUTPUT_BYTES
			)
				throw Error(CSV_QUERY_ERRORS.output);
			return output;
		} catch (error) {
			const message =
				error instanceof Error &&
				(Object.values(CSV_QUERY_ERRORS) as string[]).includes(error.message)
					? error.message
					: CSV_QUERY_ERRORS.unknown;
			throw Error(message);
		}
	},
});
