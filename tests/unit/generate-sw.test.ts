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
			'dist/offline',
			'dist/cipher/caesar-hiragana',
			'dist/guides/cipher/example',
			'dist/tools/text-diff',
			'dist/invalid/index.html',
			'dist/_astro',
			'dist/.well-known',
			'dist/vendor',
			'dist/models',
			'dist/data',
			'dist/og',
			'dist/cipher/_private/page',
			'dist/cipher/.hidden/page',
			'dist/cipher/data/page',
			'dist/cipher/og/page',
			'dist/cipher/models/page',
			'dist/cipher/vendor/page',
		])
			await mkdir(join(root, name), { recursive: true });
		for (const name of [
			'dist/index.html',
			'dist/text-diff/index.html',
			'dist/offline/index.html',
			'dist/cipher/index.html',
			'dist/cipher/caesar-hiragana/index.html',
			'dist/guides/cipher/example/index.html',
			'dist/tools/text-diff/index.html',
			'dist/tools/index.html',
			'dist/.well-known/index.html',
			'dist/vendor/index.html',
			'dist/models/index.html',
			'dist/data/index.html',
			'dist/og/index.html',
			'dist/cipher/_private/page/index.html',
			'dist/cipher/.hidden/page/index.html',
			'dist/cipher/data/page/index.html',
			'dist/cipher/og/page/index.html',
			'dist/cipher/models/page/index.html',
			'dist/cipher/vendor/page/index.html',
		])
			await writeFile(join(root, name), '<html>fixture</html>');
		await writeFile(join(root, 'dist/_astro/worker.js'), 'fixture');
		await writeFile(
			join(root, 'public/sw.js'),
			await readFile(new URL('../../public/sw.js', import.meta.url)),
		);
		const generate = () =>
			spawnSync(
				process.execPath,
				[
					fileURLToPath(
						new URL('../../scripts/generate-sw.mjs', import.meta.url),
					),
				],
				{ cwd: root, encoding: 'utf8' },
			);
		const result = generate();
		assert.equal(result.status, 0, result.stderr);
		const output = await readFile(join(root, 'dist/sw.js'), 'utf8');
		const match = /const ALL_PAGES = (\[[\s\S]*?\]);/.exec(output);
		assert.ok(match);
		assert.deepEqual(JSON.parse(match[1]).sort(), [
			'/',
			'/cipher/',
			'/cipher/caesar-hiragana/',
			'/guides/cipher/example/',
			'/offline/',
			'/text-diff/',
		]);
		assert.ok(output.includes('/_astro/worker.js'));
		assert.equal(output.includes('__HASH__'), false);
		await writeFile(
			join(root, 'dist/cipher/caesar-hiragana/index.html'),
			'<html>updated nested page</html>',
		);
		const updatedResult = generate();
		assert.equal(updatedResult.status, 0, updatedResult.stderr);
		const updated = await readFile(join(root, 'dist/sw.js'), 'utf8');
		assert.notEqual(
			updated.match(/const CACHE_NAME = '([^']+)'/)?.[1],
			output.match(/const CACHE_NAME = '([^']+)'/)?.[1],
		);
	} finally {
		assert.equal(dirname(resolve(root)), resolve(tmpdir()));
		await rm(root, { recursive: true, force: true });
	}
});
