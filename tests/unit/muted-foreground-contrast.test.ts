// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/muted-foreground-contrast.test.ts
//
// 補助テキスト用の共通トークン --muted-foreground が、実際に重なる背景
// （--muted・--background・--card）に対して WCAG AA の通常文字コントラスト比
// 4.5:1 以上を満たすことを、global.css の値から計算して回帰的に検証する（Issue #746）。
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
const tabsSource = fs.readFileSync(
	path.join(repoRoot, 'src/components/ui/tabs.tsx'),
	'utf-8',
);

/** :root {...} または .dark {...} ブロックから `--name: #hex;` の値を抽出する */
function readCssVar(css: string, blockSelector: string, varName: string): Rgb {
	const blockMatch = css.match(
		new RegExp(`${blockSelector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`),
	);
	assert.ok(blockMatch, `CSS block ${blockSelector} must exist`);
	const varMatch = blockMatch[1].match(
		new RegExp(`--${varName}:\\s*(#[0-9A-Fa-f]{6})\\s*;`),
	);
	assert.ok(varMatch, `--${varName} must be a 6-digit hex in ${blockSelector}`);
	const rgb = hexToRgb(varMatch[1]);
	assert.ok(rgb, 'hex color must parse');
	return rgb as Rgb;
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

const WCAG_AA_NORMAL_TEXT = 4.5;
const BACKGROUNDS = ['muted', 'background', 'card'] as const;

for (const [mode, selector] of [
	['ライト', ':root'],
	['ダーク', '.dark'],
] as const) {
	for (const background of BACKGROUNDS) {
		test(`--muted-foreground が${mode}モードの --${background} 上でWCAG AA(4.5:1)を満たす`, () => {
			const text = readCssVar(globalCss, selector, 'muted-foreground');
			const bg = readCssVar(globalCss, selector, background);
			const ratio = contrastRatio(text, bg);
			assert.ok(
				ratio >= WCAG_AA_NORMAL_TEXT,
				`${mode}モードの --muted-foreground / --${background} が ${ratio.toFixed(2)}:1（${WCAG_AA_NORMAL_TEXT}:1 未満）`,
			);
		});
	}
}

test('コントラスト計算は既知の値（#78716C on #F5F5F4 = 4.40:1 で不合格）を再現する', () => {
	const ratio = contrastRatio(
		hexToRgb('#78716C') as Rgb,
		hexToRgb('#F5F5F4') as Rgb,
	);
	assert.equal(ratio.toFixed(2), '4.40');
	assert.ok(ratio < WCAG_AA_NORMAL_TEXT);
});

test('非選択タブの文字色は半透明の前景色ではなく --muted-foreground を使う', () => {
	// text-foreground/60 は bg-muted 上で 4.45:1 となり基準に届かなかった（#746）。
	assert.ok(
		!/text-foreground\/\d+/.test(tabsSource),
		'TabsTrigger に半透明の text-foreground/NN を使わないこと',
	);
	assert.match(tabsSource, /text-muted-foreground hover:text-foreground/);
});
