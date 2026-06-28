// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/image-merge.test.ts
//
// Canvas 依存（mergeImages / exportCanvas）はブラウザ専用のため E2E で検証する。
// ここではレイアウト計算・バリデーションなどの純粋ロジックを対象とする。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildMergedFilename,
	computeLayout,
	DEFAULT_MERGE_OPTIONS,
	type ImageSize,
	MAX_FILE_COUNT,
	MAX_FILE_SIZE,
	MAX_TOTAL_SIZE,
	type MergeOptions,
	mimeForFormat,
	validateBatch,
	validateImageFile,
} from '../../src/lib/tools/image-merge.ts';

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function opts(overrides: Partial<MergeOptions> = {}): MergeOptions {
	return { ...DEFAULT_MERGE_OPTIONS, ...overrides };
}

// ---------------------------------------------------------------------------
// validateImageFile
// ---------------------------------------------------------------------------

test('validateImageFile: 対応形式は ok: true を返す', () => {
	for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
		const result = validateImageFile({ type, size: 1000 });
		assert.equal(result.ok, true, `${type} は対応形式`);
	}
});

test('validateImageFile: 非対応形式は ok: false (unsupported-type)', () => {
	const result = validateImageFile({ type: 'image/svg+xml', size: 1000 });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.reason, 'unsupported-type');
	}
});

test('validateImageFile: 50MB超は ok: false (too-large)', () => {
	const result = validateImageFile({
		type: 'image/png',
		size: MAX_FILE_SIZE + 1,
	});
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.reason, 'too-large');
	}
});

// ---------------------------------------------------------------------------
// validateBatch
// ---------------------------------------------------------------------------

test('validateBatch: 30ファイル以内・300MB以内は OK', () => {
	assert.equal(validateBatch(MAX_FILE_COUNT, 100 * 1024 * 1024).ok, true);
});

test('validateBatch: 31ファイルは拒否', () => {
	const result = validateBatch(MAX_FILE_COUNT + 1, 0);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.reason, 'too-many-files');
	}
});

test('validateBatch: 合計300MB超は拒否', () => {
	const result = validateBatch(1, MAX_TOTAL_SIZE + 1);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.reason, 'total-size-exceeded');
	}
});

// ---------------------------------------------------------------------------
// mimeForFormat / buildMergedFilename
// ---------------------------------------------------------------------------

test('mimeForFormat: 各形式の MIME を返す', () => {
	assert.equal(mimeForFormat('png'), 'image/png');
	assert.equal(mimeForFormat('jpeg'), 'image/jpeg');
	assert.equal(mimeForFormat('webp'), 'image/webp');
});

test('buildMergedFilename: 拡張子が正しい', () => {
	assert.equal(buildMergedFilename('png'), 'merged.png');
	assert.equal(buildMergedFilename('jpeg'), 'merged.jpg');
	assert.equal(buildMergedFilename('webp'), 'merged.webp');
});

// ---------------------------------------------------------------------------
// computeLayout: 空入力
// ---------------------------------------------------------------------------

test('computeLayout: 空配列は { width: 0, height: 0, cells: [] }', () => {
	const layout = computeLayout([], opts());
	assert.deepEqual(layout, { width: 0, height: 0, cells: [] });
});

// ---------------------------------------------------------------------------
// computeLayout: 縦結合 (vertical)
// ---------------------------------------------------------------------------

test('vertical/original: 合計高さ＝各画像高さの合計、幅＝最大幅', () => {
	const sizes: ImageSize[] = [
		{ width: 200, height: 100 },
		{ width: 300, height: 150 },
	];
	const layout = computeLayout(
		sizes,
		opts({ mode: 'vertical', fit: 'original', gap: 0, padding: 0 }),
	);
	assert.equal(layout.width, 300, '幅 = max(200,300)');
	assert.equal(layout.height, 250, '高さ = 100+150');
	assert.equal(layout.cells.length, 2);
	// 1枚目は原寸維持（center寄せ）
	assert.equal(layout.cells[0].w, 200);
	assert.equal(layout.cells[0].h, 100);
	// 2枚目は原寸維持
	assert.equal(layout.cells[1].w, 300);
	assert.equal(layout.cells[1].h, 150);
});

