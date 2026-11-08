import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { rewriteUpscaleOrtWasmUrls } from '../../scripts/lib/upscale-ort-assets.mjs';
import {
	UPSCALE_ORT_VERSION,
	UPSCALE_ORT_WASM_BASE,
} from '../../src/lib/tools/upscale-ort.ts';

const BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@9.9.9/dist/';

test('upscale用ORTの版はpackage.jsonのpinと一致し、配信元は同じ版のCDNを指す', async () => {
	const pkg = JSON.parse(await readFile('package.json', 'utf8'));
	assert.equal(pkg.dependencies['onnxruntime-web'], UPSCALE_ORT_VERSION);
	assert.equal(
		UPSCALE_ORT_WASM_BASE,
		`https://cdn.jsdelivr.net/npm/onnxruntime-web@${UPSCALE_ORT_VERSION}/dist/`,
	);
});

test('ORTのwasm fallback URLをCDNの同名ファイルへ置き換える', () => {
	const code = [
		'a=new URL("ort-wasm-simd-threaded.wasm",import.meta.url).href;',
		"b=new URL( 'ort-wasm-simd-threaded.asyncify.wasm' , import.meta.url );",
	].join('\n');
	const out = rewriteUpscaleOrtWasmUrls(code, BASE);
	assert.equal(
		out,
		[
			`a=new URL("ort-wasm-simd-threaded.wasm", "${BASE}").href;`,
			`b=new URL("ort-wasm-simd-threaded.asyncify.wasm", "${BASE}");`,
		].join('\n'),
	);
	assert.ok(!out.includes('import.meta.url'));
});

test('ORTのwasm以外のURLとimport.meta.url単独の参照は変えない', () => {
	const code = [
		'new URL(import.meta.url)',
		'new URL("ort.webgpu.bundle.min.mjs",import.meta.url)',
		'new URL("other-codec.wasm",import.meta.url)',
		'new URL("ort-wasm-simd-threaded.mjs",import.meta.url)',
	].join('\n');
	assert.equal(rewriteUpscaleOrtWasmUrls(code, BASE), code);
});

test('本番buildはupscale用ORTのwasmを出力せず、Pagesの上限を超える資産を含まない（build後に実行）', async () => {
	const assets = await readdir('dist/_astro');
	const ortWasm = assets.filter(
		(name) => name.startsWith('ort-wasm-') && name.endsWith('.wasm'),
	);
	assert.deepEqual(ortWasm, []);
	const bundles = assets.filter((name) =>
		/^ort\.(wasm|webgpu)\.bundle\.min-.*\.js$/.test(name),
	);
	assert.ok(bundles.length > 0, 'upscale用ORTのbundleがbuildに含まれていない');
	for (const name of bundles) {
		const code = await readFile(join('dist/_astro', name), 'utf8');
		assert.ok(
			code.includes(UPSCALE_ORT_WASM_BASE),
			`${name} がupscale用ORTのCDNを参照していない`,
		);
	}
});
