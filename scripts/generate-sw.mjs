// ビルド後に実行し、dist/ を走査して dist/sw.js へページ・アセット URL リストを注入する

import { createHash } from 'crypto';
import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const DIST = './dist';

// dist/ 直下のディレクトリ（各ルートページ）を収集
// `data` は静的データ配信用（/data/zipcode/*.json 等）、`og` は OGP 画像
// （generate-og-images.mjs が生成）でページではないため除外。
// これらはプリキャッシュせず、Service Worker のランタイム cache-first で扱う。
const entries = await readdir(DIST, { withFileTypes: true });
const pageURLs = [
	'/',
	...entries
		.filter(
			(d) =>
				d.isDirectory() &&
				!d.name.startsWith('_') &&
				d.name !== 'data' &&
				d.name !== 'og',
		)
		.map((d) => `/${d.name}/`),
];

// dist/_astro/ 配下の全ファイルを収集
let assetFiles = [];
try {
	assetFiles = await readdir(join(DIST, '_astro'));
} catch {
	// _astro/ が存在しない場合は空配列のまま続行
}

// 大容量かつオンデマンド読み込みのコーデックはプリキャッシュから除外する。
// - avif_enc* : AVIF エンコーダ（@jsquash/avif）。/image-convert で出力AVIF選択時のみロード
// - wasm-bundle.* : libheif（HEICデコード）。/image-convert に HEIC を投入した時のみロード
// これらは fetch ハンドラの /_astro cache-first で実行時に取得・キャッシュされるため、
// 初期プリキャッシュ（PRECACHE_ALL）を数十MB肥大化させないよう除外する。
const ON_DEMAND_CODEC = /^(avif_(enc|dec)|wasm-bundle\.)/;
const precacheAssetFiles = assetFiles.filter((f) => !ON_DEMAND_CODEC.test(f));
const excludedCount = assetFiles.length - precacheAssetFiles.length;
const assetURLs = precacheAssetFiles.map((f) => `/_astro/${f}`);

// ページHTML内容 + アセットURLからキャッシュバージョンハッシュを計算（内容変更時に自動失効）
const pageContents = await Promise.all(
	pageURLs.map(async (url) => {
		const filePath =
			url === '/'
				? join(DIST, 'index.html')
				: join(DIST, url.replace(/^\//, '').replace(/\/$/, ''), 'index.html');
		try {
			return await readFile(filePath, 'utf8');
		} catch {
			return url;
		}
	}),
);
const hash = createHash('md5')
	.update([...pageContents, ...assetURLs].sort().join('\n'))
	.digest('hex')
	.slice(0, 8);

// テンプレートのプレースホルダーを置換して dist/sw.js を上書き
const template = await readFile('./public/sw.js', 'utf8');
const output = template
	.replace(/(['"])cl-tools-__HASH__\1/, `'cl-tools-${hash}'`)
	.replace(
		/\[\s*\/\*\s*__ALL_PAGES__\s*\*\/\s*\]/,
		JSON.stringify(pageURLs, null, 2),
	)
	.replace(
		/\[\s*\/\*\s*__ALL_ASSETS__\s*\*\/\s*\]/,
		JSON.stringify(assetURLs, null, 2),
	);

// プレースホルダーが残っている場合はテンプレートの構造が変わっている
if (
	output.includes('__HASH__') ||
	output.includes('__ALL_PAGES__') ||
	output.includes('__ALL_ASSETS__')
) {
	throw new Error(
		'[generate-sw] Template replacement failed: placeholder still present in output. ' +
			'Verify that public/sw.js contains the expected placeholder strings.',
	);
}

await writeFile(join(DIST, 'sw.js'), output, 'utf8');

console.log(`[generate-sw] CACHE_NAME: cl-tools-${hash}`);
console.log(
	`[generate-sw] pages: ${pageURLs.length}, assets: ${assetURLs.length}` +
		(excludedCount > 0
			? ` (オンデマンドコーデック ${excludedCount} 件はプリキャッシュ除外)`
			: ''),
);
