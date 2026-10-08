import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { RUNTIME_ARTIFACT } from '../src/lib/transcribe/model-manifest.ts';
import { resolveRuntimePaths } from './lib/onnx-runtime-paths.mjs';

// Dry run by default. Reuses an installed Wrangler and its existing authentication.
// No bucket creation, permission/config changes or model uploads.
const upload = process.argv.includes('--upload');
const verify = process.argv.includes('--verify');
const runtime = await resolveRuntimePaths(process.cwd());
if (runtime.onnxRuntimeVersion !== RUNTIME_ARTIFACT.onnxRuntimeVersion || runtime.transformersVersion !== RUNTIME_ARTIFACT.transformersVersion) throw new Error('Runtime version mismatch');
const files = await Promise.all(RUNTIME_ARTIFACT.files.map(async (file) => {
	const path = join(runtime.ortDist, file.path);
	const data = await readFile(path);
	if (data.length !== file.bytes || createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error(`Runtime hash mismatch: ${file.path}`);
	return { ...file, localPath: path, key: `codelife-models/onnx-wasm/${runtime.onnxRuntimeVersion}/${file.sha256}/${file.path}` };
}));
for (const file of files) console.log(`${file.key} (${file.bytes} bytes)`);
if (upload || verify) {
	if (!process.env.WRANGLER_JS) throw new Error('Set WRANGLER_JS to the existing Wrangler bin/wrangler.js');
	if (upload) for (const file of files) {
		const result = spawnSync(process.execPath, [resolve(process.env.WRANGLER_JS), 'r2', 'object', 'put', file.key, '--remote', '--file', file.localPath, '--content-type', file.path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8', '--cache-control', 'public, max-age=31536000, immutable, no-transform'], { stdio: 'inherit' });
		if (result.error || result.status !== 0) throw new Error(`Wrangler upload failed: ${file.path}`, { cause: result.error });
	}
	const tempRoot = resolve(tmpdir());
	const temp = await mkdtemp(join(tempRoot, 'onnx-r2-verify-'));
	try {
		for (const file of files) {
			const target = join(temp, file.path);
			const result = spawnSync(process.execPath, [resolve(process.env.WRANGLER_JS), 'r2', 'object', 'get', file.key, '--remote', '--file', target], { stdio: 'inherit' });
			if (result.error || result.status !== 0) throw new Error(`Wrangler readback failed: ${file.path}`, { cause: result.error });
			const bytes = await readFile(target);
			if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`R2 readback mismatch: ${file.path}`);
			console.log(`Verified R2 bytes and SHA-256: ${file.path}`);
		}
	} finally {
		if (!resolve(temp).startsWith(tempRoot + sep)) throw new Error('Unsafe temporary cleanup path');
		await rm(temp, { recursive: true, force: true });
	}
} else console.log('Dry run: verified all bytes; no R2 writes. Use --upload after checking the target prefix and authorization.');
