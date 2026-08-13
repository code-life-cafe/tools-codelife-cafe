// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/phone-formatter.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ParsedPhoneNumberFull } from 'awesome-phonenumber';
import {
	generateCsvOutput,
	parseCsvColumn,
	processBulk,
} from '../../src/lib/phone-formatter/bulk.ts';
import {
	classifyNumber,
	getNumberTypeLabel,
} from '../../src/lib/phone-formatter/classify.ts';
import { parsePhoneNumber } from '../../src/lib/phone-formatter/parse.ts';
import { preprocessInput } from '../../src/lib/phone-formatter/preprocess.ts';
import { getRegionName } from '../../src/lib/phone-formatter/regions.ts';
import type { ParseResult } from '../../src/lib/phone-formatter/types.ts';
import { validateCsvFile } from '../../src/lib/phone-formatter/validation.ts';

function fakeParsed(
	overrides: Partial<{ national: string; type: string }>,
): ParsedPhoneNumberFull {
	return {
		number: { national: overrides.national ?? '' },
		type: overrides.type ?? 'unknown',
	} as unknown as ParsedPhoneNumberFull;
}

function fakeFile(name: string, size: number): File {
	return { name, size } as unknown as File;
}

// ============================================================
// preprocessInput
// ============================================================

test('preprocessInput: 全角数字とハイフンを半角に変換する', () => {
	assert.equal(preprocessInput('０３−１２３４−５６７８'), '0312345678');
});

test('preprocessInput: 先頭の + は保持する', () => {
	assert.equal(preprocessInput('+81 3-1234-5678'), '+81312345678');
});

test('preprocessInput: 全角括弧を除去する', () => {
	assert.equal(preprocessInput('（03）1234-5678'), '0312345678');
});

test('preprocessInput: 空文字はそのまま空文字を返す', () => {
	assert.equal(preprocessInput(''), '');
});

// ============================================================
// classifyNumber / getNumberTypeLabel
// ============================================================

test('classifyNumber: 050始まりは ip_phone', () => {
	assert.equal(
		classifyNumber(fakeParsed({ national: '05012345678' })),
		'ip_phone',
	);
});

test('classifyNumber: 0120/0800始まりは toll_free', () => {
	assert.equal(
		classifyNumber(fakeParsed({ national: '0120123456' })),
		'toll_free',
	);
	assert.equal(
		classifyNumber(fakeParsed({ national: '0800123456' })),
		'toll_free',
	);
});

test('classifyNumber: 070/080/090始まりは mobile', () => {
	for (const prefix of ['070', '080', '090']) {
		assert.equal(
			classifyNumber(fakeParsed({ national: `${prefix}12345678` })),
			'mobile',
		);
	}
});

test('classifyNumber: 日本ヒューリスティックに該当しない場合はライブラリの type を使う', () => {
	assert.equal(
		classifyNumber(fakeParsed({ national: '0312345678', type: 'fixed-line' })),
		'fixed',
	);
	assert.equal(
		classifyNumber(
			fakeParsed({ national: '0312345678', type: 'premium-rate' }),
		),
		'premium',
	);
	assert.equal(
		classifyNumber(fakeParsed({ national: '0312345678', type: 'pager' })),
		'pager',
	);
	assert.equal(
		classifyNumber(
			fakeParsed({ national: '0312345678', type: 'something-else' }),
		),
		'unknown',
	);
});

test('getNumberTypeLabel: 全種別の日本語ラベルを返す', () => {
	assert.equal(getNumberTypeLabel('fixed'), '固定電話');
	assert.equal(getNumberTypeLabel('mobile'), '携帯電話');
	assert.equal(getNumberTypeLabel('ip_phone'), 'IP電話');
	assert.equal(getNumberTypeLabel('toll_free'), 'フリーダイヤル');
	assert.equal(getNumberTypeLabel('premium'), '有料通話');
	assert.equal(getNumberTypeLabel('pager'), 'ポケベル');
	assert.equal(getNumberTypeLabel('unknown'), '不明');
});

// ============================================================
// getRegionName
// ============================================================

test('getRegionName: 東京23区(03)を検出する', () => {
	assert.equal(getRegionName('0312345678'), '東京23区');
});

test('getRegionName: 携帯電話番号は null を返す', () => {
	assert.equal(getRegionName('09012345678'), null);
});

test('getRegionName: フリーダイヤルは null を返す', () => {
	assert.equal(getRegionName('0120123456'), null);
});

test('getRegionName: 3桁エリアコード(045=横浜)を最長一致で検出する', () => {
	assert.equal(getRegionName('0451234567'), '横浜');
});

