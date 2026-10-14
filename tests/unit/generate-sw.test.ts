import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('SWページ一覧は実在するindex.htmlのみを含み、資産と親ディレクトリを除外する', async () => {
	const root = await mkdtemp(join(tmpdir(), 'generate-sw-'));
	try {
		for (const name of [
			'public',
			'dist',
			'dist/text-diff',
			'dist/tools/text-diff',
			'dist/invalid/index.html',
			'dist/_astro',
			'dist/.well-known',
			'dist/vendor',
			'dist/models',
			'dist/data',
			'dist/og',
		])
			await mkdir(join(root, name), { recursive: true });
		for (const name of [
			'dist/index.html',
			'dist/text-diff/index.html',
			'dist/tools/text-diff/index.html',
			'dist/.well-known/index.html',
			'dist/vendor/index.html',
			'dist/models/index.html',
			'dist/data/index.html',
			'dist/og/index.html',
		])
			await writeFile(join(root, name), '<html>fixture</html>');
		await writeFile(join(root, 'dist/_astro/worker.js'), 'fixture');
		await writeFile(
			join(root, 'public/sw.js'),
			await readFile(new URL('../../public/sw.js', import.meta.url)),
		);
		const result = spawnSync(
			process.execPath,
			[
				fileURLToPath(
					new URL('../../scripts/generate-sw.mjs', import.meta.url),
				),
			],
			{ cwd: root, encoding: 'utf8' },
		);
		assert.equal(result.status, 0, result.stderr);
		const output = await readFile(join(root, 'dist/sw.js'), 'utf8');
		const match = /const ALL_PAGES = (\[[\s\S]*?\]);/.exec(output);
		assert.ok(match);
		assert.deepEqual(JSON.parse(match[1]).sort(), ['/', '/text-diff/']);
		assert.ok(output.includes('/_astro/worker.js'));
		assert.equal(output.includes('__HASH__'), false);
	} finally {
		assert.equal(dirname(resolve(root)), resolve(tmpdir()));
		await rm(root, { recursive: true, force: true });
	}
});
