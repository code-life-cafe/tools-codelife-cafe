import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

test('SW activation evicts unverified transcription cache and obsolete shell caches, preserving verified model caches', async () => {
	const source = await readFile(
		new URL('../../public/sw.js', import.meta.url),
		'utf8',
	);
	const names = new Set([
		'cl-tools-__HASH__',
		'cl-tools-old',
		'transformers-cache',
		'codelife-verified-bg-models-v1',
		'codelife-verified-upscale-models-v1',
		'codelife-verified-runtime-v1',
	]);
	const handlers = new Map<
		string,
		(event: { waitUntil: (promise: Promise<unknown>) => void }) => void
	>();
	let claimed = false;
	runInNewContext(source, {
		self: {
			addEventListener: (
				name: string,
				handler: (event: {
					waitUntil: (promise: Promise<unknown>) => void;
				}) => void,
			) => handlers.set(name, handler),
			clients: {
				claim: async () => {
					assert(!names.has('transformers-cache'));
					claimed = true;
				},
			},
		},
		caches: {
			keys: async () => [...names],
			delete: async (name: string) => names.delete(name),
		},
	});
	let completion: Promise<unknown> | undefined;
	const activate = handlers.get('activate');
	assert(activate);
	activate({
		waitUntil: (promise) => {
			completion = promise;
		},
	});
	assert(completion);
	await completion;
	assert(claimed);
	assert.deepEqual(
		[...names].sort(),
		[
			'cl-tools-__HASH__',
			'codelife-verified-bg-models-v1',
			'codelife-verified-upscale-models-v1',
			'codelife-verified-runtime-v1',
		].sort(),
	);
});
