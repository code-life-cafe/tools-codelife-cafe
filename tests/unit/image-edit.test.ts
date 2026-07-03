// 実行方法: npm run test:unit
// Canvas 描画（renderEditedCanvas 等）はブラウザ専用のため E2E で検証する。
// ここでは入力バリデーション・回転サイズ計算・ファイル名生成などの純粋関数を対象とする。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildEditedFilename,
	computeCenterCrop,
	computeRotatedSize,
	degToRad,
	MAX_FILE_COUNT,
	MAX_FILE_SIZE,
	mimeForFormat,
	needsBackgroundComposite,
	validateEditBatch,
	validateEditImageFile,
} from '../../src/lib/tools/image-edit.ts';

// ---------------------------------------------------------------------------
// validateEditImageFile
// ---------------------------------------------------------------------------

test('validateEditImageFile: PNG / JPEG / WebP を受け付ける', () => {
	assert.deepEqual(validateEditImageFile({ type: 'image/png', size: 100 }), {
		ok: true,
		format: 'png',
	});
	assert.deepEqual(validateEditImageFile({ type: 'image/jpeg', size: 100 }), {
		ok: true,
		format: 'jpeg',
	});
	assert.deepEqual(validateEditImageFile({ type: 'image/webp', size: 100 }), {
		ok: true,
		format: 'webp',
	});
});

test('validateEditImageFile: 非対応形式は unsupported-type', () => {
	const result = validateEditImageFile({ type: 'image/gif', size: 100 });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.reason, 'unsupported-type');
	}
});

test('validateEditImageFile: 上限ちょうどはOK・超過は too-large', () => {
	assert.equal(
		validateEditImageFile({ type: 'image/png', size: MAX_FILE_SIZE }).ok,
		true,
	);
	const result = validateEditImageFile({
		type: 'image/png',
		size: MAX_FILE_SIZE + 1,
	});
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.reason, 'too-large');
	}
});

// ---------------------------------------------------------------------------
// validateEditBatch
// ---------------------------------------------------------------------------

test('validateEditBatch: 上限枚数ちょうどはOK・超過は too-many-files', () => {
	const file = { type: 'image/png', size: 100 };
	assert.equal(
		validateEditBatch(Array.from({ length: MAX_FILE_COUNT }, () => file)).ok,
		true,
	);
	const result = validateEditBatch(
		Array.from({ length: MAX_FILE_COUNT + 1 }, () => file),
	);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.reason, 'too-many-files');
	}
});

test('validateEditBatch: 合計サイズ超過は total-size-exceeded', () => {
	// 30ファイル × 11MB = 330MB > 300MB
	const files = Array.from({ length: 30 }, () => ({
		type: 'image/png',
		size: 11 * 1024 * 1024,
	}));
	const result = validateEditBatch(files);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.reason, 'total-size-exceeded');
	}
});

// ---------------------------------------------------------------------------
// degToRad / computeRotatedSize
// ---------------------------------------------------------------------------

test('degToRad: 180° は π', () => {
	assert.equal(degToRad(180), Math.PI);
	assert.equal(degToRad(0), 0);
});

test('computeRotatedSize: 90°単位の回転で1pxの膨らみが出ない', () => {
	// 0° / 360°: そのまま
	assert.deepEqual(computeRotatedSize(400, 300, 0), {
		width: 400,
		height: 300,
	});
	assert.deepEqual(computeRotatedSize(400, 300, 360), {
		width: 400,
		height: 300,
	});
	// 90° / 270° / -90°: 縦横が入れ替わる
	assert.deepEqual(computeRotatedSize(400, 300, 90), {
		width: 300,
		height: 400,
	});
	assert.deepEqual(computeRotatedSize(400, 300, 270), {
		width: 300,
		height: 400,
	});
	assert.deepEqual(computeRotatedSize(400, 300, -90), {
		width: 300,
		height: 400,
	});
	// 180°: 元サイズを維持（cos(π)の浮動小数点誤差で 401×301 にならないこと）
	assert.deepEqual(computeRotatedSize(400, 300, 180), {
		width: 400,
		height: 300,
	});
});

