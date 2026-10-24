import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { listAllowedRuntimePaths } from '../../src/lib/transcribe/model-manifest';
import { expect, test } from './fixtures/base';

test('一括保存後、未訪問の階層下ページと既存ページをオフラインで利用できる', async ({
	browser,
}, testInfo) => {
	const nested = '/cipher/caesar-hiragana/';
	const sw = await readFile('dist/sw.js', 'utf8');
	const pages: string[] = JSON.parse(
		sw.match(/const ALL_PAGES = (\[[\s\S]*?\]);/)?.[1] ?? 'null',
	);
	const assets: string[] = JSON.parse(
		sw.match(/const ALL_ASSETS = (\[[\s\S]*?\]);/)?.[1] ?? 'null',
	);
	const requests: string[] = [];
	const runtime = new Set(listAllowedRuntimePaths());
	// Pages serves these exact runtime files through R2. Use the build's verified
	// public copies locally; never fetch production or substitute asset responses.
	const server = createServer(async (request, response) => {
		try {
			const path = new URL(request.url ?? '/', 'http://localhost').pathname;
			requests.push(path);
			const root = resolve(runtime.has(path) ? 'public' : 'dist');
			let file = resolve(root, `.${decodeURIComponent(path)}`);
			if (!file.startsWith(`${root}${sep}`) && file !== root) {
				response.writeHead(403).end();
				return;
			}
			if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
			const mime: Record<string, string> = {
				'.html': 'text/html; charset=utf-8',
				'.js': 'text/javascript',
				'.mjs': 'text/javascript',
				'.css': 'text/css',
				'.wasm': 'application/wasm',
				'.json': 'application/json',
				'.webmanifest': 'application/manifest+json',
			};
			response.writeHead(200, {
				'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
				'Cache-Control': 'no-store',
			});
			response.end(await readFile(file));
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('No local port');
	const origin = `http://127.0.0.1:${address.port}`;
	const context = await browser.newContext({
		...testInfo.project.use,
		baseURL: origin,
		serviceWorkers: 'allow',
		extraHTTPHeaders: { 'X-CLC-Synthetic': '1' },
	});
	try {
		await context.route('**/*', (route) => {
			const url = new URL(route.request().url());
			if (url.origin !== origin) return route.abort();
			if (url.pathname === '/api/event' || url.pathname.startsWith('/cdn-cgi/'))
				return route.fulfill({ status: 204 });
			return route.continue();
		});
		const page = await context.newPage();
		await page.goto('/');
		await expect(page.locator('astro-island[ssr][client="load"]')).toHaveCount(
			0,
		);
		await page.evaluate(async () => {
			await navigator.serviceWorker.ready;
			if (!navigator.serviceWorker.controller)
				await new Promise<void>((accept) => {
					navigator.serviceWorker.addEventListener(
						'controllerchange',
						() => accept(),
						{
							once: true,
						},
					);
				});
		});
		expect(requests).not.toContain(nested);
		expect(
			await page.evaluate((url) => caches.match(url).then(Boolean), nested),
		).toBe(false);
		await page.evaluate(
			() =>
				new Promise<void>((accept) => {
					const listener = (event: MessageEvent) => {
						if (event.data?.type !== 'PRECACHE_COMPLETE') return;
						navigator.serviceWorker.removeEventListener('message', listener);
						accept();
					};
					navigator.serviceWorker.addEventListener('message', listener);
					navigator.serviceWorker.controller?.postMessage({
						type: 'PRECACHE_ALL',
					});
				}),
		);
		const status = await page.evaluate(
			() =>
				new Promise<{
					isComplete: boolean;
					cachedCount: number;
					totalCount: number;
					cacheName: string;
				}>((accept) => {
					const listener = (event: MessageEvent) => {
						if (event.data?.type !== 'PRECACHE_STATUS_RESULT') return;
						navigator.serviceWorker.removeEventListener('message', listener);
						accept(event.data);
					};
					navigator.serviceWorker.addEventListener('message', listener);
					navigator.serviceWorker.controller?.postMessage({
						type: 'CHECK_PRECACHE_STATUS',
					});
				}),
		);
		expect(status.isComplete).toBe(true);
		expect(status.cachedCount).toBe(pages.length + assets.length);
		expect(status.totalCount).toBe(pages.length + assets.length);
		const cached = await page.evaluate(async (name) => {
			const cache = await caches.open(name);
			return Promise.all(
				(await cache.keys()).map(async (key) => {
					const response = await cache.match(key);
					return {
						path: new URL(key.url).pathname,
						redirected: response?.redirected,
					};
				}),
			);
		}, status.cacheName);
		expect(
			cached.some(
				({ path }) => path.startsWith('/tools/') || path.startsWith('/models/'),
			),
		).toBe(false);
		expect(
			requests.some(
				(path) => path.startsWith('/tools/') || path.startsWith('/models/'),
			),
		).toBe(false);
		await testInfo.attach('precache-status', {
			body: JSON.stringify({ status, cached }),
			contentType: 'application/json',
		});
		await context.setOffline(true);
		await page.goto(nested);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'ひらがなのシーザー暗号：日本語の変換・解読',
		);
		await expect(page.locator('astro-island[ssr][client="load"]')).toHaveCount(
			0,
		);
		await page
			.getByRole('button', {
				name: 'ひらがなの例文を試す（こんにちは・シフト3）',
			})
			.click();
		await expect(
			page.getByPlaceholder('変換結果がここに表示されます'),
		).toHaveValue('すうのとへ');
		await page.goto('/cipher/');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'シーザー暗号変換・解読ツール',
		);
		await page.goto('/');
		await expect(page).toHaveTitle(/CODE:LIFE Tools/);
		await expect(page.getByRole('main')).toBeVisible();
		for (const path of [nested, '/', '/cipher/', '/offline/']) {
			expect(cached).toContainEqual({ path, redirected: false });
		}
	} finally {
		await context.close();
		await new Promise<void>((accept, reject) => {
			server.close((error) => (error ? reject(error) : accept()));
			server.closeAllConnections();
		});
	}
});
