// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/uuid.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createUlidGenerator,
	createUuidV7Generator,
	detectIdKind,
	extractUlidTimestamp,
	extractUuidV1Timestamp,
	extractUuidV7Timestamp,
	formatUuid,
	generateIds,
	generateIdsChunked,
	generateNanoid,
	generateUuidV4,
	isValidUlid,
	joinIdsForCopy,
	MAX_COUNT,
	NANOID_DEFAULT_SIZE,
	validateCount,
} from '../../src/lib/tools/uuid.ts';

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('UUID v4: RFC4122 のフォーマット・version・variant を満たす', () => {
	for (let i = 0; i < 200; i++) {
		const id = generateUuidV4();
		assert.match(id, UUID_RE);
		assert.equal(id[14], '4');
		assert.ok('89ab'.includes(id[19]));
	}
});

test('UUID v4: 固定乱数ソースを注入できる', () => {
	const fixed = new Uint8Array(16).fill(0xff);
	const id = generateUuidV4(() => fixed);
	assert.match(id, UUID_RE);
	assert.equal(id[14], '4');
	assert.ok('89ab'.includes(id[19]));
});

test('UUID v7: フォーマット・version・variant を満たし、時刻部が固定時刻と一致する', () => {
	const gen = createUuidV7Generator();
	const fixedMs = 0x0123456789ab;
	const id = gen(fixedMs);
	assert.match(id, UUID_RE);
	assert.equal(id[14], '7');
	assert.ok('89ab'.includes(id[19]));
	assert.equal(id.replace(/-/g, '').slice(0, 12), '0123456789ab');
});

test('UUID v7: 同一ミリ秒内で単調増加する', () => {
	const gen = createUuidV7Generator();
	const fixedMs = 1_700_000_000_000;
	const ids: string[] = [];
	for (let i = 0; i < 500; i++) {
		ids.push(gen(fixedMs).replace(/-/g, ''));
	}
	const sorted = [...ids].sort();
	assert.deepEqual(
		ids,
		sorted,
		'生成順とソート順が一致する（レキシコグラフィック単調増加）',
	);
	// 重複がないこと
	assert.equal(new Set(ids).size, ids.length);
});

test('UUID v7: 時刻が進めばタイムスタンプ部も進む', () => {
	const gen = createUuidV7Generator();
	const a = gen(1_000).replace(/-/g, '');
	const b = gen(2_000).replace(/-/g, '');
	assert.ok(a < b);
});

test('ULID: フォーマット（26文字・Crockford Base32・先頭0-7）を満たす', () => {
	const gen = createUlidGenerator();
	for (let i = 0; i < 100; i++) {
		const id = gen();
		assert.equal(id.length, 26);
		assert.ok(isValidUlid(id));
		assert.ok('01234567'.includes(id[0]));
		for (const ambiguous of ['I', 'L', 'O', 'U']) {
			assert.ok(!id.includes(ambiguous));
		}
	}
});

test('ULID: 同一ミリ秒内で単調増加する', () => {
	const gen = createUlidGenerator();
	const fixedMs = 1_700_000_000_000;
	const ids: string[] = [];
	for (let i = 0; i < 500; i++) {
		ids.push(gen(fixedMs));
	}
	const sorted = [...ids].sort();
	assert.deepEqual(ids, sorted);
	assert.equal(new Set(ids).size, ids.length);
});

test('nanoid: 既定21文字・URL-safeアルファベットのみで構成される', () => {
	for (let i = 0; i < 200; i++) {
		const id = generateNanoid();
		assert.equal(id.length, NANOID_DEFAULT_SIZE);
		assert.match(id, /^[A-Za-z0-9_-]+$/);
	}
});

test('nanoid: 任意の長さを指定できる', () => {
	assert.equal(generateNanoid(10).length, 10);
	assert.equal(generateNanoid(64).length, 64);
});

