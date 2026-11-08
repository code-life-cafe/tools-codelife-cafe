import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
	UPSCALE_ORT_VERSION,
	UPSCALE_ORT_WASM_BASE,
} from '../../src/lib/tools/upscale-ort.ts';
import { resolveRuntimePaths } from './onnx-runtime-paths.mjs';

const WASM_URL_REGEX =
	/new URL\(\s*(['"`])(ort-wasm-[^'"`]+\.wasm)\1\s*,\s*import\.meta\.url\s*\)/g;

/**
 * /upscale 用 ORT の bundle 版が持つ wasm の fallback URL を、Worker が wasmPaths に設定する
 * CDN と同じ URL へ置き換える。
 * 実行時は wasmPaths（CDN）が優先されるためこの fallback は使われないが、
 * `new URL(..., import.meta.url)` のままだと Vite が wasm を dist/_astro へ出力し、
 * Pages の 25 MiB 上限（asyncify 版は 1.31 で約 27 MiB）と SW の保存容量を圧迫する。
 * @param {string} code
 * @param {string} [base]
 * @returns {string}
 */
export function rewriteUpscaleOrtWasmUrls(code, base = UPSCALE_ORT_WASM_BASE) {
	return code.replace(
		WASM_URL_REGEX,
		(_match, _quote, name) =>
			`new URL(${JSON.stringify(name)}, ${JSON.stringify(base)})`,
	);
}

/**
 * トップレベル（/upscale 用）の onnxruntime-web dist だけを対象にする Vite プラグイン。
 * /transcribe が使う transformers.js 側の ORT（ネスト側）には触れない。
 * @param {string} root リポジトリルート
 */
export async function upscaleOrtAssetsPlugin(root) {
	const ortRoot = join(root, 'node_modules', 'onnxruntime-web');
	const { version } = JSON.parse(
		await readFile(join(ortRoot, 'package.json'), 'utf8'),
	);
	if (version !== UPSCALE_ORT_VERSION) {
		throw new Error(
			`upscale の onnxruntime-web の版ずれ: installed=${version} src/lib/tools/upscale-ort.ts=${UPSCALE_ORT_VERSION}`,
		);
	}
	const dist = `${resolve(ortRoot, 'dist').replaceAll('\\', '/')}/`;
	const transcribe = await resolveRuntimePaths(root);
	if (`${resolve(transcribe.ortDist).replaceAll('\\', '/')}/` === dist) {
		throw new Error(
			'upscale と transcribe の onnxruntime-web が同じ実体に解決されています。配信設定を見直してください。',
		);
	}
	return {
		name: 'upscale-ort-cdn-wasm',
		enforce: 'pre',
		apply: 'build',
		transform(code, id) {
			if (!id.replaceAll('\\', '/').startsWith(dist)) return null;
			const output = rewriteUpscaleOrtWasmUrls(code);
			return output === code ? null : { code: output, map: null };
		},
	};
}
