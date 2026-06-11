// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/zipcode.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	bulkConvert,
	createZipLookup,
	extractZipsFromLines,
	type FetchChunk,
	formatAddress,
	lookupZip,
	normalizeZip,
	type ZipRecord,
} from '../../src/lib/tools/zipcode.ts';

const DATA: Record<string, ZipRecord[]> = {
	'10': [
		['1000001', '東京都', '千代田区', '千代田'],
		['1000002', '東京都', '千代田区', '皇居外苑'],
		['1000002', '東京都', '千代田区', '丸の内'],
	],
	'06': [['0600000', '北海道', '札幌市中央区', '']],
	'99': [],
};

function makeFetch(): { fetchChunk: FetchChunk; calls: string[] } {
	const calls: string[] = [];
	const fetchChunk: FetchChunk = async (prefix) => {
		calls.push(prefix);
		if (prefix === '50') throw new Error('network');
		return DATA[prefix] ?? [];
	};
	return { fetchChunk, calls };
}

// ---------------------------------------------------------------------------
// normalizeZip
// ---------------------------------------------------------------------------

test('normalizeZip: ハイフン有無・全角・〒・空白を吸収', () => {
	assert.equal(normalizeZip('100-0001'), '1000001');
	assert.equal(normalizeZip('1000001'), '1000001');
	assert.equal(normalizeZip('１０００００１'), '1000001'); // 全角数字
	assert.equal(normalizeZip('１００－０００１'), '1000001'); // 全角ハイフン
	assert.equal(normalizeZip('〒100-0001'), '1000001');
	assert.equal(normalizeZip('100 0001'), '1000001');
	assert.equal(normalizeZip('  100ー0001 '), '1000001'); // 長音記号
});

test('normalizeZip: 先頭ゼロを文字列のまま保持', () => {
	assert.equal(normalizeZip('060-0000'), '0600000');
	assert.equal(normalizeZip('0600000'), '0600000');
});

test('normalizeZip: 不正入力は null', () => {
	assert.equal(normalizeZip(''), null);
	assert.equal(normalizeZip('123'), null);
	assert.equal(normalizeZip('12345678'), null);
	assert.equal(normalizeZip('abcdefg'), null);
	assert.equal(normalizeZip('100-000a'), null);
});

// ---------------------------------------------------------------------------
// extractZipsFromLines
// ---------------------------------------------------------------------------

test('extractZipsFromLines: 1行1件で抽出（空行・余分な文字も処理）', () => {
	const result = extractZipsFromLines(
		'100-0001\n0600000\n〒100-0001 東京\n不明\n',
	);
	assert.deepEqual(
		result.map((r) => r.zip),
		['1000001', '0600000', '1000001', null, null],
	);
});

// ---------------------------------------------------------------------------
// lookupZip / createZipLookup（キャッシュ）
// ---------------------------------------------------------------------------

test('lookupZip: 単一該当を返す', async () => {
	const { fetchChunk } = makeFetch();
	const records = await lookupZip('1000001', fetchChunk);
	assert.equal(records.length, 1);
	assert.deepEqual(records[0], ['1000001', '東京都', '千代田区', '千代田']);
});

test('lookupZip: 複数町域該当で全候補を返す', async () => {
	const { fetchChunk } = makeFetch();
	const records = await lookupZip('1000002', fetchChunk);
	assert.equal(records.length, 2);
	assert.deepEqual(
		records.map((r) => r[3]),
		['皇居外苑', '丸の内'],
	);
});

test('lookupZip: 先頭ゼロの郵便番号も正しいチャンクで解決', async () => {
	const { fetchChunk, calls } = makeFetch();
	const records = await lookupZip('0600000', fetchChunk);
	assert.equal(calls[0], '06', '上2桁チャンク 06 を取得');
	assert.equal(records.length, 1);
	assert.equal(records[0][1], '北海道');
});

test('createZipLookup: 同一チャンクは2回目以降fetchしない', async () => {
	const { fetchChunk, calls } = makeFetch();
	const lookup = createZipLookup(fetchChunk);
	await lookup.lookup('1000001');
	await lookup.lookup('1000002'); // 同じ '10' チャンク
	await lookup.lookup('1000001');
	assert.deepEqual(calls, ['10'], 'fetch は 10 を1回のみ');
});

test('lookupZip: 該当なしは空配列', async () => {
	const { fetchChunk } = makeFetch();
	assert.deepEqual(await lookupZip('9999999', fetchChunk), []);
});

// ---------------------------------------------------------------------------
// bulkConvert
// ---------------------------------------------------------------------------

test('bulkConvert: 正常/形式エラー/該当なし/複数候補/重複行を行順維持で変換', async () => {
	const { fetchChunk, calls } = makeFetch();
	const lines = ['100-0001', '1000002', 'invalid', '9999999', '100-0001'];
	const results = await bulkConvert(lines, fetchChunk);

	assert.equal(results.length, 5);
	// 1: 正常・候補1
	assert.deepEqual(
		[results[0].prefecture, results[0].city, results[0].town],
		['東京都', '千代田区', '千代田'],
	);
	assert.equal(results[0].candidates, 1);
	// 2: 複数候補（1件目採用 + candidates=2）
	assert.equal(results[1].town, '皇居外苑');
	assert.equal(results[1].candidates, 2);
	// 3: 形式エラー
	assert.equal(results[2].zip, null);
	assert.equal(results[2].error, 'format-error');
	// 4: 該当なし
	assert.equal(results[3].error, 'not-found');
	// 5: 重複行も変換（行順維持）
	assert.equal(results[4].town, '千代田');

	// 必要チャンクは重複排除して取得（10, 99 のみ／10は1回）
	assert.deepEqual([...new Set(calls)].sort(), ['10', '99']);
	assert.equal(calls.filter((c) => c === '10').length, 1, '10は1回だけ');
});

test('bulkConvert: チャンクfetch失敗は fetch-error', async () => {
	const { fetchChunk } = makeFetch();
	const results = await bulkConvert(['5000000', '100-0001'], fetchChunk);
	assert.equal(results[0].error, 'fetch-error');
	assert.equal(results[1].town, '千代田', '他チャンクは正常に処理が継続する');
});

test('bulkConvert: onProgress が最後に total へ到達', async () => {
	const { fetchChunk } = makeFetch();
	const events: Array<[number, number]> = [];
	await bulkConvert(['100-0001', '1000002'], fetchChunk, (done, total) => {
		events.push([done, total]);
	});
	assert.deepEqual(events.at(-1), [2, 2]);
});

// ---------------------------------------------------------------------------
// formatAddress
// ---------------------------------------------------------------------------

test('formatAddress: 都道府県+市区町村+町域を連結', () => {
	assert.equal(
		formatAddress(['1000001', '東京都', '千代田区', '千代田']),
		'東京都千代田区千代田',
	);
});