test('validateCount: 1〜1000件を許可し、範囲外・非整数を拒否する', () => {
	assert.equal(validateCount(1), null);
	assert.equal(validateCount(1000), null);
	assert.equal(validateCount(500), null);
	assert.notEqual(validateCount(0), null);
	assert.notEqual(validateCount(1001), null);
	assert.notEqual(validateCount(1.5), null);
	assert.notEqual(validateCount(Number.NaN), null);
});

test('formatUuid: 大文字/小文字・ハイフン有無の表示変換', () => {
	const id = '01234567-89ab-4def-8123-456789abcdef';
	assert.equal(formatUuid(id, { uppercase: false, hyphens: true }), id);
	assert.equal(
		formatUuid(id, { uppercase: true, hyphens: true }),
		id.toUpperCase(),
	);
	assert.equal(
		formatUuid(id, { uppercase: false, hyphens: false }),
		id.replace(/-/g, ''),
	);
	assert.equal(
		formatUuid(id, { uppercase: true, hyphens: false }),
		id.replace(/-/g, '').toUpperCase(),
	);
});

test('formatUuid: 表示変換後もversion判定結果が変わらない（detectIdKindで再検証）', () => {
	const id = '01234567-89ab-4def-8123-456789abcdef';
	for (const opts of [
		{ uppercase: false, hyphens: true },
		{ uppercase: true, hyphens: true },
		{ uppercase: false, hyphens: false },
		{ uppercase: true, hyphens: false },
	] as const) {
		const displayed = formatUuid(id, opts);
		assert.equal(detectIdKind(displayed).kind, 'uuid-v4');
	}
});

test('detectIdKind: UUID v1/v4/v7、ULID、無効値を正しく分類する', () => {
	assert.equal(
		detectIdKind('c232ab00-9414-11ec-b3c8-9f6bdeced846').kind,
		'uuid-v1',
	);
	assert.equal(detectIdKind(generateUuidV4()).kind, 'uuid-v4');
	assert.equal(detectIdKind(createUuidV7Generator()()).kind, 'uuid-v7');
	assert.equal(detectIdKind('01ARZ3NDEKTSV4RRFFQ69G5FAV').kind, 'ulid');
	assert.equal(detectIdKind('not-a-valid-id').kind, 'unknown');
	assert.equal(detectIdKind('').kind, 'unknown');
});

test('detectIdKind: 曖昧な英数字列をnanoidと断定せず「不明」にする', () => {
	// 21文字のnanoidらしき文字列でも、UUID/ULIDに一致しなければ「不明」
	const ambiguous = generateNanoid(21);
	const result = detectIdKind(ambiguous);
	assert.equal(result.kind, 'unknown');
});

test('extractUuidV1Timestamp: 既知ベクタから正しい時刻を抽出する', () => {
	// timestamp フィールド = GREGORIAN_OFFSET_100NS そのもの → 1970-01-01T00:00:00.000Z
	const offset = 122192928000000000n;
	const hex = offset.toString(16).padStart(15, '0');
	const timeHi = hex.slice(0, 3);
	const timeMid = hex.slice(3, 7);
	const timeLow = hex.slice(7, 15);
	const uuid = `${timeLow}-${timeMid}-1${timeHi}-8000-000000000000`;
	const result = extractUuidV1Timestamp(uuid);
	assert.ok(result.ok);
	if (result.ok) {
		assert.equal(result.iso, '1970-01-01T00:00:00.000Z');
	}
});

test('extractUuidV1Timestamp: エポックの100ms後を正しく抽出する', () => {
	// GREGORIAN_OFFSET_100NS + 100ms分(1,000,000 * 100ns単位) を16進化して埋め込む
	const offset = 122192928000000000n;
	const hundredMsIn100ns = 1_000_000n;
	const raw = offset + hundredMsIn100ns;
	const hex = raw.toString(16).padStart(15, '0');
	const timeLow = hex.slice(7, 15);
	const timeMid = hex.slice(3, 7);
	const timeHi = hex.slice(0, 3);
	const uuid = `${timeLow}-${timeMid}-1${timeHi}-8000-000000000000`;
	const result = extractUuidV1Timestamp(uuid);
	assert.ok(result.ok);
	if (result.ok) {
		assert.equal(result.iso, '1970-01-01T00:00:00.100Z');
	}
});

