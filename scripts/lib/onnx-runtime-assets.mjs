import { resolve } from 'node:path';
import {
	ONNX_WASM_BASE_PATH,
	RUNTIME_ARTIFACT,
} from '../../src/lib/transcribe/model-manifest.ts';
import { resolveRuntimePaths } from './onnx-runtime-paths.mjs';

// Viteのasset変換より前に、対象ORTのfallback URLも同一originへ固定する。
// それ以外のORT（upscale等）や他codecのWASMには触れない。
export async function runtimeAssetsPlugin(root) {
	const runtime = await resolveRuntimePaths(root);
	if (
		runtime.onnxRuntimeVersion !== RUNTIME_ARTIFACT.onnxRuntimeVersion ||
		runtime.transformersVersion !== RUNTIME_ARTIFACT.transformersVersion
	) throw new Error('ONNX runtime versions differ from manifest');
	const dist = `${resolve(runtime.ortDist).replaceAll('\\', '/')}/`;
	const names = new Set(RUNTIME_ARTIFACT.files.map((file) => file.path));
	return {
		name: 'same-origin-onnx-runtime-assets',
		enforce: 'pre',
		apply: 'build',
		transform(code, id) {
			if (!id.replaceAll('\\', '/').startsWith(dist)) return null;
			const output = code.replace(
				/new URL\(\s*(['"`])([^'"`]+)\1\s*,\s*import\.meta\.url\s*\)/g,
				(match, _quote, name) => {
					if (!names.has(name)) return match;
					return `new URL(${JSON.stringify(ONNX_WASM_BASE_PATH + name)}, globalThis.location.origin)`;
				},
			);
			return output === code ? null : { code: output, map: null };
		},
	};
}
