import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

// /sitemap.xml は Cloudflare Pages の public/_redirects でのみ301解決される。
// ローカル preview (astro preview) では _redirects が適用されないため、E2Eではなくファイル内容を検証する。
const REDIRECTS_PATH = path.resolve(
	import.meta.dirname,
	'../../public/_redirects',
);
const ROBOTS_PATH = path.resolve(
	import.meta.dirname,
	'../../public/robots.txt',
);
const DIST_SITEMAP_PATH = path.resolve(
	import.meta.dirname,
	'../../dist/sitemap-index.xml',
);

test('_redirects に /sitemap.xml -> /sitemap-index.xml の301が定義されている', () => {
	const content = fs.readFileSync(REDIRECTS_PATH, 'utf-8');
	const lines = content.split('\n').map((line) => line.trim());
	assert.ok(
		lines.includes('/sitemap.xml /sitemap-index.xml 301'),
		'public/_redirects に "/sitemap.xml /sitemap-index.xml 301" 行が見つかりません。',
	);
});

test('robots.txt が /sitemap-index.xml を参照している', () => {
	const content = fs.readFileSync(ROBOTS_PATH, 'utf-8');
	assert.match(
		content,
		/^Sitemap: https:\/\/tools\.codelife\.cafe\/sitemap-index\.xml$/m,
	);
});

if (!fs.existsSync(DIST_SITEMAP_PATH)) {
	test('【スキップ】dist/sitemap-index.xml が存在しません。ビルド後に実行してください。', () => {
		console.warn(
			'⚠️ [sitemap-redirect.test.ts] dist/sitemap-index.xml が見つかりません。npm run build 後に実行すると存在確認まで検証されます。',
		);
		assert.ok(true);
	});
} else {
	test('dist/sitemap-index.xml がビルドで生成されている', () => {
		assert.ok(fs.statSync(DIST_SITEMAP_PATH).isFile());
	});
}