test('vertical/original + gap: 余白が反映される', () => {
	const sizes: ImageSize[] = [
		{ width: 100, height: 50 },
		{ width: 100, height: 50 },
		{ width: 100, height: 50 },
	];
	const layout = computeLayout(
		sizes,
		opts({ mode: 'vertical', fit: 'original', gap: 10, padding: 0 }),
	);
	assert.equal(layout.height, 170, '50*3 + 10*2 = 170');
});

test('vertical/original + padding: 外周パディングが反映される', () => {
	const sizes: ImageSize[] = [{ width: 100, height: 50 }];
	const layout = computeLayout(
		sizes,
		opts({ mode: 'vertical', fit: 'original', gap: 0, padding: 20 }),
	);
	assert.equal(layout.width, 140, '100 + 20*2');
	assert.equal(layout.height, 90, '50 + 20*2');
	assert.equal(layout.cells[0].x, 20, 'x offset = padding');
	assert.equal(layout.cells[0].y, 20, 'y offset = padding');
});

test('vertical/fit-width: 全画像が最大幅に拡大/縮小される', () => {
	const sizes: ImageSize[] = [
		{ width: 200, height: 100 },
		{ width: 400, height: 200 },
	];
	const layout = computeLayout(
		sizes,
		opts({ mode: 'vertical', fit: 'fit-width', gap: 0, padding: 0 }),
	);
	assert.equal(layout.width, 400, '幅 = max(200,400)');
	// 1枚目: 200→400 で高さ 100→200
	assert.equal(layout.cells[0].w, 400);
	assert.equal(layout.cells[0].h, 200);
	// 2枚目: そのまま
	assert.equal(layout.cells[1].w, 400);
	assert.equal(layout.cells[1].h, 200);
	assert.equal(layout.height, 400, '200+200');
});

test('vertical/uniform-cell: 統一セルサイズに収まる', () => {
	const sizes: ImageSize[] = [
		{ width: 200, height: 100 },
		{ width: 100, height: 200 },
	];
	const layout = computeLayout(
		sizes,
		opts({ mode: 'vertical', fit: 'uniform-cell', gap: 0, padding: 0 }),
	);
	// セル: max(200,100)=200 x max(100,200)=200
	assert.equal(layout.width, 200);
	assert.equal(layout.height, 400, '200*2');
	// 各画像がセル内に収まること
	for (const cell of layout.cells) {
		assert.ok(cell.w <= 200, `w=${cell.w} <= 200`);
		assert.ok(cell.h <= 200, `h=${cell.h} <= 200`);
	}
});

test('vertical/original + align: start/center/end が反映される', () => {
	const sizes: ImageSize[] = [
		{ width: 100, height: 50 },
		{ width: 200, height: 50 },
	];
	const layoutStart = computeLayout(
		sizes,
		opts({ mode: 'vertical', fit: 'original', align: 'start', padding: 0 }),
	);
	assert.equal(layoutStart.cells[0].x, 0, 'start: x=0');

	const layoutCenter = computeLayout(
		sizes,
		opts({ mode: 'vertical', fit: 'original', align: 'center', padding: 0 }),
	);
	assert.equal(layoutCenter.cells[0].x, 50, 'center: x=50');

	const layoutEnd = computeLayout(
		sizes,
		opts({ mode: 'vertical', fit: 'original', align: 'end', padding: 0 }),
	);
	assert.equal(layoutEnd.cells[0].x, 100, 'end: x=100');
});

// ---------------------------------------------------------------------------
// computeLayout: 横結合 (horizontal)
// ---------------------------------------------------------------------------

test('horizontal/original: 合計幅＝各画像幅の合計、高さ＝最大高さ', () => {
	const sizes: ImageSize[] = [
		{ width: 100, height: 200 },
		{ width: 150, height: 300 },
	];
	const layout = computeLayout(
		sizes,
		opts({ mode: 'horizontal', fit: 'original', gap: 0, padding: 0 }),
	);
	assert.equal(layout.width, 250, '100+150');
	assert.equal(layout.height, 300, 'max(200,300)');
});

test('horizontal/original + gap: 余白が反映される', () => {
	const sizes: ImageSize[] = [
		{ width: 100, height: 100 },
		{ width: 100, height: 100 },
	];
	const layout = computeLayout(
		sizes,
		opts({ mode: 'horizontal', fit: 'original', gap: 20, padding: 0 }),
	);
	assert.equal(layout.width, 220, '100+100+20');
});

