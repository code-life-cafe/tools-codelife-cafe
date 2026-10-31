import { createHash } from 'node:crypto';
import { readFile, rm, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
	ONNX_WASM_BASE_PATH,
	RUNTIME_ARTIFACT,
} from '../src/lib/transcribe/model-manifest.ts';

// publicのローカル検証用runtime/modelsは維持し、Pages出力だけからmanifest一致実体・巨大モデルを除外。
const root = resolve('dist');
for (const file of RUNTIME_ARTIFACT.files) {
	const target = join(root, ONNX_WASM_BASE_PATH.slice(1), file.path);
	const bytes = await readFile(target);
	if (
		bytes.length !== file.bytes ||
		createHash('sha256').update(bytes).digest('hex') !== file.sha256
	) {
		throw new Error(`Pages runtime differs from manifest: ${file.path}`);
	}
	await unlink(target);
}

// ローカルにキャッシュされた /models/transcribe/ は同一オリジン R2 Route から配信されるため静的出力から除外
await rm(join(root, 'models', 'transcribe'), { recursive: true, force: true });

console.log(
	'[pages-runtime] Runtime served by same-origin R2 route; static copies excluded',
);
