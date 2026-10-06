import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	formatGroups,
	MAX_INPUT_BYTES,
	MAX_ITEMS,
	parseItems,
	secureRandomInt,
	shuffle,
	splitIntoGroups,
} from '../../src/lib/tools/random-sort.ts';

test('random-sort: 空行を除外し、重複行と本文の空白は保持する', () => {
	const r = parseItems('a\r\n\r\n  b \n   \na\n');
	assert.ok(r.ok);
	assert.deepEqual(r.items, ['a', '  b ', 'a']);
	assert.equal(r.skippedEmptyLines, 2);
});

test('random-sort: 空入力は0項目', () => {
	const r = parseItems('');
	assert.ok(r.ok);
	assert.deepEqual(r.items, []);
});

test('random-sort: 項目数・サイズの上限', () => {
	const max = Array.from({ length: MAX_ITEMS }, (_, i) => `x${i}`).join('\n');
	assert.equal(parseItems(max).ok, true);
	assert.equal(parseItems(`${max}\nover`).ok, false);
	assert.equal(parseItems('あ'.repeat(MAX_INPUT_BYTES / 3 + 1)).ok, false);
});

test('random-sort: 固定乱数でFisher-Yatesの結果が決まる（常に0なら先頭へ回る）', () => {
	assert.deepEqual(
		shuffle(['a', 'b', 'c', 'd'], () => 0),
		['b', 'c', 'd', 'a'],
	);
	// 常に最大値（i）を返すと恒等
	assert.deepEqual(
		shuffle(['a', 'b', 'c'], (n) => n - 1),
		['a', 'b', 'c'],
	);
});

test('random-sort: 入力を破壊せず、0/1項目でも動作する', () => {
	const src = ['a', 'b'];
	shuffle(src, () => 0);
	assert.deepEqual(src, ['a', 'b']);
	assert.deepEqual(
		shuffle([], () => 0),
		[],
	);
	assert.deepEqual(
		shuffle(['x'], () => 0),
		['x'],
	);
});

test('random-sort: 範囲外の乱数値は拒否する', () => {
	assert.throws(() => shuffle(['a', 'b', 'c'], () => 99), RangeError);
	assert.throws(() => shuffle(['a', 'b'], () => 0.5), RangeError);
});

test('random-sort: groupsは人数差が最大1で全項目を含む', () => {
	for (const [n, g] of [
		[10, 3],
		[7, 7],
		[5, 1],
		[9, 4],
	] as const) {
		const items = Array.from({ length: n }, (_, i) => String(i));
		const r = splitIntoGroups(items, g);
		assert.ok(r.ok);
		assert.equal(r.groups.length, g);
		const sizes = r.groups.map((x) => x.length);
		assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
		assert.deepEqual(r.groups.flat(), items);
	}
	const r = splitIntoGroups(['a', 'b', 'c', 'd', 'e'], 2);
	assert.ok(r.ok);
	assert.deepEqual(
		r.groups.map((x) => x.length),
		[3, 2],
	);
});

test('random-sort: 不正なグループ数・0項目はエラー', () => {
	const items = ['a', 'b', 'c'];
	for (const g of [0, -1, 1.5, Number.NaN, 4]) {
		assert.equal(splitIntoGroups(items, g).ok, false, String(g));
	}
	assert.equal(splitIntoGroups([], 1).ok, false);
});

test('random-sort: 結果テキスト整形', () => {
	assert.equal(
		formatGroups([['a', 'b'], ['c']]),
		'グループ1（2件）\na\nb\n\nグループ2（1件）\nc',
	);
});

test('random-sort: secureRandomInt は範囲外の値を棄却して再抽選する', () => {
	// max=3: limit = 2^32 - (2^32 % 3) = 4294967295。0xFFFFFFFF は棄却される
	const queue = [0xffffffff, 0xffffffff, 7];
	const fake = {
		getRandomValues(buf: Uint32Array) {
			buf[0] = queue.shift() as number;
			return buf;
		},
	} as unknown as Pick<Crypto, 'getRandomValues'>;
	assert.equal(secureRandomInt(3, fake), 1);
	assert.equal(queue.length, 0);
});

test('random-sort: secureRandomInt の入力検証と乱数API不在', () => {
	assert.equal(secureRandomInt(1), 0);
	assert.throws(() => secureRandomInt(0), RangeError);
	assert.throws(() => secureRandomInt(1.5), RangeError);
	assert.throws(
		() => secureRandomInt(5, {} as unknown as Pick<Crypto, 'getRandomValues'>),
		/Web Crypto/,
	);
	const v = secureRandomInt(10);
	assert.ok(Number.isInteger(v) && v >= 0 && v < 10);
});
