import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
	NPM_PACKAGES,
	OCR_MODEL_BASE_PATH,
	OCR_MODEL_FILES,
	OCR_VENDOR_BASE_PATH,
	OCR_VENDOR_FILES,
	TESSDATA_FAST_REVISION,
	TESSERACT_CORE_VERSION,
	TESSERACT_JS_VERSION,
} from '../../src/lib/ocr/assets.ts';
import { OCR_THIRD_PARTY_LICENSES } from '../../src/lib/ocr/licenses.ts';

const publicPath = (base: string, file: string) =>
	path.join(process.cwd(), 'public', base.replace(/^\/|\/$/g, ''), file);

describe('OCR固定資産: コミット済みファイルがマニフェストと一致する', () => {
	const all = [
		...OCR_VENDOR_FILES.map((f) => ({ base: OCR_VENDOR_BASE_PATH, file: f })),
		...OCR_THIRD_PARTY_LICENSES.map((f) => ({
			base: OCR_VENDOR_BASE_PATH,
			file: f,
		})),
		...OCR_MODEL_FILES.map((f) => ({ base: OCR_MODEL_BASE_PATH, file: f })),
	];

	for (const { base, file } of all) {
		it(`${base}${file.path} の bytes と SHA-256`, () => {
			const bytes = fs.readFileSync(publicPath(base, file.path));
			assert.equal(bytes.length, file.bytes);
			assert.equal(
				createHash('sha256').update(bytes).digest('hex'),
				file.sha256,
			);
		});
	}

	it('版・revisionは固定値で、配信パスに含まれる', () => {
		assert.equal(TESSERACT_JS_VERSION, '7.0.0');
		assert.equal(TESSERACT_CORE_VERSION, '7.0.0');
		assert.match(TESSDATA_FAST_REVISION, /^[0-9a-f]{40}$/);
		assert.equal(OCR_VENDOR_BASE_PATH, `/vendor/ocr/${TESSERACT_JS_VERSION}/`);
		assert.equal(OCR_MODEL_BASE_PATH, `/models/ocr/${TESSDATA_FAST_REVISION}/`);
		assert.equal(NPM_PACKAGES['tesseract.js'].version, TESSERACT_JS_VERSION);
		assert.equal(
			NPM_PACKAGES['tesseract.js-core'].version,
			TESSERACT_CORE_VERSION,
		);
	});

	it('全ファイルが25MiB未満で、取得元はCDNではない', () => {
		for (const { file } of all) {
			assert.ok(file.bytes < 25 * 1024 * 1024);
			assert.ok(!file.source.includes('jsdelivr'));
			assert.ok(!file.source.includes('unpkg'));
		}
		for (const pkg of Object.values(NPM_PACKAGES)) {
			assert.ok(pkg.tarball.startsWith('https://registry.npmjs.org/'));
			assert.match(pkg.integrity, /^sha512-/);
			assert.match(pkg.sha256, /^[0-9a-f]{64}$/);
		}
	});

	it('SIMD・relaxed SIMD・非SIMDの3経路のLSTM専用coreがそろっている', () => {
		const cores = OCR_VENDOR_FILES.filter((f) => f.runtime === 'one-of-core')
			.map((f) => f.path)
			.sort();
		assert.deepEqual(cores, [
			'core/tesseract-core-lstm.wasm.js',
			'core/tesseract-core-relaxedsimd-lstm.wasm.js',
			'core/tesseract-core-simd-lstm.wasm.js',
		]);
	});

	it('ライセンス原文を同じ配信ディレクトリに含む', () => {
		const names = all.map((a) => a.file.path);
		assert.ok(names.includes('LICENSE-tesseract.js.txt'));
		assert.ok(names.includes('LICENSE-tesseract.js-core.txt'));
		assert.ok(names.includes('LICENSE-tessdata_fast.txt'));
		assert.ok(names.includes('worker.min.js.LICENSE.txt'));
		assert.equal(OCR_THIRD_PARTY_LICENSES.length, 21);
		assert.ok(OCR_THIRD_PARTY_LICENSES.some((f) => f.path.includes('libjpeg')));
		assert.ok(
			OCR_THIRD_PARTY_LICENSES.some((f) => f.path.includes('leptonica')),
		);
	});
});
