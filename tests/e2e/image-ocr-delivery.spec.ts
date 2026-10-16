// 画像OCRの通常配信（共通fixtureの通信遮断を使わない）での確認。
// 素の BrowserContext（Service Worker 許可）で、合成マーカー（ファイル名・画像メタデータ・認識結果の文）が
// 通信・ログ・ストレージ・URLに出ないこと、現行CSPのまま同一オリジンだけで動くこと、
// 言語データ取得後はオフラインでも再読み込み・再認識できること、全サイトのprecacheに混入しないことを観測する。
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/base';
import { fixtureImage, insertPngChunk } from './helpers/ocr';

const MARK_FILE = 'synth-file-marker-ocr-3b81f2';
const MARK_META = 'SYNTH-META-MARKER-ocr-77d1c4';
// fixture 07 の画像内の文（認識結果に出るはずの文）。通信・保存先に出てはならない
const MARK_TEXT = 'Please review the report before Friday afternoon';
const MARKERS = [MARK_FILE, MARK_META, MARK_TEXT];

function markerImage(): Buffer {
	return insertPngChunk(
		fs.readFileSync(fixtureImage('clear/07-meiryo-english.png')),
		'tEXt',
		Buffer.from(`Comment\0${MARK_META}`, 'latin1'),
	);
}

/** public/_headers の既定（先頭 /* ブロック）のヘッダーを、現行のまま読み出す */
function defaultHeaders(): Record<string, string> {
	const text = fs.readFileSync(
		path.join(process.cwd(), 'public', '_headers'),
		'utf8',
	);
	const grab = (name: string) =>
		text.match(new RegExp(`^\\s+${name}: (.+)$`, 'm'))?.[1].trim() ?? '';
	return {
		'content-security-policy': grab('Content-Security-Policy'),
		'cross-origin-opener-policy': grab('Cross-Origin-Opener-Policy'),
		'cross-origin-embedder-policy': grab('Cross-Origin-Embedder-Policy'),
	};
}

