// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/tool-settings-validation.test.ts
//
// 共有URL/localStorage経由で復元される設定値の検証（型不一致・配列・null・範囲外の
// 各ケースでデフォルトへフォールバックすること）を対象とする純粋ロジックのテスト。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeCompressSettings } from '../../src/components/image-compress/settingsValidation.ts';
import { sanitizeConvertSettings } from '../../src/components/image-convert/settingsValidation.ts';
import { sanitizeCsvEditorSettings } from '../../src/lib/tools/csv-editor.ts';
import { sanitizeJsonFormatterSettings } from '../../src/lib/tools/json-formatter.ts';
import { sanitizeRegexTesterSettings } from '../../src/lib/tools/regex-tester.ts';
import { sanitizeSqlFormatterSettings } from '../../src/lib/tools/sql-formatter.ts';
import { sanitizeTaxCalcSettings } from '../../src/lib/tools/tax.ts';
import { sanitizeUuidSettings } from '../../src/lib/tools/uuid.ts';

// ---------------------------------------------------------------------------
// uuid (id-generator)
// ---------------------------------------------------------------------------

const uuidDefaults = {
	kind: 'uuid-v4' as const,
	count: 10,
	uppercase: false,
	hyphens: true,
};

test('sanitizeUuidSettings: 正常値はそのまま採用する', () => {
	const result = sanitizeUuidSettings(
		{ kind: 'ulid', count: 50, uppercase: true, hyphens: false },
		uuidDefaults,
	);
	assert.deepEqual(result, {
		kind: 'ulid',
		count: 50,
		uppercase: true,
		hyphens: false,
	});
});

test('sanitizeUuidSettings: null/配列/非オブジェクトはデフォルトへフォールバックする', () => {
	assert.deepEqual(sanitizeUuidSettings(null, uuidDefaults), uuidDefaults);
	assert.deepEqual(sanitizeUuidSettings([1, 2, 3], uuidDefaults), uuidDefaults);
	assert.deepEqual(sanitizeUuidSettings('uuid-v4', uuidDefaults), uuidDefaults);
});

test('sanitizeUuidSettings: 未知のkind・範囲外のcountはデフォルトへフォールバックする', () => {
	const result = sanitizeUuidSettings(
		{ kind: 'not-a-kind', count: 999999, uppercase: 'yes', hyphens: null },
		uuidDefaults,
	);
	assert.deepEqual(result, uuidDefaults);
});

test('sanitizeUuidSettings: countの型不一致（文字列・小数）はデフォルトへフォールバックする', () => {
	assert.equal(
		sanitizeUuidSettings({ count: '10' }, uuidDefaults).count,
		uuidDefaults.count,
	);
	assert.equal(
		sanitizeUuidSettings({ count: 1.5 }, uuidDefaults).count,
		uuidDefaults.count,
	);
	assert.equal(
		sanitizeUuidSettings({ count: 0 }, uuidDefaults).count,
		uuidDefaults.count,
	);
});

// ---------------------------------------------------------------------------
// json-formatter
// ---------------------------------------------------------------------------

test('sanitizeJsonFormatterSettings: 許可された値のみ採用する', () => {
	const defaults = { indent: '2' as const };
	assert.deepEqual(sanitizeJsonFormatterSettings({ indent: 'tab' }, defaults), {
		indent: 'tab',
	});
	assert.deepEqual(
		sanitizeJsonFormatterSettings({ indent: 8 }, defaults),
		defaults,
	);
	assert.deepEqual(
		sanitizeJsonFormatterSettings({ indent: ['2'] }, defaults),
		defaults,
	);
	assert.deepEqual(sanitizeJsonFormatterSettings(null, defaults), defaults);
});

// ---------------------------------------------------------------------------
// sql-formatter
// ---------------------------------------------------------------------------

const sqlDefaults = {
	autoFormat: true,
	dialect: 'sql' as const,
	indent: '2spaces' as const,
	uppercase: true,
	compress: false,
	isExpanded: false,
	layout: 'horizontal' as const,
};

