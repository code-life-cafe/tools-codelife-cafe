import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { onRequest } from '../../functions/_middleware.ts';
import {
	legacyToolDestination,
	legacyToolRoutes,
} from '../../src/lib/seo/legacy-tools.ts';
import { normalizeCanonicalPath } from '../../src/lib/seo/url.ts';

test('全コンテンツの旧URLに実在する正規ページが一意に対応する', () => {
	const slugs = readdirSync('src/content/tools')
		.filter((file) => file.endsWith('.md'))
		.map((file) => file.slice(0, -3));
	assert.equal(new Set(legacyToolRoutes.values()).size, legacyToolRoutes.size);
	assert.equal(slugs.length, legacyToolRoutes.size);
	for (const slug of slugs) {
		const target = legacyToolDestination(`/tools/${slug}`);
		assert.ok(target, slug);
		assert.equal(legacyToolDestination(`/tools/${slug}/`), target);
		assert.ok(existsSync(`src/pages${target.slice(0, -1)}.astro`), target);
		assert.equal(legacyToolDestination(target), undefined);
		const canonical = /^canonical:\s*['"]?([^'"\r\n]+)/m.exec(
			readFileSync(`src/content/tools/${slug}.md`, 'utf8'),
		);
		if (canonical)
			assert.equal(
				new URL(canonical[1], 'https://tools.codelife.cafe').pathname.replace(
					/\/$/,
					'',
				),
				target.slice(0, -1),
			);
	}
});

test('全旧URLでGET/HEADを301転送しクエリを保持、旧page_viewを記録しない', async () => {
	for (const [slug, target] of legacyToolRoutes) {
		for (const method of ['GET', 'HEAD']) {
			for (const slash of ['', '/']) {
				const query = '?settings=eyJpbmRlbnQiOiI0In0%3D&x=%2B&x=two';
				const response = await onRequest({
					request: new Request(
						`https://tools.codelife.cafe/tools/${slug}${slash}${query}`,
						{ method },
					),
					next: async () => {
						throw new Error('legacy request must not serve HTML');
					},
					env: {
						EVENTS: {
							writeDataPoint() {
								throw new Error('must not record redirect');
							},
						},
					},
				});
				assert.equal(response.status, 301);
				assert.equal(
					response.headers.get('Location'),
					`https://tools.codelife.cafe${target}/${query}`,
				);
				assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, follow');
				assert.equal(await response.text(), '');
			}
		}
	}
});

test('未知の旧URL・子パス・正規URL・POSTは転送しない', async () => {
	for (const pathname of [
		'/tools/unknown',
		'/tools/image-compress/extra',
		'/tools/',
		'/image-compress',
		'/tools/%69mage-compress',
		'//tools/image-compress',
	]) {
		assert.equal(legacyToolDestination(pathname), undefined);
	}
	for (const [pathname, method] of [
		['/tools/unknown', 'GET'],
		['/tools/image-compress', 'POST'],
		['/image-compress', 'GET'],
	]) {
		const response = await onRequest({
			request: new Request(`https://tools.codelife.cafe${pathname}`, {
				method,
			}),
			next: async () => new Response('next', { status: 404 }),
		});
		assert.equal(response.status, 404);
		assert.equal(await response.text(), 'next');
	}
	const redirect = await onRequest({
		request: new Request('https://tools.codelife.cafe/tools/image-compress'),
		next: async () => new Response(),
	});
	assert.equal(redirect.headers.get('X-Robots-Tag'), null);
});

test('ビルド済sitemapは旧URLを含まず正規ツールを一度ずつ掲載する', {
	skip: !existsSync('dist/sitemap-0.xml'),
}, () => {
	const xml = readFileSync('dist/sitemap-0.xml', 'utf8');
	const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
		(match) => new URL(match[1]).pathname,
	);
	assert.ok(paths.every((path) => !path.startsWith('/tools/')));
	assert.equal(new Set(paths).size, paths.length);
	assert.ok(paths.every((path) => path.endsWith('/')));
	for (const target of legacyToolRoutes.values())
		assert.equal(
			paths.filter((path) => path === normalizeCanonicalPath(target)).length,
			1,
			target,
		);
});
