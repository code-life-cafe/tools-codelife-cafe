// ビルド後（astro build の後、generate-sw.mjs の前）に実行し、
// ツールごとの OGP 画像（1200x630 PNG）を dist/og/ に静的生成する。
//
// - ツール一覧は src/lib/tools/catalog.ts から取得（Node の型ストリッピングで直接 import）
// - 日本語フォント（Noto Sans JP）は Google Fonts からビルド時にダウンロードし、
//   scripts/.cache/fonts/ にキャッシュする（.gitignore 済み）
// - 生成画像はコミットせず、デプロイ成果物（dist/）にのみ含まれる

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';
import { toolCatalog } from '../src/lib/tools/catalog.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_CACHE_DIR = join(ROOT, 'scripts', '.cache', 'fonts');
const OUT_DIR = join(ROOT, 'dist', 'og');

const WIDTH = 1200;
const HEIGHT = 630;

// サイトのデザイントークン（src/styles/global.css のダークモード配色に準拠）
const COLORS = {
	background: '#0C0A09',
	backgroundEnd: '#1C1917',
	foreground: '#FAFAF9',
	muted: '#A8A29E',
	accent: '#2DD4BF',
	primary: '#1E40AF',
	safety: '#34D399',
	border: '#292524',
};

// 旧ブラウザの UA を指定すると unicode-range 分割のないフル TTF の URL が返る
const LEGACY_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/534.30 (KHTML, like Gecko) Chrome/12.0.742.112 Safari/534.30';
const FONT_CSS_URL =
	'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap';

const LOCAL_FONT_CANDIDATES = {
	regular: [
		'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
		'/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
		'/usr/share/fonts/truetype/noto/NotoSansJP-Regular.otf',
		'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
	],
	bold: [
		'/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
		'/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
		'/usr/share/fonts/truetype/noto/NotoSansJP-Bold.otf',
		'/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
	],
};

async function readFirstAvailable(paths) {
	for (const path of paths) {
		try {
			return await readFile(path);
		} catch {
			// 次の候補を試す
		}
	}
	return null;
}

async function loadLocalFallbackFonts() {
	const [regular, bold] = await Promise.all([
		readFirstAvailable(LOCAL_FONT_CANDIDATES.regular),
		readFirstAvailable(LOCAL_FONT_CANDIDATES.bold),
	]);
	if (regular && bold) {
		console.warn(
			'[generate-og] フォント: Google Fonts 取得に失敗したためローカルフォントを使用します',
		);
		return { regular, bold };
	}
	return null;
}

/**
 * Noto Sans JP の TTF を取得する（キャッシュ優先、なければ Google Fonts からダウンロード）
 * @returns {Promise<{regular: Buffer, bold: Buffer}>}
 */
async function loadFonts() {
	await mkdir(FONT_CACHE_DIR, { recursive: true });
	const cachePaths = {
		regular: join(FONT_CACHE_DIR, 'noto-sans-jp-400.ttf'),
		bold: join(FONT_CACHE_DIR, 'noto-sans-jp-700.ttf'),
	};

	try {
		const [regular, bold] = await Promise.all([
			readFile(cachePaths.regular),
			readFile(cachePaths.bold),
		]);
		console.log('[generate-og] フォント: キャッシュを使用');
		return { regular, bold };
	} catch {
		// キャッシュなし → ダウンロードへ
	}

	console.log('[generate-og] フォント: Google Fonts からダウンロード中...');
	let regular;
	let bold;
	try {
		const cssRes = await fetch(FONT_CSS_URL, {
			headers: { 'User-Agent': LEGACY_UA },
		});
		if (!cssRes.ok) {
			throw new Error(
				`[generate-og] フォントCSSの取得に失敗: HTTP ${cssRes.status}`,
			);
		}
		const css = await cssRes.text();

		// @font-face ブロックから weight ごとの TTF URL を抽出
		const urls = {};
		for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
			const weight = block.match(/font-weight:\s*(\d+)/)?.[1];
			const url = block.match(/src:\s*url\((https:[^)]+)\)/)?.[1];
			if (weight && url) urls[weight] = url;
		}
		if (!urls['400'] || !urls['700']) {
			throw new Error(
				'[generate-og] フォントURLの抽出に失敗（Google Fonts のレスポンス形式が変わった可能性）',
			);
		}

		const download = async (url) => {
			const res = await fetch(url);
			if (!res.ok) {
				throw new Error(
					`[generate-og] フォントのダウンロードに失敗: HTTP ${res.status} ${url}`,
				);
			}
			return Buffer.from(await res.arrayBuffer());
		};
		[regular, bold] = await Promise.all([
			download(urls['400']),
			download(urls['700']),
		]);
	} catch (error) {
		const fallback = await loadLocalFallbackFonts();
		if (!fallback) throw error;
		return fallback;
	}

	await Promise.all([
		writeFile(cachePaths.regular, regular),
		writeFile(cachePaths.bold, bold),
	]);
	return { regular, bold };
}

