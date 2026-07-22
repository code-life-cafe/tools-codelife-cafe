// onnx-runtime-paths.mjs
// @huggingface/transformers が **実際に解決している** onnxruntime-web の場所とバージョンを返す。
//
// 注意: リポジトリは /upscale 用にトップレベルへ onnxruntime-web を pin しているが、
// @huggingface/transformers は自分の dependencies にある別バージョンを
// node_modules/@huggingface/transformers/node_modules/ 配下に持つことがある（dedupe されない）。
// /transcribe は transformers.js 経由で ONNX Runtime を使うため、**ネスト側が正**。

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function readVersion(pkgDir) {
	const pkg = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
	return pkg.version;
}

/**
 * @param {string} root リポジトリルート
 * @returns {Promise<{transformersVersion: string, onnxRuntimeVersion: string, ortDist: string, ortRoot: string}>}
 */
export async function resolveRuntimePaths(root) {
	const transformersDir = join(root, 'node_modules', '@huggingface', 'transformers');
	if (!(await exists(transformersDir))) {
		throw new Error(
			'@huggingface/transformers が見つかりません。npm install を実行してください。',
		);
	}
	const transformersVersion = await readVersion(transformersDir);

	const nested = join(transformersDir, 'node_modules', 'onnxruntime-web');
	const hoisted = join(root, 'node_modules', 'onnxruntime-web');
	const ortRoot = (await exists(nested)) ? nested : hoisted;
	if (!(await exists(ortRoot))) {
		throw new Error('onnxruntime-web が見つかりません。npm install を実行してください。');
	}
	const onnxRuntimeVersion = await readVersion(ortRoot);

	return {
		transformersVersion,
		onnxRuntimeVersion,
		ortRoot,
		ortDist: join(ortRoot, 'dist'),
	};
}

/**
 * transformers.js が wasmPaths の既定として要求する WASM 一式。
 * Safari は非 asyncify、それ以外は asyncify を使うため両系統を配置する。
 */
export const ORT_WASM_FILES = [
	'ort-wasm-simd-threaded.asyncify.mjs',
	'ort-wasm-simd-threaded.asyncify.wasm',
	'ort-wasm-simd-threaded.mjs',
	'ort-wasm-simd-threaded.wasm',
];
