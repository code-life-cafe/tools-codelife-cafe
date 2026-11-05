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

test('getXEffectiveCount: 日本語は1文字につき重み2で数える（#620）', () => {
	const text = 'こんにちは世界';
	assert.strictEqual(getXEffectiveCount(text), 14);
});

test('getServiceCounts: 日本語140文字がXの上限、141文字は282で超過する（#620）', () => {
	for (const [length, count, remaining, status] of [
		[140, 280, 0, 'warning'],
		[141, 282, -2, 'over'],
	] as const) {
		const services = getServiceCounts('あ'.repeat(length));
		const x = services.find((service) => service.id === 'x');
		assert.ok(x);
		assert.strictEqual(x.count, count);
		assert.strictEqual(x.remaining, remaining);
		assert.strictEqual(x.status, status);
		assert.strictEqual(
			services.find((service) => service.id === 'bluesky')?.count,
			length,
		);
	}
});

test('getXEffectiveCount: 単体・肌色・ZWJ・国旗・キーキャップ絵文字はそれぞれ重み2（#620）', () => {
	for (const emoji of [
		'😀',
		'🙋🏽',
		'👨‍🎤',
		'👨‍👩‍👧‍👦',
		'🇯🇵',
		'1️⃣',
		'1\u20e3',
		'©️',
		'🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}',
	]) {
		assert.strictEqual(getXEffectiveCount(emoji), 2, emoji);
		assert.strictEqual(getXEffectiveCount(`${emoji}${emoji}`), 4, emoji);
	}
});

test('getXEffectiveCount: 公式の重み1範囲と既定の重み2の境界を守る（#620）', () => {
	for (const codePoint of [
		0, 0x10ff, 0x2000, 0x200d, 0x2010, 0x201f, 0x2032, 0x2037,
	]) {
		assert.strictEqual(
			getXEffectiveCount(String.fromCodePoint(codePoint)),
			1,
			codePoint.toString(16),
		);
	}
	for (const codePoint of [
		0x1100, 0x1fff, 0x200e, 0x200f, 0x2020, 0x2031, 0x2038, 0x20000,
	]) {
		assert.strictEqual(
			getXEffectiveCount(String.fromCodePoint(codePoint)),
			2,
			codePoint.toString(16),
		);
	}
	assert.strictEqual(getXEffectiveCount('a'.repeat(280)), 280);
	assert.strictEqual(getXEffectiveCount('a'.repeat(281)), 281);
	assert.strictEqual(getXEffectiveCount('©® 123\n'), 7);
});

test('getXEffectiveCount: NFC正規化後に絵文字以外はコードポイントごとに加算する（#620）', () => {
	assert.strictEqual(getXEffectiveCount('cafe\u0301'), 4);
	assert.strictEqual(getXEffectiveCount('か\u3099'), 2);
	assert.strictEqual(getXEffectiveCount('q\u0301'), 2);
	assert.strictEqual(getXEffectiveCount('a\u200db'), 3);
	assert.strictEqual(getXEffectiveCount('😀\u200d😀'), 5);
});

test('getXEffectiveCount: URL 1件は23字として換算される', () => {
	const text = 'https://example.com/path?query=1';
	assert.strictEqual(getXEffectiveCount(text), 23);
});

test('getXEffectiveCount: 複数URLはそれぞれ23字として換算される', () => {
	const text = 'https://a.example.com と https://b.example.com を見て';
	// 空白3字 + 日本語4字 × 2 + URL2件 × 23
	assert.strictEqual(getXEffectiveCount(text), 11 + 23 * 2);
});

test('getXEffectiveCount: 日本語・絵文字とURLの混在を正しく換算する', () => {
	const text = '見て🎉https://example.com/foo面白いよ';
	// 日本語6字 × 2 + 絵文字2 + URL1件 × 23
	assert.strictEqual(getXEffectiveCount(text), 14 + 23);
	assert.strictEqual(getXEffectiveCount('👨‍👩‍👧‍👦 https://example.com あ'), 29);
	// URLを取り除いた前後の絵文字を、新しいZWJ列として結合しない
	assert.strictEqual(getXEffectiveCount('👨https://example.com\u200d👩'), 28);
});