// satori 用の要素ツリーを生成するヘルパー（JSX なしで構築）
function h(type, props, ...children) {
	return {
		type,
		props: {
			...props,
			children: children.length === 1 ? children[0] : children,
		},
	};
}

/** タイトル文字数に応じてフォントサイズを調整（はみ出し防止） */
function titleFontSize(title) {
	if (title.length <= 10) return 80;
	if (title.length <= 14) return 68;
	return 56;
}

/** ツール1件分の OG 画像レイアウト */
function toolTemplate(tool) {
	return h(
		'div',
		{
			style: {
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				backgroundImage: `linear-gradient(135deg, ${COLORS.background} 0%, ${COLORS.backgroundEnd} 100%)`,
				padding: '56px 72px 0',
				fontFamily: 'Noto Sans JP',
			},
		},
		// ヘッダー: サイト名
		h(
			'div',
			{ style: { display: 'flex', alignItems: 'center', gap: '16px' } },
			h('div', {
				style: {
					display: 'flex',
					width: '20px',
					height: '20px',
					borderRadius: '6px',
					backgroundImage: `linear-gradient(135deg, ${COLORS.accent} 0%, ${COLORS.primary} 100%)`,
				},
			}),
			h(
				'div',
				{
					style: {
						display: 'flex',
						fontSize: '34px',
						fontWeight: 700,
						color: COLORS.foreground,
					},
				},
				h('span', { style: { color: COLORS.accent } }, 'CODE:LIFE'),
				h('span', { style: { marginLeft: '12px' } }, 'Tools'),
			),
		),
		// 中央: カテゴリ + ツール名 + 説明
		h(
			'div',
			{
				style: {
					display: 'flex',
					flexDirection: 'column',
					flexGrow: 1,
					justifyContent: 'center',
				},
			},
			h(
				'div',
				{
					style: {
						display: 'flex',
						alignSelf: 'flex-start',
						fontSize: '24px',
						color: COLORS.accent,
						border: `2px solid ${COLORS.border}`,
						borderRadius: '9999px',
						padding: '6px 24px',
						marginBottom: '28px',
					},
				},
				tool.category,
			),
			h(
				'div',
				{
					style: {
						display: 'flex',
						fontSize: `${titleFontSize(tool.title)}px`,
						fontWeight: 700,
						color: COLORS.foreground,
						lineHeight: 1.25,
						marginBottom: '24px',
					},
				},
				tool.title,
			),
			h(
				'div',
				{
					style: {
						display: 'flex',
						fontSize: '30px',
						color: COLORS.muted,
						lineHeight: 1.6,
					},
				},
				tool.description,
			),
		),
		// フッター: URL + 安全性の訴求
		h(
			'div',
			{
				style: {
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					paddingBottom: '40px',
				},
			},
			h(
				'div',
				{ style: { display: 'flex', fontSize: '26px', color: COLORS.muted } },
				'tools.codelife.cafe',
			),
			h(
				'div',
				{ style: { display: 'flex', fontSize: '24px', color: COLORS.safety } },
				'✓ データは外部送信されません',
			),
		),
		// 最下部: ブランドカラーのグラデーションバー
		h('div', {
			style: {
				display: 'flex',
				height: '14px',
				margin: '0 -72px',
				backgroundImage: `linear-gradient(90deg, ${COLORS.primary} 0%, ${COLORS.accent} 100%)`,
			},
		}),
	);
}

const { regular, bold } = await loadFonts();
const fonts = [
	{ name: 'Noto Sans JP', data: regular, weight: 400, style: 'normal' },
	{ name: 'Noto Sans JP', data: bold, weight: 700, style: 'normal' },
];

await mkdir(OUT_DIR, { recursive: true });

const started = Date.now();
for (const tool of toolCatalog) {
	const svg = await satori(toolTemplate(tool), {
		width: WIDTH,
		height: HEIGHT,
		fonts,
	});
	await sharp(Buffer.from(svg))
		.png({ compressionLevel: 9 })
		.toFile(join(OUT_DIR, `${tool.id}.png`));
}

console.log(
	`[generate-og] ${toolCatalog.length} 枚の OG 画像を dist/og/ に生成（${((Date.now() - started) / 1000).toFixed(1)}s）`,
);
