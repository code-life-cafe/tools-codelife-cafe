// 配信read-back専用。資産投入・公開は行わない。
import { createHash } from 'node:crypto';
import { MODEL_FILES } from '../src/lib/model-assets/manifest.ts';
import { RUNTIMES } from '../src/lib/model-assets/runtime-manifest.ts';

const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base))
	throw new Error('検証対象の明示URLが必要です');
const files = [
	...MODEL_FILES,
	...RUNTIMES.flatMap((runtime) =>
		runtime.files.map((file) => ({
			...file,
			url: `/vendor/onnx-wasm/${runtime.onnxRuntimeVersion}/${file.path}`,
		})),
	),
];
for (const file of files) {
	const response = await fetch(new URL(file.url, base), {
		redirect: 'error',
		cache: 'no-store',
	});
	if (response.status !== 200)
		throw new Error(`配信資産を取得できません: ${file.url}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (
		bytes.length !== file.bytes ||
		createHash('sha256').update(bytes).digest('hex') !== file.sha256
	)
		throw new Error(`配信資産のhash不一致: ${file.url}`);
	console.log(`Verified delivery ${file.url}`);
}
