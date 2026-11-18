import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pagesHeadersForPath } from '../helpers/pages-headers.ts';

// 共通CSPの補強（Issue #726）。default-src では既定値が決まらない指示子を明示し、
// 万一HTML注入が起きたときの <base> 差し替え・外部へのフォーム送信・プラグイン埋め込み・
// 他サイトからのフレーム表示を塞ぐ。
const headers = readFileSync('public/_headers', 'utf8');
const REQUIRED = [
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'self'",
];

function directives(policy: string): string[] {
	return policy.split(';').map((d) => d.trim());
}

test('共通CSPは object-src / base-uri / form-action / frame-ancestors を制限する', () => {
	for (const path of ['/', '/json-formatter/', '/bg-remove/', '/upscale/']) {
		const csp = pagesHeadersForPath(headers, path).get(
			'Content-Security-Policy',
		);
		assert.ok(csp, `${path} にCSPがない`);
		for (const directive of REQUIRED) {
			assert.ok(directives(csp).includes(directive), `${path}: ${directive}`);
		}
	}
});

test('共通CSPの既存の許可は変えない（配信元・計測の境界を広げも狭めもしない）', () => {
	const csp = pagesHeadersForPath(headers, '/').get('Content-Security-Policy');
	assert.equal(
		csp,
		"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; connect-src 'self' blob: https://models.tools.codelife.cafe https://huggingface.co https://*.huggingface.co https://*.hf.co https://*.xethub.hf.co https://cdn.jsdelivr.net https://cloudflareinsights.com; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
	);
});

test('専用CSPのページでも補強した制限が外れない', () => {
	// /transcribe は共通CSPに専用CSPが連結される（両方が適用される）。
	const transcribe =
		pagesHeadersForPath(headers, '/transcribe').get(
			'Content-Security-Policy',
		) ?? '';
	for (const directive of REQUIRED) {
		assert.ok(transcribe.includes(directive), `/transcribe: ${directive}`);
	}
	// /mermaid は共通CSPを解除して専用CSPだけを設定する。専用側が同じ制限を持つ。
	const mermaid =
		pagesHeadersForPath(headers, '/mermaid').get('Content-Security-Policy') ??
		'';
	for (const directive of REQUIRED) {
		assert.ok(
			directives(mermaid).includes(directive),
			`/mermaid: ${directive}`,
		);
	}
});