test('computeRotatedSize: 45° 回転の外接矩形は √2 倍を切り上げ', () => {
	// 100 × (cos45 + sin45) = 141.42… → 142
	assert.deepEqual(computeRotatedSize(100, 100, 45), {
		width: 142,
		height: 142,
	});
});

test('computeRotatedSize: 任意角度では外接矩形を縮めない（画像が欠けない）', () => {
	// 2520×4753 @ -166° は width の数学的下界が 3595.000000000732 となり、
	// 一律のイプシロン減算だと ceil が 3595 に縮んで画像端が欠けるケース
	const rad = Math.abs(((-166 % 360) * Math.PI) / 180);
	const cos = Math.abs(Math.cos(rad));
	const sin = Math.abs(Math.sin(rad));
	assert.deepEqual(computeRotatedSize(2520, 4753, -166), {
		width: Math.ceil(2520 * cos + 4753 * sin),
		height: Math.ceil(2520 * sin + 4753 * cos),
	});
});

// ---------------------------------------------------------------------------
// buildEditedFilename / mimeForFormat / needsBackgroundComposite
// ---------------------------------------------------------------------------

test('buildEditedFilename: 拡張子を出力形式に置き換え _edited を付与', () => {
	assert.equal(buildEditedFilename('photo.png', 'jpeg'), 'photo_edited.jpg');
	assert.equal(buildEditedFilename('photo.jpg', 'png'), 'photo_edited.png');
	assert.equal(buildEditedFilename('photo.png', 'webp'), 'photo_edited.webp');
});

test('buildEditedFilename: 拡張子なし・ベース名なしのフォールバック', () => {
	assert.equal(buildEditedFilename('noext', 'png'), 'noext_edited.png');
	assert.equal(buildEditedFilename('.png', 'png'), 'image_edited.png');
	// 多段拡張子は最後の1つだけ除去する
	assert.equal(
		buildEditedFilename('archive.tar.gz', 'png'),
		'archive.tar_edited.png',
	);
});

test('mimeForFormat: 各形式のMIMEタイプ', () => {
	assert.equal(mimeForFormat('png'), 'image/png');
	assert.equal(mimeForFormat('jpeg'), 'image/jpeg');
	assert.equal(mimeForFormat('webp'), 'image/webp');
});

test('needsBackgroundComposite: JPEGのみ背景合成が必要', () => {
	assert.equal(needsBackgroundComposite('jpeg'), true);
	assert.equal(needsBackgroundComposite('png'), false);
	assert.equal(needsBackgroundComposite('webp'), false);
});

// ---------------------------------------------------------------------------
// computeCenterCrop
// ---------------------------------------------------------------------------

test('computeCenterCrop: ratio が null / 0以下 はクロップなし', () => {
	assert.equal(computeCenterCrop(400, 300, null), undefined);
	assert.equal(computeCenterCrop(400, 300, 0), undefined);
	assert.equal(computeCenterCrop(400, 300, -1), undefined);
});

test('computeCenterCrop: 横長画像を正方形に中央クロップ', () => {
	assert.deepEqual(computeCenterCrop(1920, 1080, 1), {
		x: 420,
		y: 0,
		width: 1080,
		height: 1080,
	});
});

test('computeCenterCrop: 縦長画像を正方形に中央クロップ', () => {
	assert.deepEqual(computeCenterCrop(1080, 1920, 1), {
		x: 0,
		y: 420,
		width: 1080,
		height: 1080,
	});
});

test('computeCenterCrop: 比率が一致する場合は画像全体', () => {
	assert.deepEqual(computeCenterCrop(800, 600, 4 / 3), {
		x: 0,
		y: 0,
		width: 800,
		height: 600,
	});
});
