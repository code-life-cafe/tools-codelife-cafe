// 検証済み資産の投入一覧を出力するだけ。R2操作・公開は実行しない。
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MODEL_ASSETS } from '../src/lib/model-assets/manifest.ts';
import { RUNTIMES } from '../src/lib/model-assets/runtime-manifest.ts';

const candidates = [
	...MODEL_ASSETS.filter(
		(model) => model.name !== 'realesr-general-x4v3',
	).flatMap((model) =>
		model.files.map((file) => ({
			...file,
			r2Key: `${model.tool}/${model.name}/${model.revision}/${file.sha256}/${file.path}`,
		})),
	),
	...RUNTIMES.flatMap((runtime) =>
		runtime.files.map((file) => ({
			...file,
			url: `/vendor/onnx-wasm/${runtime.onnxRuntimeVersion}/${file.path}`,
			r2Key: `onnx-wasm/${runtime.onnxRuntimeVersion}/${file.sha256}/${file.path}`,
		})),
	),
];
const output = [];
for (const file of candidates) {
	const localPath = resolve('public', file.url.slice(1));
	const bytes = await readFile(localPath);
	if (
		bytes.length !== file.bytes ||
		createHash('sha256').update(bytes).digest('hex') !== file.sha256
	)
		throw new Error('投入候補の資産がマニフェストと一致しません');
	output.push({
		...file,
		localPath,
		contentType: file.path.endsWith('.json')
			? 'application/json'
			: file.path.endsWith('.mjs')
				? 'text/javascript'
				: file.path.endsWith('.wasm')
					? 'application/wasm'
					: 'application/octet-stream',
	});
}
console.log(
	JSON.stringify(
		{ bucket: 'codelife-models', action: 'prepare-only', assets: output },
		null,
		2,
	),
);