test('extractUuidV1Timestamp: UUID v1以外はエラーを返す', () => {
	const result = extractUuidV1Timestamp(generateUuidV4());
	assert.equal(result.ok, false);
});

test('extractUuidV7Timestamp: 既知ベクタから正しい時刻を抽出する', () => {
	const gen = createUuidV7Generator();
	const fixedMs = Date.UTC(2024, 0, 15, 12, 30, 45, 123);
	const id = gen(fixedMs);
	const result = extractUuidV7Timestamp(id);
	assert.ok(result.ok);
	if (result.ok) {
		assert.equal(result.date.getTime(), fixedMs);
	}
});

test('extractUuidV7Timestamp: UUID v7以外はエラーを返す', () => {
	const result = extractUuidV7Timestamp('c232ab00-9414-11ec-b3c8-9f6bdeced846');
	assert.equal(result.ok, false);
});

test('extractUlidTimestamp: 既知ベクタから正しい時刻を抽出する', () => {
	// タイムスタンプ部 "01ARZ3NDEK" を Crockford Base32 として手動デコードした値と比較する
	const result = extractUlidTimestamp('01ARZ3NDEKTSV4RRFFQ69G5FAV');
	assert.ok(result.ok);
	if (result.ok) {
		assert.equal(result.date.getTime(), 1469922850259);
		assert.equal(result.iso, '2016-07-30T23:54:10.259Z');
	}
});

test('extractUlidTimestamp: 固定時刻の往復変換が一致する', () => {
	const gen = createUlidGenerator();
	const fixedMs = Date.UTC(2024, 5, 1, 0, 0, 0, 0);
	const id = gen(fixedMs);
	const result = extractUlidTimestamp(id);
	assert.ok(result.ok);
	if (result.ok) {
		assert.equal(result.date.getTime(), fixedMs);
	}
});

test('extractUlidTimestamp: 無効な文字列はエラーを返す', () => {
	const result = extractUlidTimestamp('invalid');
	assert.equal(result.ok, false);
});

test('generateIds: 1件・1000件を生成でき、0・1001・非数値を拒否する', () => {
	assert.equal(generateIds('uuid-v4', 1).length, 1);
	assert.equal(generateIds('uuid-v4', MAX_COUNT).length, MAX_COUNT);
	assert.throws(() => generateIds('uuid-v4', 0));
	assert.throws(() => generateIds('uuid-v4', 1001));
	assert.throws(() => generateIds('uuid-v4', Number.NaN));
});

test('generateIds: 各種類ともユニークなIDが生成される', () => {
	for (const kind of ['uuid-v4', 'uuid-v7', 'ulid', 'nanoid'] as const) {
		const ids = generateIds(kind, 300);
		assert.equal(new Set(ids).size, 300, `kind=${kind}`);
	}
});

test('generateIdsChunked: 1000件を生成し、進捗コールバックが呼ばれる', async () => {
	const progressCalls: [number, number][] = [];
	const ids = await generateIdsChunked('ulid', 1000, {}, (done, total) => {
		progressCalls.push([done, total]);
	});
	assert.equal(ids.length, 1000);
	assert.equal(new Set(ids).size, 1000);
	assert.ok(progressCalls.length > 0);
	assert.deepEqual(progressCalls[progressCalls.length - 1], [1000, 1000]);
});

test('joinIdsForCopy: 改行区切りになる', () => {
	assert.equal(joinIdsForCopy(['a', 'b', 'c']), 'a\nb\nc');
	assert.equal(joinIdsForCopy([]), '');
	assert.equal(joinIdsForCopy(['only']), 'only');
});