test('通常配信: 合成マーカーが通信・ログ・保存先に出ず、取得後はオフラインでも再認識できる', async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(240_000);
	const origin = new URL(baseURL ?? '').origin;
	const context = await browser.newContext({
		baseURL,
		serviceWorkers: 'allow',
	});
	try {
		const requests: Array<{
			url: string;
			method: string;
			body: string;
			headers: string;
		}> = [];
		context.on('request', (request) =>
			requests.push({
				url: request.url(),
				method: request.method(),
				body: request.postData() ?? '',
				headers: JSON.stringify(request.headers()),
			}),
		);
		const beacons: Array<{ url: string; body: string }> = [];
		await context.exposeBinding(
			'__ocrObserveBeacon',
			(_source, entry: { url: string; body: string }) => beacons.push(entry),
		);
		await context.addInitScript(() => {
			const original = navigator.sendBeacon.bind(navigator);
			const pending: Promise<unknown>[] = [];
			Object.defineProperty(window, '__ocrBeaconPending', { value: pending });
			Object.defineProperty(navigator, 'sendBeacon', {
				value: (url: string | URL, data?: BodyInit | null) => {
					const body =
						data instanceof Blob
							? data.text()
							: Promise.resolve(String(data ?? ''));
					pending.push(
						body.then((text) =>
							(
								window as unknown as {
									__ocrObserveBeacon: (entry: {
										url: string;
										body: string;
									}) => Promise<void>;
								}
							).__ocrObserveBeacon({ url: String(url), body: text }),
						),
					);
					return original(url, data);
				},
			});
		});
		const page = await context.newPage();
		const flushBeacons = () =>
			page.evaluate(async () => {
				await Promise.all(
					(window as unknown as { __ocrBeaconPending: Promise<unknown>[] })
						.__ocrBeaconPending,
				);
			});
		const logs: string[] = [];
		page.on('console', (message) => logs.push(message.text()));
		page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));
		const hydrated = () =>
			expect(page.locator('astro-island[ssr][client="load"]')).toHaveCount(0, {
				timeout: 25_000,
			});
		const fileInput = page.getByTestId('image-ocr-input');
		const output = page.getByTestId('image-ocr-output');
		const runButton = page.getByTestId('image-ocr-run');
		const isOcrAsset = (url: string) => /\/(vendor|models)\/ocr\//.test(url);

		// --- 初回（オンライン）: SW制御後に再読み込みし、ページを通常経路でキャッシュする ---
		await page.goto('/image-ocr/');
		await hydrated();
		await page.evaluate(() => navigator.serviceWorker.ready);
		await page.waitForFunction(() => !!navigator.serviceWorker.controller);
		await page.reload();
		await hydrated();
		// ページを開いただけ・画像を選んだだけでは、エンジンも言語データも取得しない
		expect(requests.filter((r) => isOcrAsset(r.url))).toEqual([]);

		await fileInput.setInputFiles({
			name: `${MARK_FILE}.png`,
			mimeType: 'image/png',
			buffer: markerImage(),
		});
		await expect(page.getByTestId('image-ocr-info')).toContainText(MARK_FILE);
		await page.waitForTimeout(500);
		expect(requests.filter((r) => isOcrAsset(r.url))).toEqual([]);
		await runButton.click();
		await expect(output).toHaveValue(new RegExp(MARK_TEXT), {
			timeout: 60_000,
		});
		const saved = page.waitForEvent('download');
		await page.getByTestId('image-ocr-save').click();
		expect((await saved).suggestedFilename()).toBe(`${MARK_FILE}_ocr.txt`);

		// --- オフライン: 再読み込みして、同じ操作で再認識する ---
		await flushBeacons();
		const onlineRequestCount = requests.length;
		await context.setOffline(true);
		const offline: Array<{ url: string; fromSW: boolean; status: number }> = [];
		const failed: string[] = [];
		page.on('response', (response) =>
			offline.push({
				url: response.url(),
				fromSW: response.fromServiceWorker(),
				status: response.status(),
			}),
		);
		page.on('requestfailed', (request) => failed.push(request.url()));
		await page.reload();
		await hydrated();
		await fileInput.setInputFiles({
			name: `${MARK_FILE}.png`,
			mimeType: 'image/png',
			buffer: markerImage(),
		});
		await runButton.click();
		await expect(output).toHaveValue(new RegExp(MARK_TEXT), {
			timeout: 60_000,
		});
		const offlineAssets = offline.filter((e) => isOcrAsset(e.url));
		// 言語データは専用キャッシュから読み、ネットワーク（SW含む）へは取りに行かない
		expect(offlineAssets.filter((e) => e.url.includes('.traineddata'))).toEqual(
			[],
		);
		// Worker と core はService Workerが返した
		expect(
			offlineAssets.some(
				(e) => e.url.includes('worker.min.js') && e.fromSW && e.status < 400,
			),
		).toBe(true);
		expect(
			offlineAssets.some(
				(e) => e.url.includes('/core/') && e.fromSW && e.status < 400,
			),
		).toBe(true);
		expect(failed.filter((url) => url.startsWith(origin))).toEqual([]);

		await flushBeacons();
		// --- 観測結果の照合（オンライン・オフライン両方） ---
		const external = [
			...new Set(
				requests
					.map((request) => new URL(request.url))
					.filter((url) => !['blob:', 'data:'].includes(url.protocol))
					.filter((url) => url.origin !== origin)
					.map((url) => url.origin),
			),
		];
		const leaks = requests.filter((request) =>
			MARKERS.some((marker) =>
				`${request.url}\n${request.body}\n${request.headers}`
					.toLowerCase()
					.includes(marker.toLowerCase()),
			),
		);
		expect(leaks.map((request) => request.url)).toEqual([]);
		for (const request of requests.filter(
			(r) =>
				r.method !== 'GET' && r.method !== 'HEAD' && r.url.startsWith(origin),
		)) {
			expect(request.method).toBe('POST');
			expect(new URL(request.url).pathname).toBe('/api/event');
		}
		// 同一オリジン以外へ画像・文字が出ない（CDN・外部OCRなし）
		expect(
			external.filter((o) => !/cloudflareinsights|googletagmanager/.test(o)),
		).toEqual([]);
		expect(requests.some((r) => r.url.includes('cdn.jsdelivr.net'))).toBe(
			false,
		);

		expect(beacons.length).toBeGreaterThan(0);
		for (const entry of beacons) {
			expect(new URL(entry.url, origin).pathname).toBe('/api/event');
			for (const marker of MARKERS) expect(entry.body).not.toContain(marker);
			const payload = JSON.parse(entry.body);
			expect(Object.keys(payload).sort()).toEqual([
				'event',
				'props',
				'sessionId',
				'timestamp',
				'webdriver',
			]);
			expect(['tool_engage', 'tool_run', 'settings_restore']).toContain(
				payload.event,
			);
			expect(payload.props.tool).toBe('image-ocr');
			const keys =
				payload.event === 'tool_run'
					? ['dedupeKey', 'source', 'tool']
					: payload.event === 'settings_restore'
						? ['source', 'tool']
						: ['tool'];
			expect(Object.keys(payload.props).sort()).toEqual(keys);
		}
		expect(
			beacons.filter((entry) => JSON.parse(entry.body).event === 'tool_run')
				.length,
		).toBeGreaterThanOrEqual(1);

		expect(
			logs.filter((line) => MARKERS.some((m) => line.includes(m))),
		).toEqual([]);

		const stored = await page.evaluate(async () => {
			const cacheEntries: Record<string, string[]> = {};
			for (const name of await caches.keys()) {
				const cache = await caches.open(name);
				cacheEntries[name] = (await cache.keys()).map((r) => r.url);
			}
			const dbs = (await indexedDB.databases?.()) ?? [];
			return {
				href: location.href,
				local: { ...localStorage },
				session: { ...sessionStorage },
				cookie: document.cookie,
				cacheEntries,
				dbs: dbs.map((db) => db.name),
				referrer: document.referrer,
			};
		});
		const serialized = JSON.stringify(stored).toLowerCase();
		for (const marker of MARKERS) {
			expect(serialized).not.toContain(marker.toLowerCase());
		}
		// 保存される設定は言語モードだけ。エンジン独自のIndexedDBキャッシュは使わない
		expect(stored.local['tool_settings_image-ocr']).toBe(
			JSON.stringify({ mode: 'jpn+eng' }),
		);
		// 既存の共通キー recent_tools（ツールのslugだけ）以外に、画像・文字に由来する保存はない
		expect(Object.keys(stored.local).sort()).toEqual([
			'recent_tools',
			'tool_settings_image-ocr',
		]);
		expect(JSON.parse(stored.local.recent_tools)).toEqual(['image-ocr']);
		expect(stored.dbs).toEqual([]);
		// 専用キャッシュには固定URLの言語データ（jpn・eng）だけがある
		expect(
			(stored.cacheEntries['ocr-models-v1'] ?? []).map(
				(u) => new URL(u).pathname,
			),
		).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/\/models\/ocr\/[0-9a-f]{40}\/jpn\.traineddata$/),
				expect.stringMatching(/\/models\/ocr\/[0-9a-f]{40}\/eng\.traineddata$/),
			]),
		);
		expect(stored.cacheEntries['ocr-models-v1']).toHaveLength(2);

		const evidence = {
			requestsTotal: requests.length,
			observedBeaconBodies: beacons.length,
			requestsWhileOffline: requests.length - onlineRequestCount,
			externalOrigins: external,
			nonGetRequests: requests
				.filter((r) => r.method !== 'GET' && r.method !== 'HEAD')
				.map((r) => `${r.method} ${r.url}`),
			consoleLines: logs.length,
			cacheNames: Object.keys(stored.cacheEntries),
			offlineOcrAssets: offlineAssets.map((e) => ({
				path: new URL(e.url).pathname.split('/').slice(-2).join('/'),
				fromSW: e.fromSW,
				status: e.status,
			})),
		};
		console.log(`OCR_DELIVERY_EVIDENCE ${JSON.stringify(evidence)}`);
		await test.info().attach('delivery-evidence.json', {
			body: JSON.stringify(evidence, null, 2),
			contentType: 'application/json',
		});
	} finally {
		await context.close();
	}
});

