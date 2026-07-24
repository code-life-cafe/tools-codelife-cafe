import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	countChars,
	getServiceCounts,
	getServiceProgress,
	getXEffectiveCount,
	SERVICE_DEFINITIONS,
} from '../../src/lib/tools/char-count.ts';

test('countChars: 通常テキストの文字数・バイト数計算', () => {
	const result = countChars('あいう');
	assert.strictEqual(result.charsWithSpaces, 3);
	assert.strictEqual(result.bytesUtf8, 9);
	assert.strictEqual(result.bytesShiftJis, 6);
	assert.strictEqual(result.unsupportedShiftJisCount, 0);
});

test('countChars: Shift-JIS非対応文字（絵文字・補助平面漢字等）の検出と正確なバイト数・警告', () => {
	const text = 'テスト🎉𩸽'; // 🎉 と 𩸽 は SJIS 範囲外
	const result = countChars(text);

	assert.ok(
		result.unsupportedShiftJisCount > 0,
		'SJIS非対応文字が検出されること',
	);
	assert.strictEqual(result.hasUnsupportedShiftJis, true);
});

test('countChars: grapheme (見た目の文字数) の計測', () => {
	const text = '👨‍👩‍👧‍👦'; // 1グラフェム cluster
	const result = countChars(text);
	assert.strictEqual(result.graphemes, 1);
});

// ===== SNS・SEO 文字数制限 =====

test('SERVICE_DEFINITIONS: SNS5種・SEO2種が一元管理され、Xの基準が280字である', () => {
	const sns = SERVICE_DEFINITIONS.filter((s) => s.category === 'sns');
	const seo = SERVICE_DEFINITIONS.filter((s) => s.category === 'seo');
	assert.strictEqual(sns.length, 5);
	assert.strictEqual(seo.length, 2);

	const x = SERVICE_DEFINITIONS.find((s) => s.id === 'x');
	assert.ok(x);
	assert.strictEqual(x?.limit, 280);
	assert.strictEqual(x?.countMode, 'x-url-weighted');
});

test('SERVICE_DEFINITIONS: SEOはSNSと別カテゴリで、目安である旨の注記を持つ', () => {
	const seoTitle = SERVICE_DEFINITIONS.find((s) => s.id === 'seo-title');
	const seoDescription = SERVICE_DEFINITIONS.find(
		(s) => s.id === 'seo-description',
	);
	assert.strictEqual(seoTitle?.limit, 60);
	assert.strictEqual(seoDescription?.limit, 120);
	assert.match(seoTitle?.note ?? '', /目安/);
	assert.match(seoDescription?.note ?? '', /目安/);
});

test('getServiceProgress: 通常・80%警告・上限ちょうど・1字超過の境界値', () => {
	assert.strictEqual(getServiceProgress(0, 100).status, 'normal');
	assert.strictEqual(getServiceProgress(79, 100).status, 'normal');
	assert.strictEqual(getServiceProgress(80, 100).status, 'warning');
	assert.strictEqual(getServiceProgress(100, 100).status, 'warning');
	assert.strictEqual(getServiceProgress(100, 100).message, '残り 0文字');
	assert.strictEqual(getServiceProgress(101, 100).status, 'over');
	assert.strictEqual(getServiceProgress(101, 100).message, '1文字オーバー');
});

test('getServiceProgress: progressは0〜100にクランプされる', () => {
	assert.strictEqual(getServiceProgress(0, 100).progress, 0);
	assert.strictEqual(getServiceProgress(50, 100).progress, 50);
	assert.strictEqual(getServiceProgress(250, 100).progress, 100);
});

test('getServiceProgress: 残り文字数の文言', () => {
	assert.strictEqual(getServiceProgress(50, 100).message, '残り 50文字');
});

test('getXEffectiveCount: URLを含まないテキストはgrapheme数と一致する', () => {
	const text = 'こんにちは世界';
	assert.strictEqual(getXEffectiveCount(text), 7);
});

test('getXEffectiveCount: URL 1件は23字として換算される', () => {
	const text = 'https://example.com/path?query=1';
	assert.strictEqual(getXEffectiveCount(text), 23);
});

test('getXEffectiveCount: 複数URLはそれぞれ23字として換算される', () => {
	const text = 'https://a.example.com と https://b.example.com を見て';
	// 「 と 」(3) + 「 を見て」(4) = 7 + URL2件 × 23 = 46
	assert.strictEqual(getXEffectiveCount(text), 7 + 23 * 2);
});

test('getXEffectiveCount: 日本語・絵文字とURLの混在を正しく換算する', () => {
	const text = '見て🎉https://example.com/foo面白いよ';
	// 「見て🎉」(3 grapheme) + 「面白いよ」(4) = 7 + URL1件 × 23 = 30
	assert.strictEqual(getXEffectiveCount(text), 7 + 23);
});

test('getXEffectiveCount: URL末尾の句読点・括弧はURLに含めない', () => {
	const withPeriod = getXEffectiveCount('参考: https://example.com/a.');
	// 「参考: 」(4) + 「。」を含まないURL23字 + 末尾の「.」(1)
	assert.strictEqual(withPeriod, 4 + 23 + 1);

	const withParen = getXEffectiveCount(
		'参考(https://example.com/a)を見てください',
	);
	// 「参考(」(3) + URL23字 + 「)を見てください」(8)
	assert.strictEqual(withParen, 3 + 23 + 8);
});

test('getXEffectiveCount: 空文字は0字として扱う', () => {
	assert.strictEqual(getXEffectiveCount(''), 0);
});

test('getServiceCounts: XのURL換算は他サービスのgraphemeカウントに影響しない', () => {
	const text = 'https://example.com/path を共有';
	const services = getServiceCounts(text);
	const expectedGraphemes = countChars(text).graphemes;

	const x = services.find((s) => s.id === 'x');
	const bluesky = services.find((s) => s.id === 'bluesky');
	assert.ok(x && bluesky);
	assert.strictEqual(bluesky?.count, expectedGraphemes);
	assert.notStrictEqual(x?.count, expectedGraphemes);
});
