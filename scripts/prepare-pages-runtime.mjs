import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MODEL_FILES } from '../src/lib/model-assets/manifest.ts';
import { RUNTIMES } from '../src/lib/model-assets/runtime-manifest.ts';

// publicのローカル検証用資産は維持。大容量配信資産は既存R2ルートへ。
// 動作確認でpublicへ置いたモデルもPagesの静的成果物へ混ぜない。
const root = resolve('dist');
const files = [
	...RUNTIMES.flatMap((runtime) =>
		runtime.files.map((file) => ({
			...file,
			url: `/vendor/onnx-wasm/${runtime.onnxRuntimeVersion}/${file.path}`,
			required: true,
		})),
	),
	...MODEL_FILES.filter(
		(file) =>
			file.url.startsWith('/models/bg-remove/') ||
			file.url.startsWith('/models/upscale/'),
	).map((file) => ({ ...file, required: false })),
];
for (const file of files) {
	const target = join(root, file.url.slice(1));
	let bytes;
	try {
		bytes = await readFile(target);
	} catch (error) {
		if (!file.required && error.code === 'ENOENT') continue;
		throw error;
	}
	if (
		bytes.length !== file.bytes ||
		createHash('sha256').update(bytes).digest('hex') !== file.sha256
	)
		throw new Error(`Pages asset differs from manifest: ${file.path}`);
	await unlink(target);
}
console.log(
	'[pages-runtime] Verified assets served by same-origin R2 routes; static copies excluded',
);