test('現行CSP（_headersの既定）のまま、同一オリジンだけでWorker・core・言語データが動く', async ({
	page,
	baseURL,
}) => {
	test.setTimeout(120_000);
	const headers = defaultHeaders();
	expect(headers['content-security-policy']).toContain("default-src 'self'");
	// 本番の _headers（/* 全パス）と同じく、ドキュメントだけでなく Worker・core・言語データなど
	// 同一オリジンの全レスポンスへ現行ヘッダーを付ける（Workerのスクリプトにも COEP が要るため）
	await page.route('**/*', async (route) => {
		if (
			!route
				.request()
				.url()
				.startsWith(baseURL ?? '')
		)
			return route.continue();
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: { ...response.headers(), ...headers },
		});
	});
	await page.addInitScript(() => {
		const w = window as unknown as { __cspViolations: string[] };
		w.__cspViolations = [];
		document.addEventListener('securitypolicyviolation', (e) =>
			w.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
		);
	});
	const origins = new Set<string>();
	page.on('request', (r) => {
		const url = new URL(r.url());
		if (!['blob:', 'data:'].includes(url.protocol)) origins.add(url.origin);
	});
	await page.goto('/image-ocr/');
	const response = await page.request.get('/image-ocr/');
	expect(response.ok()).toBe(true);
	await page
		.getByTestId('image-ocr-input')
		.setInputFiles(fixtureImage('clear/07-meiryo-english.png'));
	await page.getByTestId('image-ocr-run').click();
	await expect(page.getByTestId('image-ocr-output')).toHaveValue(
		/quick brown fox/,
		{ timeout: 60_000 },
	);
	expect(
		await page.evaluate(
			() =>
				(window as unknown as { __cspViolations: string[] }).__cspViolations,
		),
	).toEqual([]);
	// CSPが実際に適用されていること（許可外オリジンへの接続が違反として検出される）
	const probe = await page.evaluate(async () => {
		const result = await fetch('https://csp-probe.example.invalid/x').then(
			() => 'allowed',
			() => 'blocked',
		);
		await new Promise((r) => setTimeout(r, 100));
		return {
			result,
			violations: (window as unknown as { __cspViolations: string[] })
				.__cspViolations,
		};
	});
	expect(probe.result).toBe('blocked');
	expect(probe.violations.some((v) => v.startsWith('connect-src'))).toBe(true);
	expect(
		[...origins].filter(
			(o) => o !== new URL(page.url()).origin && !o.includes('csp-probe'),
		),
	).toEqual([]);
});

test('OCR資産は全ページ共通のprecacheに入らず、トップページはエンジンを読み込まない', async ({
	page,
}) => {
	const sw = await (await page.request.get('/sw.js')).text();
	expect(sw).not.toMatch(/vendor\/ocr|models\/ocr|traineddata/);
	const urls: string[] = [];
	page.on('request', (r) => urls.push(r.url()));
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	expect(
		urls.filter((u) => /\/(vendor|models)\/ocr\/|ImageOcr|tesseract/i.test(u)),
	).toEqual([]);
});