test('getXEffectiveCount: URL末尾の句読点・括弧はURLに含めない', () => {
	const withPeriod = getXEffectiveCount('参考: https://example.com/a.');
	// 「参考: 」(6) + URL23字 + 末尾の「.」(1)
	assert.strictEqual(withPeriod, 6 + 23 + 1);

	const withParen = getXEffectiveCount(
		'参考(https://example.com/a)を見てください',
	);
	// 「参考(」(5) + URL23字 + 「)を見てください」(15)
	assert.strictEqual(withParen, 5 + 23 + 15);
});

test('getXEffectiveCount: 空文字は0字として扱う', () => {
	assert.strictEqual(getXEffectiveCount(''), 0);
});

test('getXEffectiveCount: 強制u版でも日本語・絵文字140/141文字の境界がv版と一致する（F1）', () => {
	for (const char of ['あ', '👨‍👩‍👧‍👦', '🇯🇵', '1️⃣', '🙋🏽']) {
		for (const [length, count, remaining, status] of [
			[140, 280, 0, 'warning'],
			[141, 282, -2, 'over'],
		] as const) {
			const text = char.repeat(length);
			const fallbackCount = getXEffectiveCount(text, {
				forceEmojiFallback: true,
			});
			assert.strictEqual(fallbackCount, count, `${char} × ${length}`);
			assert.strictEqual(fallbackCount, getXEffectiveCount(text));
			const progress = getServiceProgress(fallbackCount, 280);
			assert.strictEqual(progress.remaining, remaining);
			assert.strictEqual(progress.status, status);
		}
	}
});

test('getXEffectiveCount: 強制u版のZWJ・国旗・キーキャップ・修飾子・VS16・タグ列は重み2（F1）', () => {
	for (const emoji of [
		'😀',
		'🙋🏽',
		'👩🏽‍💻',
		'👨‍🎤',
		'👨‍👩‍👧‍👦',
		'🇯🇵',
		'🇺🇸',
		...Array.from('#*0123456789').flatMap((char) => [
			`${char}\uFE0F\u20E3`,
			`${char}\u20E3`,
		]),
		'©️',
		'®️',
		'❤️',
		'🏳️‍🌈',
		'🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}',
	]) {
		for (const length of [1, 2]) {
			const text = emoji.repeat(length);
			const fallbackCount = getXEffectiveCount(text, {
				forceEmojiFallback: true,
			});
			assert.strictEqual(fallbackCount, 2 * length, text);
			assert.strictEqual(fallbackCount, getXEffectiveCount(text), text);
		}
	}
});

test('getXEffectiveCount: 強制u版でも通常文字・NFC・URL前後の分離を維持する（F1）', () => {
	for (const [text, expected] of [
		['', 0],
		['©® #*0123456789\n', 16],
		['cafe\u0301', 4],
		['か\u3099', 2],
		['a\u200db', 3],
		['👨‍👩‍👧‍👦 https://example.com あ', 29],
		['👨https://example.com\u200d👩', 28],
	] as const) {
		const fallbackCount = getXEffectiveCount(text, {
			forceEmojiFallback: true,
		});
		assert.strictEqual(fallbackCount, expected, text);
		assert.strictEqual(fallbackCount, getXEffectiveCount(text), text);
	}
});

test('getXEffectiveCount: v非対応時も遅延生成したu版を再利用して計算できる（F1）', async (t) => {
	const constructedFlags: string[] = [];
	t.mock.method(
		globalThis,
		'RegExp',
		new Proxy(RegExp, {
			construct(target, args) {
				const flags = args[1] ?? '';
				constructedFlags.push(flags);
				if (flags.includes('v')) {
					throw new SyntaxError('vフラグ非対応');
				}
				return Reflect.construct(target, args);
			},
		}),
	);
	const isolated = await import(
		new URL('../../src/lib/tools/char-count.ts?unsupported-v', import.meta.url)
			.href
	);
	assert.deepStrictEqual(constructedFlags, []);
	assert.strictEqual(isolated.countChars('あいう').charsWithSpaces, 3);
	assert.strictEqual(isolated.getXEffectiveCount('👨‍👩‍👧‍👦'), 2);
	assert.strictEqual(isolated.getXEffectiveCount('🇯🇵1️⃣🙋🏽'), 6);
	for (const length of [140, 141]) {
		const text = 'あ'.repeat(length);
		assert.deepStrictEqual(
			isolated.getServiceCounts(text),
			getServiceCounts(text),
		);
	}
	assert.deepStrictEqual(constructedFlags, ['gv', 'gu']);
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
