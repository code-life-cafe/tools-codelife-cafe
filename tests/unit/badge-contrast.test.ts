// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/badge-contrast.test.ts
//
// #747: 色付きの小さな文字（トップ・about・privacy の安全バッジ、カテゴリチップ、
// パスワード強度の表示）が、実際の背景に対して WCAG AA の 4.5:1 以上になることを
// 値から検証する。背景は bg-*/N をカード・ページ背景に重ねた色で計算する。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { toolCategories } from '../../src/lib/tools/catalog.ts';
import { hexToRgb, type Rgb } from '../../src/lib/tools/color.ts';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const read = (rel: string) =>
	fs.readFileSync(path.join(repoRoot, rel), 'utf-8');
const globalCss = read('src/styles/global.css');

const WCAG_AA_NORMAL_TEXT = 4.5;

function requireHex(hex: string): Rgb {
	const rgb = hexToRgb(hex);
	assert.ok(rgb, `hex color must parse: ${hex}`);
	return rgb as Rgb;
}

function readCssVar(blockSelector: ':root' | '.dark', varName: string): Rgb {
	const blockMatch = globalCss.match(
		new RegExp(`${blockSelector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`),
	);
	assert.ok(blockMatch, `CSS block ${blockSelector} must exist`);
	const varMatch = blockMatch[1].match(
		new RegExp(`--${varName}:\\s*(#[0-9A-Fa-f]{6})\\b`),
	);
	assert.ok(varMatch, `--${varName} must be defined in ${blockSelector}`);
	return requireHex(varMatch[1]);
}

function relativeLuminance(rgb: Rgb): number {
	const channel = (c: number) => {
		const v = c / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	return (
		0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
	);
}

function contrastRatio(a: Rgb, b: Rgb): number {
	const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort(
		(x, y) => y - x,
	);
	return (l1 + 0.05) / (l2 + 0.05);
}

function alphaBlend(foreground: Rgb, alpha: number, background: Rgb): Rgb {
	return {
		r: alpha * foreground.r + (1 - alpha) * background.r,
		g: alpha * foreground.g + (1 - alpha) * background.g,
		b: alpha * foreground.b + (1 - alpha) * background.b,
	};
}

type Mode = ':root' | '.dark';

/**
 * クラス文字列から、指定モードで効く文字色を返す。
 * ライト: `dark:` の付かない `text-[#hex]` / `text-<token>`。
 * ダーク: `dark:text-…` があればそれ、なければライトと同じクラス。
 */
function resolveTextColor(classes: string, mode: Mode): Rgb {
	const tokens = classes.split(/\s+/);
	const notColor = /^text-(xs|sm|base|lg|\d?xl|center|left|right|justify)$/;
	const pick = (list: string[]) =>
		list.find(
			(c) =>
				!notColor.test(c) &&
				/^text-(\[#[0-9A-Fa-f]{6}\]|[a-z][a-z0-9-]*)$/.test(c),
		);
	const light = pick(tokens);
	const dark = pick(
		tokens.filter((c) => c.startsWith('dark:')).map((c) => c.slice(5)),
	);
	const cls = mode === '.dark' ? (dark ?? light) : light;
	assert.ok(cls, `文字色クラスが見つからない: ${classes}`);
	const value = cls.slice('text-'.length);
	if (value.startsWith('[#')) return requireHex(value.slice(1, -1));
	return readCssVar(mode, value);
}

/** `bg-<token>/<n>` を背景色に重ねた実効背景色を返す */
function resolveTintedBg(classes: string, mode: Mode, base: Rgb): Rgb {
	const m = classes.match(/(?:^|\s)bg-([a-z][a-z0-9-]*)\/(\d+)(?:\s|$)/);
	assert.ok(m, `bg-<token>/<n> が見つからない: ${classes}`);
	return alphaBlend(readCssVar(mode, m[1]), Number(m[2]) / 100, base);
}

function assertContrast(label: string, fg: Rgb, bg: Rgb) {
	const ratio = contrastRatio(fg, bg);
	assert.ok(
		ratio >= WCAG_AA_NORMAL_TEXT,
		`${label}: コントラスト比 ${ratio.toFixed(2)}:1 が ${WCAG_AA_NORMAL_TEXT}:1 未満`,
	);
}

const modes: Mode[] = [':root', '.dark'];

test('カテゴリチップ（トップの絞り込み）の文字がカード背景上で4.5:1以上', () => {
	assert.ok(toolCategories.length > 0);
	for (const mode of modes) {
		const card = readCssVar(mode, 'card');
		for (const category of toolCategories) {
			assertContrast(
				`${mode} ${category.name}（${category.color}）`,
				resolveTextColor(category.color, mode),
				resolveTintedBg(category.color, mode, card),
			);
		}
	}
});

test('トップ・about・privacy の安全バッジの文字がページ背景上で4.5:1以上', () => {
	const sources: Array<[string, RegExp]> = [
		[
			'src/pages/index.astro',
			/class="([^"]*border-safety\/30 bg-safety\/5[^"]*)"/,
		],
		[
			'src/pages/about.astro',
			/class="([^"]*border-safety\/30 bg-safety\/5[^"]*)"/,
		],
	];
	for (const [file, re] of sources) {
		const m = read(file).match(re);
		assert.ok(m, `${file} に安全バッジがあること`);
		for (const mode of modes) {
			const page = readCssVar(mode, 'background');
			assertContrast(
				`${file} ${mode}`,
				resolveTextColor(m[1], mode),
				resolveTintedBg(m[1], mode, page),
			);
		}
	}

	// privacy は枠（bg-safety/5）の中の見出し文字
	const privacy = read('src/pages/privacy.astro');
	const box = privacy.match(
		/class="([^"]*border-safety\/30 bg-safety\/5[^"]*)"/,
	);
	const heading = privacy.match(
		/border-safety\/30 bg-safety\/5[^"]*">\s*<p class="([^"]*)"/,
	);
	assert.ok(box && heading, 'privacy に安全の枠と見出しがあること');
	for (const mode of modes) {
		const page = readCssVar(mode, 'background');
		assertContrast(
			`privacy.astro ${mode}`,
			resolveTextColor(heading[1], mode),
			resolveTintedBg(box[1], mode, page),
		);
	}
});

test('パスワード強度の文字色がライトのカード背景上で4.5:1以上', () => {
	const src = read('src/components/tools/PasswordGenerator.tsx');
	const block = src.match(
		/LEVEL_TEXT_CLASSES: Record<StrengthLevel, string> = \{([^}]*)\}/,
	);
	assert.ok(block, 'LEVEL_TEXT_CLASSES があること');
	const entries = [...block[1].matchAll(/(\d):\s*'([^']*)'/g)];
	assert.equal(entries.length, 5, '強度0〜4の5段階');
	const card = readCssVar(':root', 'card');
	for (const [, level, classes] of entries) {
		// ダーク側は Tailwind パレット（oklch）のため値の検証対象外。ライトだけ hex かトークンで固定する。
		assertContrast(
			`強度${level}（${classes}）`,
			resolveTextColor(classes, ':root'),
			card,
		);
	}
});
