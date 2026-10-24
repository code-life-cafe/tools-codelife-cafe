// ビルド後に実行し、dist/ を走査して dist/sw.js へページ・アセット URL リストを注入する

import { createHash } from 'crypto';
import { readdir, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { listAllowedRuntimePaths } from '../src/lib/transcribe/model-manifest.ts';

const DIST = './dist';

// dist/ 配下の実在するページを階層下まで収集
// `data` は静的データ配信用（/data/zipcode/*.json 等）、`og` は OGP 画像
// （generate-og-images.mjs が生成）、`models` は AI モデル（/upscale の超解像 ~5MB と
// /transcribe の Whisper ONNX。後者は実行時に取得）、`vendor` は /transcribe が使う
// ONNX Runtime Web、ドットディレクトリ（/.well-known/ 等のメタデータ配信）は
// ページではないため除外。runtimeは下のassetURLsで明示的にprecacheへ追加する。
// モデルはブラウザ Cache に乗るが precache には含めない。
async function collectPages(directory = '') {
	const pages = [];
	const entries = await readdir(join(DIST, directory), { withFileTypes: true });
	for (const entry of entries) {
		if (
			!entry.isDirectory() ||
			entry.name.startsWith('_') ||
			entry.name.startsWith('.') ||
			['data', 'og', 'models', 'vendor'].includes(entry.name) ||
			// ルート /tools/ 配下は旧URLの転送HTMLであり、保存対象にしない。
			(directory === '' && entry.name === 'tools')
		)
			continue;
		const relativePath = directory ? `${directory}/${entry.name}` : entry.name;
		try {
			if ((await stat(join(DIST, relativePath, 'index.html'))).isFile()) {
				pages.push(`/${relativePath}/`);
			}
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
		pages.push(...(await collectPages(relativePath)));
	}
	return pages;
}
const pageURLs = ['/', ...(await collectPages()).sort()];

// dist/_astro/ 配下の全ファイルを収集
// AVIF エンコーダ（@jsquash/avif）や libheif（HEICデコード）の WASM チャンクも含めて
// プリキャッシュ対象とする。PWA はオフラインでも全ツールが動作することを前提とするため、
// オフライン前に一度も HEIC/AVIF を扱っていなくても /image-convert が機能するよう、
// これらのオンデマンドコーデックも明示的に precache に残す。
let assetFiles = [];
try {
	assetFiles = await readdir(join(DIST, '_astro'));
} catch {
	// _astro/ が存在しない場合は空配列のまま続行
}
// zxing-wasm（QRコード読み取り、/qr-reader 専用）の WASM チャンクも、AVIF/HEICと同様に
// precache 対象に含める。OfflineBadge の「全ツールをオフラインで利用可能にする」という
// 前提に合わせ、オフライン化前に一度も /qr-reader を開いていなくても初回デコードが
// WASM取得失敗で落ちないようにする。
const assetURLs = [
	...assetFiles.map((f) => `/_astro/${f}`),
	...listAllowedRuntimePaths(),
];

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
	`[generate-sw] pages: ${pageURLs.length}, assets: ${assetURLs.length}`,
);
