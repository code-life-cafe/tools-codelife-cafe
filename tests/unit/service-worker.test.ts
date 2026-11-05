import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

async function fetchOffline(
	path: string,
	entries: [string, string][],
	mode = 'navigate',
) {
	const origin = 'https://tools.codelife.cafe';
	const request = Object.freeze({ url: new URL(path, origin).href, mode });
	const storage = new Map(
		entries.map(([key, body]) => [new URL(key, origin).href, body]),
	);
	const listeners = new Map<string, (event: unknown) => void>();
	const networkRequests: string[] = [];
	// 実際のfetchハンドラーを、クエリを区別するキャッシュと通信失敗で検証する。
	runInNewContext(
		await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8'),
		{
			URL,
			Response,
			self: {
				location: { origin },
				addEventListener: (type: string, listener: (event: unknown) => void) =>
					listeners.set(type, listener),
			},
			caches: {
				open: async () => ({
					match: async (key: string) => {
						const body = storage.get(new URL(key, origin).href);
						return body === undefined ? undefined : new Response(body);
					},
				}),
			},
			fetch: async (req: { url: string }) => {
				networkRequests.push(req.url);
				throw new TypeError('offline');
			},
		},
	);
	const fetchListener = listeners.get('fetch');
	assert.ok(fetchListener);
	let result: Promise<Response | undefined> | undefined;
	fetchListener({
		request,
		respondWith: (promise: Promise<Response | undefined>) => {
			result = promise;
		},
	});
	assert.ok(result);
	return { response: await result, request, networkRequests };
}

test('#629: activateは旧cl-toolsキャッシュだけを削除し、モデルと他用途のキャッシュを保持する', async () => {
	const preserved = [
		'cl-tools-__HASH__',
		'ocr-models-v1',
		'transformers-cache',
		'other-app-v1',
		'cl-tools',
		'other-cl-tools-old',
	];
	const storage = new Map(
		[...preserved, 'cl-tools-old', 'cl-tools-older'].map((name) => [
			name,
			new Map([['https://tools.codelife.cafe/saved', new Response(name)]]),
		]),
	);
	const listeners = new Map<string, (event: unknown) => void>();
	let claimed = false;
	// 実際のSWテンプレートのactivateハンドラーを、既存キャッシュのある状態で実行する。
	runInNewContext(
		await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8'),
		{
			self: {
				addEventListener: (type: string, listener: (event: unknown) => void) =>
					listeners.set(type, listener),
				clients: {
					claim: async () => {
						claimed = true;
					},
				},
			},
			caches: {
				keys: async () => [...storage.keys()],
				delete: async (name: string) => storage.delete(name),
			},
		},
	);
	const activate = listeners.get('activate');
	assert.ok(activate);
	let work: Promise<unknown> | undefined;
	activate({
		waitUntil: (promise: Promise<unknown>) => {
			work = promise;
		},
	});
	assert.ok(work);
	await work;
	assert.equal(claimed, true);
	assert.deepEqual([...storage.keys()].sort(), preserved.sort());
	for (const name of preserved) {
		assert.equal(
			await storage.get(name)?.get('https://tools.codelife.cafe/saved')?.text(),
			name,
		);
	}
});

for (const path of [
	'/json-formatter/?settings=eyJpbmRlbnQiOiI0In0%3D',
	'/json-formatter?settings=eyJpbmRlbnQiOiI0In0%3D',
	'/json-formatter/?settings=value/',
	'/json-formatter/',
	'/json-formatter',
]) {
	test(`#630: オフラインで保存済みページHTMLを返し、リダイレクトしない: ${path}`, async () => {
		const { response, request, networkRequests } = await fetchOffline(path, [
			['/json-formatter/', 'JSON整形ページ'],
			['/offline/', 'オフライン案内'],
		]);
		assert.ok(response);
		assert.equal(await response.text(), 'JSON整形ページ');
		assert.equal(response.status, 200);
		assert.equal(response.redirected, false);
		assert.equal(response.headers.get('location'), null);
		assert.equal(request.url, `https://tools.codelife.cafe${path}`);
		assert.deepEqual(networkRequests, [request.url]);
	});
}

test('#630: クエリ付きURLの完全一致キャッシュを優先する', async () => {
	const path = '/json-formatter/?settings=eyJpbmRlbnQiOiI0In0%3D';
	const { response } = await fetchOffline(path, [
		[path, '完全一致ページ'],
		['/json-formatter/', 'プリキャッシュページ'],
		['/offline/', 'オフライン案内'],
	]);
	assert.equal(await response?.text(), '完全一致ページ');
});

test('#630: 未キャッシュページはオフライン案内へフォールバックする', async () => {
	const { response } = await fetchOffline('/uncached/?settings=value', [
		['/json-formatter/', 'JSON整形ページ'],
		['/offline/', 'オフライン案内'],
	]);
	assert.equal(await response?.text(), 'オフライン案内');
});

test('#630: ページの通常fetchにはクエリなしフォールバックを適用しない', async () => {
	const { response } = await fetchOffline(
		'/json-formatter/?settings=value',
		[
			['/json-formatter/', 'JSON整形ページ'],
			['/offline/', 'オフライン案内'],
		],
		'cors',
	);
	assert.equal(await response?.text(), 'オフライン案内');
});

test('#630: 静的アセットはクエリ付きURLの完全一致をCache Firstで返す', async () => {
	const path = '/_astro/app.js?v=1';
	const { response, networkRequests } = await fetchOffline(
		path,
		[
			[path, '一致するアセット'],
			['/_astro/app.js', 'クエリなしアセット'],
		],
		'cors',
	);
	assert.equal(await response?.text(), '一致するアセット');
	assert.deepEqual(networkRequests, []);
});

test('#630: 静的アセットにはクエリなしフォールバックを適用しない', async () => {
	await assert.rejects(
		fetchOffline(
			'/_astro/app.js?v=1',
			[
				['/_astro/app.js', 'クエリなしアセット'],
				['/offline/', 'オフライン案内'],
			],
			'cors',
		),
		{ name: 'TypeError', message: 'offline' },
	);
});
