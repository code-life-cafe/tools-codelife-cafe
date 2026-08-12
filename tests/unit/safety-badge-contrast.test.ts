// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/safety-badge-contrast.test.ts
//
// SafetyBadge（ツールページの「入力データ非送信」バッジ）の文字色が、
// 実際の背景（bg-safety/5 をページ背景に重ねた色）に対してWCAG AA基準の
// 通常文字コントラスト比 4.5:1 以上を満たすことを回帰的に検証する。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { hexToRgb, type Rgb } from '../../src/lib/tools/color.ts';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const globalCss = fs.readFileSync(
	path.join(repoRoot, 'src/styles/global.css'),
	'utf-8',
);
const safetyBadgeSource = fs.readFileSync(
	path.join(repoRoot, 'src/components/layout/SafetyBadge.tsx'),
	'utf-8',
);

function requireHex(rgb: Rgb | null): Rgb {
	assert.ok(rgb, 'hex color must parse');
	return rgb as Rgb;
}

/** :root {...} または .dark {...} ブロックから `--name: #hex;` の値を抽出する */
function readCssVar(css: string, blockSelector: string, varName: string): Rgb {
	const blockMatch = css.match(
		new RegExp(`${blockSelector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`),
	);
	assert.ok(blockMatch, `CSS block ${blockSelector} must exist`);
	const varMatch = blockMatch[1].match(
		new RegExp(`--${varName}:\\s*(#[0-9A-Fa-f]{3,8})`),
	);
	assert.ok(varMatch, `--${varName} must be defined in ${blockSelector}`);
	return requireHex(hexToRgb(varMatch[1]));
}

// WCAG 2.1: 相対輝度とコントラスト比
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

/** foreground を alpha 比率で background に重ねた実効色を返す（bg-safety/5 相当の合成） */
function alphaBlend(foreground: Rgb, alpha: number, background: Rgb): Rgb {
	return {
		r: alpha * foreground.r + (1 - alpha) * background.r,
		g: alpha * foreground.g + (1 - alpha) * background.g,
		b: alpha * foreground.b + (1 - alpha) * background.b,
	};
}

const WCAG_AA_NORMAL_TEXT = 4.5;

test('SafetyBadgeの文字色がライトモードでWCAG AA(4.5:1)を満たす', () => {
	const pageBg = readCssVar(globalCss, ':root', 'background');
	const safety = readCssVar(globalCss, ':root', 'safety');
	const badgeBg = alphaBlend(safety, 0.05, pageBg); // bg-safety/5

	const textHexMatch = safetyBadgeSource.match(/text-\[(#[0-9A-Fa-f]{6})\]/);
	assert.ok(
		textHexMatch,
		'SafetyBadgeのトリガーはライトモード用の明示的な文字色を持つこと',
	);
	const lightText = requireHex(hexToRgb(textHexMatch[1]));

	const ratio = contrastRatio(lightText, badgeBg);
	assert.ok(
		ratio >= WCAG_AA_NORMAL_TEXT,
		`ライトモードのコントラスト比 ${ratio.toFixed(2)}:1 が WCAG AA ${WCAG_AA_NORMAL_TEXT}:1 未満`,
	);
});

test('SafetyBadgeの文字色がダークモードでWCAG AA(4.5:1)を満たす', () => {
	const pageBg = readCssVar(globalCss, '.dark', 'background');
	const safety = readCssVar(globalCss, '.dark', 'safety');
	const badgeBg = alphaBlend(safety, 0.05, pageBg); // bg-safety/5

	assert.ok(
		/dark:text-safety\b/.test(safetyBadgeSource),
		'SafetyBadgeのトリガーはダークモードで --safety トークンを使うこと',
	);

	const ratio = contrastRatio(safety, badgeBg);
	assert.ok(
		ratio >= WCAG_AA_NORMAL_TEXT,
		`ダークモードのコントラスト比 ${ratio.toFixed(2)}:1 が WCAG AA ${WCAG_AA_NORMAL_TEXT}:1 未満`,
	);
});