test('sanitizeSqlFormatterSettings: 正常値はそのまま採用する', () => {
	const result = sanitizeSqlFormatterSettings(
		{
			autoFormat: false,
			dialect: 'postgresql',
			indent: 'tabs',
			uppercase: false,
			compress: true,
			isExpanded: true,
			layout: 'vertical',
		},
		sqlDefaults,
	);
	assert.deepEqual(result, {
		autoFormat: false,
		dialect: 'postgresql',
		indent: 'tabs',
		uppercase: false,
		compress: true,
		isExpanded: true,
		layout: 'vertical',
	});
});

test('sanitizeSqlFormatterSettings: 未知のdialect/indent/layoutと型不一致のbooleanはデフォルトへフォールバックする', () => {
	const result = sanitizeSqlFormatterSettings(
		{
			autoFormat: 'true',
			dialect: 'oracle',
			indent: '8spaces',
			uppercase: 1,
			compress: null,
			isExpanded: [],
			layout: 'diagonal',
		},
		sqlDefaults,
	);
	assert.deepEqual(result, sqlDefaults);
});

test('sanitizeSqlFormatterSettings: 配列/nullはデフォルトへフォールバックする', () => {
	assert.deepEqual(sanitizeSqlFormatterSettings([], sqlDefaults), sqlDefaults);
	assert.deepEqual(
		sanitizeSqlFormatterSettings(null, sqlDefaults),
		sqlDefaults,
	);
});

// ---------------------------------------------------------------------------
// csv-editor
// ---------------------------------------------------------------------------

const csvDefaults = { delimiter: ',', hasHeader: true };

test('sanitizeCsvEditorSettings: 許可された区切り文字のみ採用する', () => {
	assert.deepEqual(
		sanitizeCsvEditorSettings(
			{ delimiter: '\t', hasHeader: false },
			csvDefaults,
		),
		{ delimiter: '\t', hasHeader: false },
	);
	assert.deepEqual(
		sanitizeCsvEditorSettings({ delimiter: '\n' }, csvDefaults),
		csvDefaults,
	);
	assert.deepEqual(
		sanitizeCsvEditorSettings({ delimiter: ['|'] }, csvDefaults),
		csvDefaults,
	);
	assert.deepEqual(sanitizeCsvEditorSettings(null, csvDefaults), csvDefaults);
});

// ---------------------------------------------------------------------------
// regex-tester
// ---------------------------------------------------------------------------

const regexDefaults = {
	pattern: '\\d{3}-\\d{4}',
	flags: 'g',
	showReplace: false,
	replacement: '',
};

test('sanitizeRegexTesterSettings: 正常値はそのまま採用する', () => {
	const result = sanitizeRegexTesterSettings(
		{
			pattern: '^[a-z]+$',
			flags: 'gi',
			showReplace: true,
			replacement: 'x',
		},
		regexDefaults,
	);
	assert.deepEqual(result, {
		pattern: '^[a-z]+$',
		flags: 'gi',
		showReplace: true,
		replacement: 'x',
	});
});

test('sanitizeRegexTesterSettings: 不正なflags・過長なpatternはデフォルトへフォールバックする', () => {
	assert.equal(
		sanitizeRegexTesterSettings({ flags: 'z' }, regexDefaults).flags,
		regexDefaults.flags,
	);
	assert.equal(
		sanitizeRegexTesterSettings({ flags: ['g'] }, regexDefaults).flags,
		regexDefaults.flags,
	);
	assert.equal(
		sanitizeRegexTesterSettings({ pattern: 'a'.repeat(1001) }, regexDefaults)
			.pattern,
		regexDefaults.pattern,
	);
});

test('sanitizeRegexTesterSettings: 配列/nullはデフォルトへフォールバックする', () => {
	assert.deepEqual(
		sanitizeRegexTesterSettings([], regexDefaults),
		regexDefaults,
	);
	assert.deepEqual(
		sanitizeRegexTesterSettings(null, regexDefaults),
		regexDefaults,
	);
});

// ---------------------------------------------------------------------------
// tax
// ---------------------------------------------------------------------------

const taxDefaults = {
	mode: 'single' as const,
	direction: 'exclusive-to-inclusive' as const,
	rateSelection: '10',
	rounding: 'floor' as const,
};

