import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
	ONNX_WASM_BASE_PATH,
	RUNTIME_ARTIFACT,
} from '../src/lib/transcribe/model-manifest.ts';

// publicのローカル検証用runtimeは維持し、Pages出力だけからmanifest一致実体を除外。
const root = resolve('dist');
for (const file of RUNTIME_ARTIFACT.files) {
	const target = join(root, ONNX_WASM_BASE_PATH.slice(1), file.path);
	const bytes = await readFile(target);
	if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
		throw new Error(`Pages runtime differs from manifest: ${file.path}`);
	}
	await unlink(target);
}
console.log('[pages-runtime] Runtime served by same-origin R2 route; static copies excluded');
