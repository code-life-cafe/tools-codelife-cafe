import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { UPSCALE_RUNTIME } from '../../src/lib/model-assets/runtime-manifest.ts';
import { RUNTIME_ARTIFACT } from '../../src/lib/transcribe/model-manifest.ts';
import { resolveRuntimePaths } from './onnx-runtime-paths.mjs';

// Viteのasset変換前に両ORTのfallback URLをそれぞれの固定版へ設定。
export async function runtimeAssetsPlugin(root) {
	const runtime = await resolveRuntimePaths(root);
	if (
		runtime.onnxRuntimeVersion !== RUNTIME_ARTIFACT.onnxRuntimeVersion ||
		runtime.transformersVersion !== RUNTIME_ARTIFACT.transformersVersion
	)
		throw new Error('ONNX runtime versions differ from manifest');
	const direct = join(root, 'node_modules/onnxruntime-web');
	const pkg = JSON.parse(await readFile(join(direct, 'package.json'), 'utf8'));
	if (pkg.version !== UPSCALE_RUNTIME.onnxRuntimeVersion)
		throw new Error('Upscale runtime versions differ from manifest');
	const entries = [
		{ dist: runtime.ortDist, manifest: RUNTIME_ARTIFACT },
		{ dist: join(direct, 'dist'), manifest: UPSCALE_RUNTIME },
	].map(({ dist, manifest }) => ({
		dist: resolve(dist).replaceAll('\\', '/') + '/',
		base: `/vendor/onnx-wasm/${manifest.onnxRuntimeVersion}/`,
		names: new Set(manifest.files.map((file) => file.path)),
	}));
	return {
		name: 'same-origin-onnx-runtime-assets',
		enforce: 'pre',
		apply: 'build',
		transform(code, id) {
			const entry = entries.find((item) =>
				id.replaceAll('\\', '/').startsWith(item.dist),
			);
			if (!entry) return null;
			const output = code.replace(
				/new URL\(\s*(['"`])([^'"`]+)\1\s*,\s*import\.meta\.url\s*\)/g,
				(match, _quote, name) =>
					entry.names.has(name)
						? `new URL(${JSON.stringify(entry.base + name)}, globalThis.location.origin)`
						: match,
			);
			return output === code ? null : { code: output, map: null };
		},
	};
}
