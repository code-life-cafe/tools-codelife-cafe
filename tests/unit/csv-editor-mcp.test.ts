import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { csvEditorMcpTool } from '../../src/lib/tools/csv-editor.mcp.ts';
import {
	CSV_QUERY_ERRORS,
	MAX_CSV_QUERY_OUTPUT_BYTES,
} from '../../src/lib/tools/csv-editor-query.ts';
import { generateWebMcpDescriptor } from '../../src/lib/webmcp/descriptor-generator.ts';
import { mcpToolDefinitions } from '../../src/lib/webmcp/registry.ts';

const tool = generateWebMcpDescriptor(csvEditorMcpTool);
const properties = tool.inputSchema.properties as Record<
	string,
	{ maxLength?: number; enum?: string[] }
>;
async function run(input: Record<string, unknown>) {
	const r = await tool.run({ hasHeader: false, ...input });
	assert.ok(r.ok, r.ok ? '' : r.error);
	return r.value;
}
async function error(input: Record<string, unknown>, message: string) {
	assert.deepEqual(await tool.run({ hasHeader: false, ...input }), {
		ok: false,
		error: message,
	});
}
test('単一ソースschema・defaults・registry・注釈', () => {
	assert.equal(tool.name, 'query_csv');
	assert.deepEqual(tool.inputSchema.required, ['text', 'hasHeader']);
	assert.equal(properties.text.maxLength, 100000);
	assert.equal(properties.filterValue.maxLength, 1000);
	assert.deepEqual(properties.filterColumn.enum, properties.sortColumn.enum);
	assert.equal(properties.filterColumn.enum?.length, 51);
	assert.equal(properties.filterColumn.enum?.at(-1), 'AX');
	assert.equal(
		mcpToolDefinitions.filter((t) => t.name === 'query_csv').length,
		1,
	);
	assert.deepEqual(tool.annotations, {
		readOnlyHint: true,
		untrustedContentHint: true,
	});
	assert.deepEqual(tool.outputSchema?.required, [
		'result',
		'inputRows',
		'outputRows',
		'columns',
	]);
});
test('承認例:ヘッダー除外・数値抽出/降順・ID保持', async () => {
	assert.deepEqual(
		await run({
			text: 'ID,金額\n001,90\n010,120\n002,150',
			hasHeader: true,
			filterColumn: 'B',
			filterOperator: 'gte',
			filterCompare: 'number',
			filterValue: '100',
			sortColumn: 'B',
			sortDirection: 'desc',
			sortCompare: 'number',
		}),
		{
			result: 'ID,金額\r\n002,150\r\n010,120',
			inputRows: 3,
			outputRows: 2,
			columns: 2,
		},
	);
});
test('文字列全演算子・大小/空白・先頭ゼロを区別', async () => {
	const cases: Array<[string, string, string]> = [
		['eq', '001', '001'],
		['neq', '001', '010\r\nA\r\n" a "'],
		['contains', '0', '001\r\n010'],
		['notContains', '0', 'A\r\n" a "'],
		['startsWith', '00', '001'],
		['endsWith', '10', '010'],
		['eq', 'a', ''],
		['eq', ' a ', '" a "'],
	];
	for (const [filterOperator, filterValue, result] of cases)
		assert.equal(
			(
				await run({
					text: '001\n010\nA\n a ',
					filterColumn: 'A',
					filterOperator,
					filterValue,
				})
			).result,
			result,
		);
});
test('文字列検索4演算子は未指定・空文字の検索値を拒否する', async (t) => {
	for (const filterOperator of [
		'contains',
		'notContains',
		'startsWith',
		'endsWith',
	])
		for (const value of [{}, { filterValue: '' }])
			await t.test(
				`${filterOperator}: ${'filterValue' in value ? '空文字' : '未指定'}`,
				async () => {
					await error(
						{
							text: 'id,value\n1,alpha\n2, beta \n3, ',
							hasHeader: true,
							filterColumn: 'B',
							filterOperator,
							...value,
						},
						CSV_QUERY_ERRORS.options,
					);
				},
			);
});
test('文字列検索は通常値と空白1文字をtrimせず比較する', async () => {
	for (const [filterOperator, value, expectedIds] of [
		['contains', 'a', ['1', '2']],
		['notContains', 'a', ['3']],
		['startsWith', 'a', ['1']],
		['endsWith', 'a', ['1']],
		['contains', ' ', ['2', '3']],
		['notContains', ' ', ['1']],
		['startsWith', ' ', ['2', '3']],
		['endsWith', ' ', ['2', '3']],
	] as const) {
		const output = await run({
			text: 'id,value\n1,alpha\n2, beta \n3, ',
			hasHeader: true,
			filterColumn: 'B',
			filterOperator,
			filterValue: value,
		});
		assert.deepEqual(
			output.result
				.split('\r\n')
				.slice(1)
				.map((row) => row.split(',')[0]),
			expectedIds,
		);
	}
});
test('text eq/neqは未指定・空文字の比較値を引き続き許可する', async () => {
	for (const [filterOperator, expected] of [
		['eq', 'id,value\r\nblank,'],
		['neq', 'id,value\r\nfull,x'],
	] as const)
		for (const value of [{}, { filterValue: '' }])
			assert.equal(
				(
					await run({
						text: 'id,value\nblank,\nfull,x',
						hasHeader: true,
						filterColumn: 'B',
						filterOperator,
						...value,
					})
				).result,
				expected,
			);
});
test('数値全演算子・表記を保持・空セルneqも不一致', async () => {
	for (const [filterOperator, expected] of [
		['eq', '2'],
		['neq', '1\r\n3'],
		['gt', '3'],
		['gte', '2\r\n3'],
		['lt', '1'],
		['lte', '1\r\n2'],
	] as const)
		assert.equal(
			(
				await run({
					text: '1,x\n2,y\n3,z\n,w',
					filterColumn: 'A',
					filterOperator,
					filterCompare: 'number',
					filterValue: '2',
				})
			).result
				.split('\r\n')
				.filter(Boolean)
				.map((r) => r.split(',')[0])
				.join('\r\n'),
			expected,
		);
	assert.equal(
		(
			await run({
				text: '"¥1,000"\n２\n-3.5\n１２．５\n－７',
				sortColumn: 'A',
				sortCompare: 'number',
			})
		).result,
		'－７\r\n-3.5\r\n２\r\n１２．５\r\n"¥1,000"',
	);
	// 16進・指数表記は数値として扱わない（Issue: CSVエディタ列型推定の誤判定修正）
	for (const text of ['1\n0x10', '1\n1e2'])
		await error(
			{ text, sortColumn: 'A', sortCompare: 'number' },
			'数値として比較できない値が含まれています。',
		);
});
test('空セル・数値空位置・同値安定ソート', async () => {
	const text = 'ID,値\na,2\nb,\nc,02\nd,1\ne,';
	assert.equal(
		(
			await run({
				text,
				hasHeader: true,
				sortColumn: 'B',
				sortCompare: 'number',
			})
		).result,
		'ID,値\r\nd,1\r\na,2\r\nc,02\r\nb,\r\ne,',
	);
	assert.equal(
		(
			await run({
				text,
				hasHeader: true,
				sortColumn: 'B',
				sortCompare: 'number',
				sortDirection: 'desc',
			})
		).result,
		'ID,値\r\nb,\r\ne,\r\na,2\r\nc,02\r\nd,1',
	);
	for (const [filterOperator, ids] of [
		['empty', 'b,e'],
		['notEmpty', 'a,c,d'],
	] as const)
		assert.equal(
			(
				await run({ text, hasHeader: true, filterColumn: 'B', filterOperator })
			).result
				.split('\r\n')
				.slice(1)
				.map((r) => r.split(',')[0])
				.join(','),
			ids,
		);
	assert.equal(
		(await run({ text: 'a,1\nA,2\nａ,3', sortColumn: 'A' })).result,
		'a,1\r\nA,2\r\nａ,3',
	);
});
test('CSV/TSV・引用符内改行・BOM・ヘッダー/空行/不均一行', async () => {
	assert.deepEqual(
		await run({
			text: '\ufeffID\t備考\n001\t"a\tb\n日本語😀"',
			format: 'tsv',
			hasHeader: true,
		}),
		{
			result: 'ID\t備考\r\n001\t"a\tb\n日本語😀"',
			inputRows: 1,
			outputRows: 1,
			columns: 2,
		},
	);
	assert.equal(
		(await run({ text: 'x,"a""b"\r\ny\r\n' })).result,
		'x,"a""b"\r\ny,\r\n,',
	);
	assert.deepEqual(await run({ text: 'H,H,', hasHeader: true }), {
		result: 'H,H,',
		inputRows: 0,
		outputRows: 0,
		columns: 3,
	});
	for (const text of ['', ' \t\r\n　'])
		for (const hasHeader of [true, false])
			assert.deepEqual(await run({ text, hasHeader }), {
				result: '',
				inputRows: 0,
				outputRows: 0,
				columns: 0,
			});
	assert.equal(
		(await run({ text: '=1+1,+2,-3,@x,<img src=x>' })).result,
		'=1+1,+2,-3,@x,<img src=x>',
	);
});
test('操作組合せ・数値異常・欠落/型/enumを拒否', async () => {
	for (const options of [
		{ filterColumn: 'A' },
		{ filterOperator: 'eq' },
		{ filterValue: 'x' },
		{ filterCompare: 'number' },
		{ sortDirection: 'desc' },
		{ sortCompare: 'number' },
		{ filterColumn: 'A', filterOperator: 'contains', filterCompare: 'number' },
		{ filterColumn: 'A', filterOperator: 'gt', filterValue: '1' },
		{ filterColumn: 'A', filterOperator: 'empty', filterValue: 'x' },
		{
			filterColumn: 'A',
			filterOperator: 'eq',
			sortColumn: 'A',
			sortCompare: 'number',
		},
	])
		await error({ text: '1', ...options }, CSV_QUERY_ERRORS.options);
	for (const cell of [
		'oops',
		'NaN',
		'Infinity',
		'-Infinity',
		'9007199254740992',
		' ',
	])
		await error(
			{ text: `${cell},x`, sortColumn: 'A', sortCompare: 'number' },
			CSV_QUERY_ERRORS.numeric,
		);
	for (const filterValue of ['oops', 'Infinity', '9007199254740992', ''])
		await error(
			{
				text: '1',
				filterColumn: 'A',
				filterOperator: 'eq',
				filterCompare: 'number',
				filterValue,
			},
			CSV_QUERY_ERRORS.numeric,
		);
	for (const input of [
		null,
		[],
		{},
		{ text: 'a' },
		{ text: 1, hasHeader: false },
		{ text: 'a', hasHeader: 'false' },
		{ text: 'a', hasHeader: false, format: 'auto' },
		{ text: 'a', hasHeader: false, filterColumn: 'AY' },
		{ text: 'a', hasHeader: false, filterColumn: 0 },
		{ text: 'a', hasHeader: false, filterOperator: 'between' },
	])
		assert.equal((await tool.run(input)).ok, false);
});
test('本文/条件値コードポイント境界と空白上限', async () => {
	assert.equal((await run({ text: '😀'.repeat(100000) })).inputRows, 1);
	for (const text of ['😀'.repeat(100001), ' '.repeat(100001)])
		assert.equal((await tool.run({ text, hasHeader: false })).ok, false);
	assert.equal(
		(
			await run({
				text: '😀'.repeat(1000),
				filterColumn: 'A',
				filterOperator: 'eq',
				filterValue: '😀'.repeat(1000),
			})
		).outputRows,
		1,
	);
	assert.equal(
		(
			await tool.run({
				text: 'a',
				hasHeader: false,
				filterValue: 'a'.repeat(1001),
			})
		).ok,
		false,
	);
});
test('行/列/パディングセル境界、列存在、エラー優先順位', async () => {
	assert.equal(
		(await run({ text: Array(1000).fill('x').join('\n') })).inputRows,
		1000,
	);
	await error(
		{ text: Array(1001).fill('x').join('\n') },
		CSV_QUERY_ERRORS.limit,
	);
	assert.equal(
		(
			await run({
				text: `H\n${Array(1000).fill('x').join('\n')}`,
				hasHeader: true,
			})
		).inputRows,
		1000,
	);
	assert.equal(
		(await run({ text: Array(50).fill('x').join(','), sortColumn: 'AX' }))
			.columns,
		50,
	);
	await error({ text: Array(51).fill('x').join(',') }, CSV_QUERY_ERRORS.limit);
	assert.equal(
		(
			await run({
				text: Array(400).fill(Array(50).fill('x').join(',')).join('\n'),
			})
		).inputRows,
		400,
	);
	await error(
		{ text: Array(401).fill(Array(50).fill('x').join(',')).join('\n') },
		CSV_QUERY_ERRORS.limit,
	);
	// 生セル20001個。不均一行を補完すると21000セルとなる。
	await error(
		{
			text: [
				Array(21).fill('x').join(','),
				...Array(999).fill(Array(20).fill('x').join(',')),
			].join('\n'),
		},
		CSV_QUERY_ERRORS.limit,
	);
	await error({ text: 'x', sortColumn: 'B' }, CSV_QUERY_ERRORS.column);
	await error(
		{ text: '', filterColumn: 'A', filterOperator: 'eq' },
		CSV_QUERY_ERRORS.column,
	);
	await error(
		{ text: 'a,b\n"unterminated', sortColumn: 'AX' },
		CSV_QUERY_ERRORS.syntax,
	);
	await error(
		{ text: `${Array(1001).fill('x').join('\n')}\n"unterminated` },
		CSV_QUERY_ERRORS.syntax,
	);
	await error(
		{ text: '"unterminated', filterColumn: 'A' },
		CSV_QUERY_ERRORS.options,
	);
});
test('CSVエラーは部分結果・原文・parser messageを返さない', async () => {
	await error({ text: 'a,b\n"PRIVATE_PROBE' }, CSV_QUERY_ERRORS.syntax);
});
test('出力JSON予算の境界と未知例外を故障注入し必ず復元', async () => {
	const budget = mock.method(
		TextEncoder.prototype,
		'encode',
		() => new Uint8Array(MAX_CSV_QUERY_OUTPUT_BYTES),
	);
	try {
		assert.equal((await tool.run({ text: 'a', hasHeader: false })).ok, true);
	} finally {
		budget.mock.restore();
	}
	const big = mock.method(
		TextEncoder.prototype,
		'encode',
		() => new Uint8Array(MAX_CSV_QUERY_OUTPUT_BYTES + 1),
	);
	try {
		await error({ text: 'a' }, CSV_QUERY_ERRORS.output);
	} finally {
		big.mock.restore();
	}
	const broken = mock.method(TextEncoder.prototype, 'encode', () => {
		throw Error('PRIVATE_STACK');
	});
	try {
		await error({ text: 'a' }, CSV_QUERY_ERRORS.unknown);
	} finally {
		broken.mock.restore();
	}
	assert.equal((await run({ text: 'a' })).result, 'a');
});