test('sanitizeTaxCalcSettings: 正常値はそのまま採用する', () => {
	const result = sanitizeTaxCalcSettings(
		{
			mode: 'invoice',
			direction: 'inclusive-to-exclusive',
			rateSelection: '8-reduced',
			rounding: 'ceil',
		},
		taxDefaults,
	);
	assert.deepEqual(result, {
		mode: 'invoice',
		direction: 'inclusive-to-exclusive',
		rateSelection: '8-reduced',
		rounding: 'ceil',
	});
});

test('sanitizeTaxCalcSettings: 未定義のrateSelection・型不一致はデフォルトへフォールバックする（誤った税額表示の防止）', () => {
	const result = sanitizeTaxCalcSettings(
		{
			mode: 'batch',
			direction: 'sideways',
			rateSelection: '999',
			rounding: 'nearest',
		},
		taxDefaults,
	);
	assert.deepEqual(result, taxDefaults);
});

test('sanitizeTaxCalcSettings: 配列/nullはデフォルトへフォールバックする', () => {
	assert.deepEqual(sanitizeTaxCalcSettings([], taxDefaults), taxDefaults);
	assert.deepEqual(sanitizeTaxCalcSettings(null, taxDefaults), taxDefaults);
});

// ---------------------------------------------------------------------------
// image-compress
// ---------------------------------------------------------------------------

const compressDefaults = {
	format: 'keep' as const,
	quality: 0.8,
	resizeKind: 'none' as const,
	resizeValue: 1920,
	useTargetSize: false,
	targetKB: 500,
	background: '#ffffff',
};

test('sanitizeCompressSettings: 正常値はそのまま採用する', () => {
	const result = sanitizeCompressSettings(
		{
			format: 'webp',
			quality: 0.5,
			resizeKind: 'max-width',
			resizeValue: 800,
			useTargetSize: true,
			targetKB: 200,
			background: '#000000',
		},
		compressDefaults,
	);
	assert.deepEqual(result, {
		format: 'webp',
		quality: 0.5,
		resizeKind: 'max-width',
		resizeValue: 800,
		useTargetSize: true,
		targetKB: 200,
		background: '#000000',
	});
});

test('sanitizeCompressSettings: 範囲外の品質・不正な背景色・未知のformatはデフォルトへフォールバックする', () => {
	const result = sanitizeCompressSettings(
		{
			format: 'gif',
			quality: 5,
			resizeKind: 'diagonal',
			resizeValue: -100,
			useTargetSize: 'true',
			targetKB: Number.NaN,
			background: 'javascript:alert(1)',
		},
		compressDefaults,
	);
	assert.deepEqual(result, compressDefaults);
});

test('sanitizeCompressSettings: 配列/nullはデフォルトへフォールバックする', () => {
	assert.deepEqual(
		sanitizeCompressSettings([], compressDefaults),
		compressDefaults,
	);
	assert.deepEqual(
		sanitizeCompressSettings(null, compressDefaults),
		compressDefaults,
	);
});

// ---------------------------------------------------------------------------
// image-convert
// ---------------------------------------------------------------------------

const convertDefaults = {
	target: 'jpeg' as const,
	quality: 85,
	exif: 'strip' as const,
	background: '#ffffff',
};

test('sanitizeConvertSettings: 正常値はそのまま採用する', () => {
	const result = sanitizeConvertSettings(
		{ target: 'avif', quality: 60, exif: 'keep', background: '#123abc' },
		convertDefaults,
	);
	assert.deepEqual(result, {
		target: 'avif',
		quality: 60,
		exif: 'keep',
		background: '#123abc',
	});
});

test('sanitizeConvertSettings: 範囲外の品質・未知のtarget/exif・不正な背景色はデフォルトへフォールバックする', () => {
	const result = sanitizeConvertSettings(
		{ target: 'bmp', quality: 200, exif: 'rotate', background: 'red' },
		convertDefaults,
	);
	assert.deepEqual(result, convertDefaults);
});

test('sanitizeConvertSettings: 配列/nullはデフォルトへフォールバックする', () => {
	assert.deepEqual(
		sanitizeConvertSettings([], convertDefaults),
		convertDefaults,
	);
	assert.deepEqual(
		sanitizeConvertSettings(null, convertDefaults),
		convertDefaults,
	);
});
