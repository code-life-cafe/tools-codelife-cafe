// assets.ts — /image-ocr が使うOCR資産のマニフェスト（固定版・SHA-256）
//
// ここに列挙したファイルだけを同一オリジンの静的ファイルとして配信する。
// CDN（jsDelivr）既定値へのフォールバックは禁止。内容を変える場合はパス（版/revision）も変える。
// 取得・検証: node scripts/prepare-ocr-assets.mjs（準備時のみ公式配布元へ接続する）

export const TESSERACT_JS_VERSION = '7.0.0';
export const TESSERACT_CORE_VERSION = '7.0.0';
/** tesseract-ocr/tessdata_fast のコミット（タグではなくハッシュ） */
export const TESSDATA_FAST_REVISION =
	'87416418657359cb625c412a48b6e1d6d41c29bd';

/** Worker・core の配信先（`<版>` を含む） */
export const OCR_VENDOR_BASE_PATH = `/vendor/ocr/${TESSERACT_JS_VERSION}/`;
/** 学習済み言語データの配信先（`<revision>` を含む） */
export const OCR_MODEL_BASE_PATH = `/models/ocr/${TESSDATA_FAST_REVISION}/`;

export type OcrAssetFile = {
	/** 配信ディレクトリからの相対パス */
	path: string;
	bytes: number;
	/** 小文字16進の sha256 */
	sha256: string;
	/** 取得元（npm tarball 内のパス、または raw URL） */
	source: string;
	/** 版ごとに実行時にいずれか1つだけ取得されるか（SIMD判定で選択） */
	runtime: 'always' | 'one-of-core';
};

/** npm レジストリ配布物（tarball の sha512 integrity も固定） */
export const NPM_PACKAGES = {
	'tesseract.js': {
		version: TESSERACT_JS_VERSION,
		tarball: 'https://registry.npmjs.org/tesseract.js/-/tesseract.js-7.0.0.tgz',
		integrity:
			'sha512-exPBkd+z+wM1BuMkx/Bjv43OeLBxhL5kKWsz/9JY+DXcXdiBjiAch0V49QR3oAJqCaL5qURE0vx9Eo+G5YE7mA==',
		sha256: '9a93bf51c3387f945d10a24bf8b3a4bf2e45c7c7161b8242aafbaf9d3c4b606a',
	},
	'tesseract.js-core': {
		version: TESSERACT_CORE_VERSION,
		tarball:
			'https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-7.0.0.tgz',
		integrity:
			'sha512-WnNH518NzmbSq9zgTPeoF8c+xmilS8rFIl1YKbk/ptuuc7p6cLNELNuPAzcmsYw450ca6bLa8j3t0VAtq435Vw==',
		sha256: 'ba584355515eaff877552022853c0e71f2cb70466e759d1d6940484929718ee0',
	},
} as const;

const TESSDATA_RAW = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${TESSDATA_FAST_REVISION}`;

/** `OCR_VENDOR_BASE_PATH` 配下（LSTM専用core。SIMD/relaxed-SIMD/非SIMDの3経路を全て置く） */
export const OCR_VENDOR_FILES: readonly (OcrAssetFile & {
	package: keyof typeof NPM_PACKAGES;
})[] = [
	{
		package: 'tesseract.js',
		path: 'worker.min.js.LICENSE.txt',
		bytes: 466,
		sha256: '45f54171aeaa1d10c0c1a66f374b7bba1f02472b1487fbe892eec04f840002ac',
		source: 'package/dist/worker.min.js.LICENSE.txt',
		runtime: 'always',
	},
	{
		package: 'tesseract.js',
		path: 'worker.min.js',
		bytes: 111307,
		sha256: '576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d',
		source: 'package/dist/worker.min.js',
		runtime: 'always',
	},
	{
		package: 'tesseract.js-core',
		path: 'core/tesseract-core-relaxedsimd-lstm.wasm.js',
		bytes: 3905767,
		sha256: '861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3',
		source: 'package/tesseract-core-relaxedsimd-lstm.wasm.js',
		runtime: 'one-of-core',
	},
	{
		package: 'tesseract.js-core',
		path: 'core/tesseract-core-simd-lstm.wasm.js',
		bytes: 3899472,
		sha256: 'c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38',
		source: 'package/tesseract-core-simd-lstm.wasm.js',
		runtime: 'one-of-core',
	},
	{
		package: 'tesseract.js-core',
		path: 'core/tesseract-core-lstm.wasm.js',
		bytes: 3896484,
		sha256: 'eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680',
		source: 'package/tesseract-core-lstm.wasm.js',
		runtime: 'one-of-core',
	},
	{
		package: 'tesseract.js',
		path: 'LICENSE-tesseract.js.txt',
		bytes: 11357,
		sha256: 'b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1',
		source: 'package/LICENSE.md',
		runtime: 'always',
	},
	{
		package: 'tesseract.js-core',
		path: 'LICENSE-tesseract.js-core.txt',
		bytes: 11358,
		sha256: 'c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08',
		source: 'package/LICENSE',
		runtime: 'always',
	},
];

/** `OCR_MODEL_BASE_PATH` 配下。無圧縮の `.traineddata`（gzip:false で読む） */
export const OCR_MODEL_FILES: readonly OcrAssetFile[] = [
	{
		path: 'jpn.traineddata',
		bytes: 2471260,
		sha256: '1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d',
		source: `${TESSDATA_RAW}/jpn.traineddata`,
		runtime: 'always',
	},
	{
		path: 'eng.traineddata',
		bytes: 4113088,
		sha256: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
		source: `${TESSDATA_RAW}/eng.traineddata`,
		runtime: 'always',
	},
	{
		path: 'LICENSE-tessdata_fast.txt',
		bytes: 11358,
		sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
		source: `${TESSDATA_RAW}/LICENSE`,
		runtime: 'always',
	},
];
