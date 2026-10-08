import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	ONNX_WASM_BASE_PATH,
	RUNTIME_ARTIFACT,
} from '../../src/lib/transcribe/model-manifest.ts';

test('production transcribe Worker references both manifest runtime variants without oversized static copies', async () => {
	const assets = await readdir('dist/_astro');
	const worker = assets.find((name) => /^transcribe.worker-.*\.js$/.test(name));
	assert(worker, 'production transcribe worker must exist');
	const code = await readFile(join('dist/_astro', worker), 'utf8');
	assert(
		code.includes(ONNX_WASM_BASE_PATH),
		'missing versioned same-origin base',
	);
	for (const file of RUNTIME_ARTIFACT.files) {
		assert(code.includes(file.path), `missing runtime variant ${file.path}`);
		await assert.rejects(
			stat(join('dist', ONNX_WASM_BASE_PATH.slice(1), file.path)),
			{ code: 'ENOENT' },
		);
	}
	assert(
		assets.some(
			(name) => name.startsWith('avif_enc') && name.endsWith('.wasm'),
		),
	);
	assert(
		assets.some(
			(name) => name.startsWith('zxing_reader') && name.endsWith('.wasm'),
		),
	);
});
