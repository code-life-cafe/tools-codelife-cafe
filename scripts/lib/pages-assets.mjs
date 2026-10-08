import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_PAGES_ASSET_BYTES = 25 * 1024 * 1024;
export async function oversizedPagesAssets(root) {
	const failures = [];
	async function walk(dir) {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile() && (await stat(path)).size > MAX_PAGES_ASSET_BYTES) failures.push(path);
		}
	}
	await walk(root);
	return failures;
}
