// 固定マニフェストで両ランタイムと同梱fastモデルを検証。hash再生成は行わない。
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelFile } from '../src/lib/model-assets/manifest.ts';
import { UPSCALE_RUNTIME } from '../src/lib/model-assets/runtime-manifest.ts';
import { RUNTIME_ARTIFACT } from '../src/lib/transcribe/model-manifest.ts';
import { resolveRuntimePaths } from './lib/onnx-runtime-paths.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nested = await resolveRuntimePaths(root);
if (
	nested.transformersVersion !== RUNTIME_ARTIFACT.transformersVersion ||
	nested.onnxRuntimeVersion !== RUNTIME_ARTIFACT.onnxRuntimeVersion
)
	throw new Error('Transformers runtime version differs from manifest');
const directRoot = join(root, 'node_modules/onnxruntime-web');
const direct = JSON.parse(
	await readFile(join(directRoot, 'package.json'), 'utf8'),
);
if (direct.version !== UPSCALE_RUNTIME.onnxRuntimeVersion)
	throw new Error('Upscale runtime version differs from manifest');
const checkOnly = process.argv.includes('--check');
const fast = modelFile('realesr-general-x4v3', 'realesr-general-x4v3.onnx');
const tasks = [
	{
		file: fast,
		source: join(root, 'public', fast.url.slice(1)),
		destination: null,
	},
	...[
		{ manifest: RUNTIME_ARTIFACT, source: nested.ortDist },
		{ manifest: UPSCALE_RUNTIME, source: join(directRoot, 'dist') },
	].flatMap(({ manifest, source }) =>
		manifest.files.map((file) => ({
			file,
			source: join(source, file.path),
			destination: join(
				root,
				'public/vendor/onnx-wasm',
				manifest.onnxRuntimeVersion,
				file.path,
			),
		})),
	),
];
for (const { file, source, destination } of tasks) {
	const bytes = await readFile(source);
	if (
		bytes.length !== file.bytes ||
		createHash('sha256').update(bytes).digest('hex') !== file.sha256
	)
		throw new Error(`Asset differs from manifest: ${file.path}`);
	if (destination && !checkOnly) {
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, bytes);
	}
}
console.log(
	'[copy-onnx-wasm] Both runtimes and bundled model match pinned manifests',
);
