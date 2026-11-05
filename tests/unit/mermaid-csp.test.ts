import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { toolCatalog } from '../../src/lib/tools/catalog.ts';
import { pagesHeadersForPath } from '../helpers/pages-headers.ts';

const headers = readFileSync('public/_headers', 'utf8');
const expected =
	"default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://cloudflareinsights.com; font-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

test('ビルド成果物の_headersが公開元と一致する（build後に実行）', () => {
	assert.equal(readFileSync('dist/_headers', 'utf8'), headers);
});

test('_headersは全一致ルールの継承・連結と、ルール内の解除→設定を評価する', () => {
	const source = '/*\n  X-Test: global\n/a*\n  X-Test: narrow';
	assert.equal(
		pagesHeadersForPath(source, '/abc').get('X-Test'),
		'global, narrow',
	);
	assert.equal(
		pagesHeadersForPath(
			`${source}\n/abc\n  ! X-Test\n  X-Test: final`,
			'/abc',
		).get('X-Test'),
		'final',
	);
	assert.equal(
		pagesHeadersForPath(`${source}\n/abc\n  ! X-Test`, '/abc').get('X-Test'),
		null,
	);
});

test('Mermaidの実ページとcatalogのパスに専用CSPを適用する', () => {
	assert.ok(
		readFileSync('src/pages/mermaid.astro', 'utf8').includes(
			'MermaidPreviewPage',
		),
	);
	assert.equal(
		toolCatalog.find((tool) => tool.id === 'mermaid')?.href,
		'/mermaid/',
	);
	for (const path of ['/mermaid', '/mermaid/', '/mermaid/index.html']) {
		const applied = pagesHeadersForPath(headers, path);
		assert.equal(applied.get('Content-Security-Policy'), expected, path);
		assert.equal(applied.get('X-Content-Type-Options'), 'nosniff');
	}
});

test('Mermaid以外のCSPと動画ページの解除を維持する', () => {
	const global = pagesHeadersForPath(headers, '/').get(
		'Content-Security-Policy',
	);
	assert.ok(global);
	assert.match(global, /img-src 'self' data: blob: https:/);
	for (const path of ['/mermaid-other/', '/json-formatter/']) {
		assert.equal(
			pagesHeadersForPath(headers, path).get('Content-Security-Policy'),
			global,
		);
	}
	for (const path of ['/video-compress', '/video-compress/']) {
		assert.equal(
			pagesHeadersForPath(headers, path).get('Content-Security-Policy'),
			null,
		);
	}
	assert.match(
		pagesHeadersForPath(headers, '/transcribe/').get(
			'Content-Security-Policy',
		) ?? '',
		/connect-src 'self'; worker-src/,
	);
});

test('専用CSPはグローバルCSPの外部許可を増やさない', () => {
	const directives = (policy: string) =>
		new Map(
			policy.split(';').map((part) => {
				const [name, ...values] = part.trim().split(/\s+/);
				return [name, values];
			}),
		);
	const global = directives(
		pagesHeadersForPath(headers, '/').get('Content-Security-Policy') ?? '',
	);
	for (const [name, values] of directives(expected)) {
		const allowed = global.get(name) ?? global.get('script-src') ?? [];
		for (const value of values) {
			// 'none' / 'self' は外部への許可を増やさない（制限の追加）ため照合対象外。
			if (value === "'none'" || value === "'self'") continue;
			assert.ok(allowed.includes(value), `${name}: ${value}`);
		}
	}
});

test('Mermaid専用CSPは埋め込み・base・送信先・プラグインの制限を持つ（#650）', () => {
	const csp = expected;
	for (const directive of [
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'self'",
		"default-src 'self'",
	]) {
		assert.ok(csp.split('; ').includes(directive), directive);
	}
	assert.doesNotMatch(csp, /img-src[^;]*https:/);
});
