import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareVerifiedRuntime } from '../../src/lib/model-assets/verified-runtime.ts';

// same-length script/WASM replacement must fail before any executable Blob exists.
test('実行資産は同じ検証済bytesのBlobを返し、同長改変はBlob作成前に拒否する', async () => {
	const originalFetch = globalThis.fetch;
	const originalLocation = Object.getOwnPropertyDescriptor(
		globalThis,
		'location',
	);
	const originalCreate = URL.createObjectURL;
	Object.defineProperty(globalThis, 'location', {
		configurable: true,
		value: { origin: 'https://tools.test' },
	});
	const bytes = [
		new TextEncoder().encode('export default ()=>{};'),
		new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 0, 3, 1, 120, 1]),
	];
	const files = await Promise.all(
		bytes.map(async (value, index) => ({
			path: `runtime.${index === 0 ? 'mjs' : 'wasm'}`,
			bytes: value.length,
			sha256: Buffer.from(
				await crypto.subtle.digest('SHA-256', value),
			).toString('hex'),
		})),
	);
	const runtime = { onnxRuntimeVersion: 'test', files };
	let blobs = 0;
	URL.createObjectURL = (blob) => {
		blobs++;
		return originalCreate(blob);
	};
	try {
		for (const corrupt of [-1, 0, 1]) {
			blobs = 0;
			globalThis.fetch = async (input) => {
				const index = String(input).endsWith('.mjs') ? 0 : 1;
				const value = bytes[index].slice();
				if (index === corrupt) {
					if (index === 0) value[value.length - 1] = 32;
					else value[value.length - 1] ^= 1;
				}
				if (index === 1) {
					assert.equal(WebAssembly.validate(bytes[1]), true);
					assert.equal(WebAssembly.validate(value), true);
				}
				return new Response(value);
			};
			if (corrupt >= 0) {
				await assert.rejects(
					prepareVerifiedRuntime(runtime, 'runtime', null),
					/実行資産.*ハッシュ/,
				);
				assert.equal(blobs, 0);
			} else {
				const paths = await prepareVerifiedRuntime(runtime, 'runtime', null);
				try {
					assert.deepEqual(
						new Uint8Array(
							await (await originalFetch(paths.mjs)).arrayBuffer(),
						),
						bytes[0],
					);
					assert.deepEqual(
						new Uint8Array(
							await (await originalFetch(paths.wasm)).arrayBuffer(),
						),
						bytes[1],
					);
					assert.equal(blobs, 2);
				} finally {
					URL.revokeObjectURL(paths.mjs);
					URL.revokeObjectURL(paths.wasm);
				}
			}
		}
	} finally {
		globalThis.fetch = originalFetch;
		URL.createObjectURL = originalCreate;
		if (originalLocation)
			Object.defineProperty(globalThis, 'location', originalLocation);
		else Reflect.deleteProperty(globalThis, 'location');
	}
});
