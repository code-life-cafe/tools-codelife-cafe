// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/image-metadata.test.ts
//
// Canvas 依存の再エンコード処理はブラウザ専用のため E2E で検証する。
// ここではバリデーションと出力形式・ファイル名解決を対象とする。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildMetadataOutputFileName,
	MAX_METADATA_FILE_COUNT,
	MAX_METADATA_FILE_SIZE,
	resolveMetadataOutputType,
	validateMetadataFileCount,
	validateMetadataImageFile,
} from '../../src/lib/tools/image-metadata.ts';

test('validateMetadataImageFile: 対応形式とサイズを検証する', () => {
	assert.equal(
		validateMetadataImageFile({ type: 'image/jpeg', size: 1000 } as File),
		null,
	);
	assert.equal(
		validateMetadataImageFile({ type: 'image/png', size: 1000 } as File),
		null,
	);
	assert.equal(
		validateMetadataImageFile({ type: 'image/webp', size: 1000 } as File),
		null,
	);
	assert.match(
		validateMetadataImageFile({ type: 'image/gif', size: 1000 } as File) ?? '',
		/JPEG・PNG・WebP/,
	);
	assert.match(
		validateMetadataImageFile({ type: 'image/jpeg', size: 0 } as File) ?? '',
		/空/,
	);
	assert.match(
		validateMetadataImageFile({
			type: 'image/jpeg',
			size: MAX_METADATA_FILE_SIZE + 1,
		} as File) ?? '',
		/25MB以下/,
	);
});

test('validateMetadataFileCount: 20枚上限を検証する', () => {
	assert.equal(validateMetadataFileCount(0, MAX_METADATA_FILE_COUNT), null);
	assert.match(
		validateMetadataFileCount(1, MAX_METADATA_FILE_COUNT) ?? '',
		/最大20枚/,
	);
});

test('resolveMetadataOutputType: original は入力形式を維持し未知形式はJPEGにフォールバックする', () => {
	assert.equal(resolveMetadataOutputType('image/png', 'original'), 'image/png');
	assert.equal(
		resolveMetadataOutputType('image/webp', 'original'),
		'image/webp',
	);
	assert.equal(
		resolveMetadataOutputType('image/gif', 'original'),
		'image/jpeg',
	);
	assert.equal(resolveMetadataOutputType('image/png', 'jpeg'), 'image/jpeg');
	assert.equal(resolveMetadataOutputType('image/png', 'webp'), 'image/webp');
});

test('buildMetadataOutputFileName: 拡張子を出力形式に合わせる', () => {
	assert.equal(
		buildMetadataOutputFileName('photo.jpeg', 'image/jpeg'),
		'photo-metadata-removed.jpg',
	);
	assert.equal(
		buildMetadataOutputFileName('capture.png', 'image/webp'),
		'capture-metadata-removed.webp',
	);
	assert.equal(
		buildMetadataOutputFileName('no-extension', 'image/png'),
		'no-extension-metadata-removed.png',
	);
});