test('getRegionName: 未知のエリアコードは null を返す', () => {
	assert.equal(getRegionName('0211234567'), null);
});

// ============================================================
// parsePhoneNumber（awesome-phonenumber 実ライブラリを使用）
// ============================================================

test('parsePhoneNumber: 空入力は valid: false, error なし', () => {
	const result = parsePhoneNumber('');
	assert.equal(result.valid, false);
	assert.equal(result.formats, null);
	assert.equal(result.error, undefined);
});

test('parsePhoneNumber: 有効な固定電話番号をパースできる', () => {
	const result = parsePhoneNumber('03-1234-5678');
	assert.equal(result.valid, true);
	assert.equal(result.numberType, 'fixed');
	assert.equal(result.regionName, '東京23区');
	assert.equal(result.formats?.e164, '+81312345678');
});

test('parsePhoneNumber: 全角入力も正しくパースできる', () => {
	const result = parsePhoneNumber('０９０−１２３４−５６７８');
	assert.equal(result.valid, true);
	assert.equal(result.numberType, 'mobile');
});

test('parsePhoneNumber: 不正な文字列は valid: false でエラーメッセージを持つ', () => {
	const result = parsePhoneNumber('abc');
	assert.equal(result.valid, false);
	assert.ok(result.error && result.error.length > 0);
});

test('parsePhoneNumber: 桁数が足りない番号は無効と判定される', () => {
	const result = parsePhoneNumber('03-12');
	assert.equal(result.valid, false);
});

// ============================================================
// processBulk
// ============================================================

test('processBulk: 空行は除外され、有効/無効件数を集計する', () => {
	const result = processBulk(['03-1234-5678', '', '  ', 'invalid']);
	assert.equal(result.summary.total, 2);
	assert.equal(result.summary.valid, 1);
	assert.equal(result.summary.invalid, 1);
});

test('processBulk: 上限件数を超えると例外を投げる', () => {
	const many = Array.from({ length: 10001 }, () => '03-1234-5678');
	assert.throws(() => processBulk(many));
});

test('processBulk: 上限件数ちょうどはエラーにならない', () => {
	const exact = Array.from({ length: 10000 }, () => '03-1234-5678');
	const result = processBulk(exact);
	assert.equal(result.summary.total, 10000);
});

// ============================================================
// parseCsvColumn
// ============================================================

test('parseCsvColumn: ヘッダーありCSVから指定カラムを抽出する', () => {
	const csv = 'name,phone\nAlice,03-1234-5678\nBob,090-1111-2222';
	const result = parseCsvColumn(csv, 1, true);
	assert.deepEqual(result, ['03-1234-5678', '090-1111-2222']);
});

test('parseCsvColumn: ヘッダーなしCSVは全行を対象にする', () => {
	const csv = '03-1234-5678\n090-1111-2222';
	const result = parseCsvColumn(csv, 0, false);
	assert.deepEqual(result, ['03-1234-5678', '090-1111-2222']);
});

test('parseCsvColumn: 空セルは除外される', () => {
	const csv = 'name,phone\nAlice,\nBob,090-1111-2222';
	const result = parseCsvColumn(csv, 1, true);
	assert.deepEqual(result, ['090-1111-2222']);
});

// ============================================================
// generateCsvOutput
// ============================================================

test('generateCsvOutput: UTF-8 BOMを先頭に付与する', () => {
	const results: ParseResult[] = [
		{
			valid: true,
			input: '03-1234-5678',
			cleaned: '0312345678',
			formats: {
				e164: '+81312345678',
				international: '+81 3-1234-5678',
				national: '03-1234-5678',
				rfc3966: 'tel:+81-3-1234-5678',
			},
			numberType: 'fixed',
			regionName: '東京23区',
			countryCode: 'JP',
		},
	];
	const csv = generateCsvOutput(results, ['input', 'e164', 'type']);
	assert.equal(csv[0], '﻿');
	assert.ok(csv.includes('入力'));
	assert.ok(csv.includes('E.164'));
	assert.ok(csv.includes('種別'));
	assert.ok(csv.includes('固定電話'));
});

// ============================================================
// validateCsvFile
// ============================================================

test('validateCsvFile: 非対応拡張子はエラー', () => {
	const result = validateCsvFile(fakeFile('data.xlsx', 100));
	assert.equal(result.valid, false);
});

test('validateCsvFile: 5MB超はエラー', () => {
	const result = validateCsvFile(fakeFile('data.csv', 6 * 1024 * 1024));
	assert.equal(result.valid, false);
});

test('validateCsvFile: 対応拡張子かつサイズ内は有効', () => {
	const result = validateCsvFile(fakeFile('data.csv', 100));
	assert.equal(result.valid, true);
});
