import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	MAX_PAGES_ASSET_BYTES,
	oversizedPagesAssets,
} from '../../scripts/lib/pages-assets.mjs';

test('Pages limit permits exactly 25MiB and rejects nested assets one byte above', async () => {
	const root = await mkdtemp(join(tmpdir(), 'pages-limit-'));
	try {
		await mkdir(join(root, 'nested'));
		for (const [name, size] of [
			['limit.wasm', MAX_PAGES_ASSET_BYTES],
			['nested/large.wasm', MAX_PAGES_ASSET_BYTES + 1],
		] as const) {
			const file = await open(join(root, name), 'w');
			await file.truncate(size);
			await file.close();
		}
		assert.deepEqual(await oversizedPagesAssets(root), [
			join(root, 'nested', 'large.wasm'),
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
