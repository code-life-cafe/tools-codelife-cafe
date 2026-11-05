// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/transcribe-segments.test.ts
//
// /transcribe のセグメント正規化・逐次upsert・プレーンテキスト化（純粋ロジック）。
// 推論・AudioContext 依存は E2E / Playwright ブラウザテストで検証する。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	normalizeSegments,
	type TranscriptSegment,
	toPlainText,
	upsertSegment,
} from '../../src/lib/transcribe/segments.ts';

const seg = (
	id: number,
	start: number,
	end: number,
	text: string,
): TranscriptSegment => ({ id, start, end, text });

// ---------------------------------------------------------------------------
// normalizeSegments
// ---------------------------------------------------------------------------

test('normalizeSegments: 開始時刻の昇順に並べ替える', () => {
	const out = normalizeSegments([
		seg(2, 5, 6, 'に'),
		seg(1, 0, 1, 'いち'),
		seg(3, 2, 3, 'さん'),
	]);
	assert.deepEqual(
		out.map((s) => s.text),
		['いち', 'さん', 'に'],
	);
});

test('normalizeSegments: 空・空白のみのセグメントは除去する', () => {
	const out = normalizeSegments([
		seg(1, 0, 1, 'あり'),
		seg(2, 1, 2, '   '),
		seg(3, 2, 3, ''),
		seg(4, 3, 4, '\n\n'),
	]);
	assert.equal(out.length, 1);
	assert.equal(out[0].text, 'あり');
});

test('normalizeSegments: CRLF を LF にし、各行を trim して空行を落とす', () => {
	const out = normalizeSegments([seg(1, 0, 1, '  前半 \r\n\r\n  後半  ')]);
	assert.equal(out[0].text, '前半\n後半');
});

test('normalizeSegments: 完全に同一の (start, end, text) は重複除去する', () => {
	const out = normalizeSegments([
		seg(1, 0, 1, 'おなじ'),
		seg(2, 0, 1, 'おなじ'),
		seg(3, 0, 1, 'ちがう'),
	]);
	assert.equal(out.length, 2);
	assert.deepEqual(
		out.map((s) => s.text),
		['おなじ', 'ちがう'],
	);
});

test('normalizeSegments: 負の開始時刻は 0 にクランプする', () => {
	const out = normalizeSegments([seg(1, -3, 1, 'まえ')]);
	assert.equal(out[0].start, 0);
});

test('normalizeSegments: 終了が開始より前なら除去し、0秒セグメントを作らない（#572）', () => {
	const out = normalizeSegments([seg(1, 5, 2, 'ぎゃく')]);
	assert.deepEqual(out, []);
});

test('normalizeSegments: 0秒セグメントを除き、短い発話と正しい反復は保持する', () => {
	const input = [
		seg(1, 0, 0, '架空の反復文'),
		seg(2, 1, 1, '架空の反復文'),
		seg(3, 1, 1.01, 'はい'),
		seg(4, 2, 2.01, 'はい'),
	];
	assert.deepEqual(normalizeSegments(input), input.slice(2));
});

test('normalizeSegments: 非有限な時刻のセグメントは除去する', () => {
	const out = normalizeSegments([
		seg(1, Number.NaN, 1, 'なん'),
		seg(2, 0, Number.POSITIVE_INFINITY, 'むげん'),
		seg(3, 0, 1, 'ふつう'),
	]);
	assert.deepEqual(
		out.map((s) => s.text),
		['ふつう'],
	);
});

test('normalizeSegments: 入力配列を破壊しない', () => {
	const input = [seg(2, 5, 6, 'に'), seg(1, 0, 1, 'いち')];
	normalizeSegments(input);
	assert.equal(input[0].text, 'に');
});

// ---------------------------------------------------------------------------
// upsertSegment
// ---------------------------------------------------------------------------

test('upsertSegment: 新規は開始時刻の位置に挿入される（単純appendしない）', () => {
	let list: TranscriptSegment[] = [];
	list = upsertSegment(list, seg(2, 4, 5, 'あと'));
	list = upsertSegment(list, seg(1, 0, 1, 'さき'));
	assert.deepEqual(
		list.map((s) => s.text),
		['さき', 'あと'],
	);
});

test('upsertSegment: 同じ id は置き換える（重複しない）', () => {
	let list = [seg(1, 0, 1, 'ふるい')];
	list = upsertSegment(list, seg(1, 0, 1, 'あたらしい'));
	assert.equal(list.length, 1);
	assert.equal(list[0].text, 'あたらしい');
});

test('upsertSegment: id が違っても時間範囲が同じなら置き換える', () => {
	let list = [seg(1, 0, 1.5, 'ふるい')];
	list = upsertSegment(list, seg(99, 0, 1.5, 'あたらしい'));
	assert.equal(list.length, 1);
	assert.equal(list[0].text, 'あたらしい');
	assert.equal(list[0].id, 99);
});

test('upsertSegment: 入力配列を破壊しない', () => {
	const list = [seg(1, 0, 1, 'もと')];
	const next = upsertSegment(list, seg(2, 1, 2, 'つぎ'));
	assert.equal(list.length, 1);
	assert.equal(next.length, 2);
});

// ---------------------------------------------------------------------------
// toPlainText
// ---------------------------------------------------------------------------

test('toPlainText: 既定はタイムスタンプなしで本文だけを改行結合する', () => {
	const text = toPlainText([seg(1, 0, 1, 'いち'), seg(2, 1, 2, 'に')]);
	assert.equal(text, 'いち\nに\n');
});

test('toPlainText: withTimestamps でタイムスタンプ付きになる', () => {
	const text = toPlainText([seg(1, 0, 1.5, 'いち')], { withTimestamps: true });
	assert.equal(text, '[00:00:00.000 --> 00:00:01.500] いち\n');
});

test('toPlainText: セグメントが無ければ空文字を返す', () => {
	assert.equal(toPlainText([]), '');
});