test('horizontal/fit-width: 高さが揃う', () => {
	const sizes: ImageSize[] = [
		{ width: 100, height: 100 },
		{ width: 200, height: 400 },
	];
	const layout = computeLayout(
		sizes,
		opts({ mode: 'horizontal', fit: 'fit-width', gap: 0, padding: 0 }),
	);
	assert.equal(layout.height, 400 + 0, '高さ = max(100,400) + padding*2');
	// 1枚目: height 100→400, width 100→400
	assert.equal(layout.cells[0].h, 400);
	assert.equal(layout.cells[0].w, 400);
});

test('horizontal/uniform-cell: 統一セルサイズ', () => {
	const sizes: ImageSize[] = [
		{ width: 100, height: 100 },
		{ width: 200, height: 200 },
	];
	const layout = computeLayout(
		sizes,
		opts({ mode: 'horizontal', fit: 'uniform-cell', gap: 0, padding: 0 }),
	);
	assert.equal(layout.width, 400, '200*2');
	assert.equal(layout.height, 200);
});

// ---------------------------------------------------------------------------
// computeLayout: グリッド (grid)
// ---------------------------------------------------------------------------

test('grid: 列数に応じた行数・セル配置', () => {
	const sizes: ImageSize[] = [
		{ width: 100, height: 100 },
		{ width: 100, height: 100 },
		{ width: 100, height: 100 },
		{ width: 100, height: 100 },
		{ width: 100, height: 100 },
	];
	const layout = computeLayout(
		sizes,
		opts({ mode: 'grid', columns: 2, fit: 'uniform-cell', gap: 0, padding: 0 }),
	);
	assert.equal(layout.cells.length, 5);
	// 2列 × 3行
	assert.equal(layout.width, 200, '100*2');
	assert.equal(layout.height, 300, '100*3');
});

test('grid: gap と padding が反映される', () => {
	const sizes: ImageSize[] = [
		{ width: 100, height: 100 },
		{ width: 100, height: 100 },
		{ width: 100, height: 100 },
		{ width: 100, height: 100 },
	];
	const layout = computeLayout(
		sizes,
		opts({
			mode: 'grid',
			columns: 2,
			fit: 'uniform-cell',
			gap: 10,
			padding: 20,
		}),
	);
	// 2列2行: width = 2*100 + 1*10 + 2*20 = 250
	assert.equal(layout.width, 250);
	// height = 2*100 + 1*10 + 2*20 = 250
	assert.equal(layout.height, 250);
});

test('grid/original: 異なるサイズの画像を原寸配置', () => {
	const sizes: ImageSize[] = [
		{ width: 100, height: 50 },
		{ width: 200, height: 100 },
		{ width: 150, height: 75 },
		{ width: 50, height: 150 },
	];
	const layout = computeLayout(
		sizes,
		opts({ mode: 'grid', columns: 2, fit: 'original', gap: 0, padding: 0 }),
	);
	assert.equal(layout.cells.length, 4);
	// 各セルの画像サイズは原寸維持
	assert.equal(layout.cells[0].w, 100);
	assert.equal(layout.cells[0].h, 50);
	assert.equal(layout.cells[1].w, 200);
	assert.equal(layout.cells[1].h, 100);
});

test('grid: 列数 > 画像数 の場合は画像数に制限される', () => {
	const sizes: ImageSize[] = [
		{ width: 100, height: 100 },
		{ width: 100, height: 100 },
	];
	const layout = computeLayout(
		sizes,
		opts({ mode: 'grid', columns: 5, fit: 'uniform-cell', gap: 0, padding: 0 }),
	);
	// 2画像しかないので2列×1行
	assert.equal(layout.width, 200);
	assert.equal(layout.height, 100);
});

// ---------------------------------------------------------------------------
// computeLayout: 1枚のみ
// ---------------------------------------------------------------------------

test('1枚のみでも正しくレイアウトされる', () => {
	const sizes: ImageSize[] = [{ width: 300, height: 200 }];
	for (const mode of ['vertical', 'horizontal', 'grid'] as const) {
		const layout = computeLayout(
			sizes,
			opts({ mode, gap: 0, padding: 0, fit: 'original' }),
		);
		assert.equal(layout.cells.length, 1, `${mode}: 1セル`);
		assert.equal(layout.cells[0].w, 300, `${mode}: 幅`);
		assert.equal(layout.cells[0].h, 200, `${mode}: 高さ`);
	}
});
