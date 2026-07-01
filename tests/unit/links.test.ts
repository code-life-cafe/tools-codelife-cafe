import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

// 成果物ディレクトリのパス
const DIST_DIR = path.resolve(import.meta.dirname, '../../dist');

// dist ディレクトリが存在するかチェック
const hasDist = fs.existsSync(DIST_DIR);

/**
 * distディレクトリ以下のファイルを再帰的に取得するヘルパー関数
 */
function getFilesRecursively(dir: string): string[] {
	const files: string[] = [];
	const items = fs.readdirSync(dir, { withFileTypes: true });
	for (const item of items) {
		const fullPath = path.join(dir, item.name);
		if (item.isDirectory()) {
			files.push(...getFilesRecursively(fullPath));
		} else {
			files.push(fullPath);
		}
	}
	return files;
}

if (!hasDist) {
	test('【スキップ】dist ディレクトリが存在しません。ビルド後に実行してください。', () => {
		console.warn(
			'⚠️ [links.test.ts] dist/ ディレクトリが見つかりません。内部リンク・sitemap・canonicalの点検テストをスキップします。検証を行うには npm run build を実行してからテストを走らせてください。',
		);
		assert.ok(true);
	});
} else {
	test('内部リンクとSEO整合性の総合点検', () => {
		const allFiles = getFilesRecursively(DIST_DIR);
		const htmlFiles = allFiles.filter((f) => f.endsWith('.html'));

		// 1. 実在するURLパスのSetを構築
		// dist/index.html -> /
		// dist/about/index.html -> /about
		// dist/base64/index.html -> /base64
		// dist/404.html -> /404.html
		const existRoutes = new Set<string>();
		// アセットパスのSetも構築（404チェック用）
		const existAssets = new Set<string>();

		for (const file of allFiles) {
			const relative = path.relative(DIST_DIR, file).replace(/\\/g, '/');
			const urlPath = `/${relative}`;
			existAssets.add(urlPath);

			if (file.endsWith('.html')) {
				if (relative === 'index.html') {
					existRoutes.add('/');
				} else if (relative.endsWith('/index.html')) {
					const route = `/${relative.slice(0, -11)}`; // スラッシュと index.html を取り除く
					existRoutes.add(route);
				} else {
					const route = `/${relative.slice(0, -5)}`; // .html を取り除く
					existRoutes.add(route);
				}
			}
		}

		// 2. sitemap-0.xml から Sitemap 登録済みURLパスのSetを構築
		const sitemapPath = path.join(DIST_DIR, 'sitemap-0.xml');
		const sitemapExists = fs.existsSync(sitemapPath);
		assert.ok(sitemapExists, 'sitemap-0.xml が存在しません。');

		const sitemapContent = fs.readFileSync(sitemapPath, 'utf-8');
		const sitemapRoutes = new Set<string>();
		const locRegex = /<loc>([^<]+)<\/loc>/g;
		for (const match of sitemapContent.matchAll(locRegex)) {
			const url = match[1];
			let route = url.replace('https://tools.codelife.cafe', '');
			if (route === '') {
				route = '/';
			}
			if (route !== '/' && route.endsWith('/')) {
				route = route.slice(0, -1);
			}
			sitemapRoutes.add(route);
		}

		// 3. 各HTMLファイルをパースして検証
		for (const htmlFile of htmlFiles) {
			const relativeHtmlPath = path
				.relative(DIST_DIR, htmlFile)
				.replace(/\\/g, '/');
			let currentRoute = '';
			if (relativeHtmlPath === 'index.html') {
				currentRoute = '/';
			} else if (relativeHtmlPath.endsWith('/index.html')) {
				currentRoute = `/${relativeHtmlPath.slice(0, -11)}`;
			} else {
				currentRoute = `/${relativeHtmlPath.slice(0, -5)}`;
			}

			// tools/ プレフィックスを削って正規化されたURLを期待値とする
			let seoRoute = currentRoute;
			if (seoRoute.startsWith('/tools/')) {
				seoRoute = seoRoute.replace('/tools/', '/');
			}

			// 特定のシステム的なHTML（404やオフラインページ）は canonical や sitemap のチェック対象外とする
			const isSystemPage =
				relativeHtmlPath === '404.html' || relativeHtmlPath === 'offline.html';

			const content = fs.readFileSync(htmlFile, 'utf-8');

			// (a) canonical タグの検証
			if (!isSystemPage) {
				const canonicalRegex =
					/<link\s+[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/i;
				const canonicalMatch = canonicalRegex.exec(content);
				assert.ok(
					canonicalMatch,
					`${relativeHtmlPath} に canonical タグが存在しません。`,
				);
				const canonicalUrl = canonicalMatch[1];
				const expectedCanonical1 = `https://tools.codelife.cafe${seoRoute}`;
				const expectedCanonical2 = `https://tools.codelife.cafe${seoRoute}/`;
				assert.ok(
					canonicalUrl === expectedCanonical1 ||
						canonicalUrl === expectedCanonical2,
					`${relativeHtmlPath} の canonical URL が正しくありません。実際: ${canonicalUrl}`,
				);
			}

			// (b) 内部リンクの検証
			const hrefRegex = /href="([^"]+)"/g;
			for (const hrefMatch of content.matchAll(hrefRegex)) {
				const href = hrefMatch[1];

				// 内部リンクのみを抽出（相対パス、同一ドメイン、/から始まる）
				let isInternal = false;
				let linkPath = '';

				if (href.startsWith('/') && !href.startsWith('//')) {
					isInternal = true;
					linkPath = href;
				} else if (href.startsWith('https://tools.codelife.cafe')) {
					isInternal = true;
					linkPath = href.replace('https://tools.codelife.cafe', '');
					if (linkPath === '') linkPath = '/';
				}

				if (isInternal) {
					// クエリパラメータやハッシュを取り除く
					const pathWithoutQuery = linkPath.split('?')[0].split('#')[0];

					// 末尾のスラッシュを標準化（トップ以外の末尾スラッシュは削除）
					let normalizedPath = pathWithoutQuery;
					if (normalizedPath !== '/' && normalizedPath.endsWith('/')) {
						normalizedPath = normalizedPath.slice(0, -1);
					}

					// 404チェック: 実在するルート、またはアセット、または404.htmlなどの除外ページであること
					const isAsset = existAssets.has(normalizedPath);
					const isRoute = existRoutes.has(normalizedPath);
					const isAllowedPage =
						normalizedPath === '/404' ||
						normalizedPath === '/404.html' ||
						normalizedPath === '/offline' ||
						normalizedPath === '/offline.html';

					assert.ok(
						isRoute || isAsset || isAllowedPage,
						`${relativeHtmlPath} 内の内部リンク "${href}" (解釈パス: ${normalizedPath}) は存在しないルートです（404防止）。`,
					);

					// HTMLページへのリンクの場合のみ、Sitemap掲載チェックを行う
					// （アセットや404, offlineなどは sitemap に掲載されない）
					if (isRoute && !isAllowedPage) {
						assert.ok(
							sitemapRoutes.has(normalizedPath),
							`${relativeHtmlPath} 内の内部リンク "${href}" (解釈パス: ${normalizedPath}) は sitemap-0.xml に存在しません。`,
						);
					}
				}
			}
		}
	});
}