test('ヘッダーもセル予算に含み、隠れる数値不正も先に拒否', async () => {
	const row = Array(50).fill('x').join(',');
	assert.equal(
		(await run({ text: Array(400).fill(row).join('\n'), hasHeader: true }))
			.inputRows,
		399,
	);
	await error(
		{ text: Array(401).fill(row).join('\n'), hasHeader: true },
		CSV_QUERY_ERRORS.limit,
	);
	await error(
		{
			text: 'keep,1\nhide,Infinity',
			filterColumn: 'A',
			filterOperator: 'eq',
			filterValue: 'keep',
			sortColumn: 'B',
			sortCompare: 'number',
		},
		CSV_QUERY_ERRORS.numeric,
	);
	assert.equal(
		(
			await run({
				text: ',x\na,y',
				filterColumn: 'A',
				filterOperator: 'eq',
				filterValue: '',
			})
		).result,
		',x',
	);
});

test('文字列降順の照合順と同値安定性・数値型の空セル抽出', async () => {
	assert.equal(
		(
			await run({
				text: 'a,1\nA,2\nａ,3\nb,4',
				sortColumn: 'A',
				sortCompare: 'text',
				sortDirection: 'desc',
			})
		).result,
		'b,4\r\na,1\r\nA,2\r\nａ,3',
	);
	for (const [filterOperator, result] of [
		['empty', 'b,'],
		['notEmpty', 'a,2\r\nc,1'],
	] as const) {
		assert.equal(
			(
				await run({
					text: 'a,2\nb,\nc,1',
					filterColumn: 'B',
					filterOperator,
					filterCompare: 'number',
				})
			).result,
			result,
		);
		await error(
			{
				text: 'a,bad\nb,',
				filterColumn: 'B',
				filterOperator,
				filterCompare: 'number',
			},
			CSV_QUERY_ERRORS.numeric,
		);
	}
});

test('descriptorはnumber比較で拒否する16進・指数表記の対応を約束しない', () => {
	assert.ok(!tool.description.includes('指数/16進'));
	assert.match(tool.description, /指数表記.*エラー/);
});
