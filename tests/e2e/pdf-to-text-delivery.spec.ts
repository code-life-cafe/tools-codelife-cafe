// 通常配信状態（共通fixtureのルーティング・Service Worker無効化を使わない）での確認。
// base fixture の page は使わず、素の BrowserContext（Service Worker 許可）を新規に作って観測する。
// 本文・ファイル名に見立てた公開の合成マーカーが、通信・ログ・ストレージ・キャッシュ・URLに出ないこと、
// 初回取得後にオフラインでも再読み込み・再抽出できることを確認する。
import fs from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { expect, test } from './fixtures/base';
import { fixturePath } from './helpers/pdf-expansion';

const MARK_TEXT = 'SYNTH-TEXT-MARKER-7F3A9C';
const MARK_FILE_A = 'synth-file-marker-a-51d2e8';
const MARK_FILE_B = 'synth-file-marker-b-9c40b7';
const MARKERS = [MARK_TEXT, MARK_FILE_A, MARK_FILE_B];

async function markerPdf() {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	doc.addPage([400, 200]).drawText(MARK_TEXT, {
		x: 20,
		y: 100,
		size: 12,
		font,
	});
	return Buffer.from(await doc.save());
}

test('通常配信: 合成マーカーが通信・ログ・保存先に出ず、初回取得後はオフラインで再読み込み・再抽出できる', async ({
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
		// SW経由のrequestはPlaywrightでPOST本文を取得できない場合があるため、
		// 実送信を維持したままsendBeaconのBlob内容も独立に観測する。
		const beacons: Array<{ url: string; body: string }> = [];
		await context.exposeBinding(
			'__pdfTextObserveBeacon',
			(_source, entry: { url: string; body: string }) => beacons.push(entry),
		);
		await context.addInitScript(() => {
			const original = navigator.sendBeacon.bind(navigator);
			const pending: Promise<unknown>[] = [];
			Object.defineProperty(window, '__pdfTextBeaconPending', {
				value: pending,
			});
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
									__pdfTextObserveBeacon: (entry: {
										url: string;
										body: string;
									}) => Promise<void>;
								}
							).__pdfTextObserveBeacon({ url: String(url), body: text }),
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
					(window as unknown as { __pdfTextBeaconPending: Promise<unknown>[] })
						.__pdfTextBeaconPending,
				);
			});
		const logs: string[] = [];
		page.on('console', (message) => logs.push(message.text()));
		page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));
		const hydrated = () =>
			expect(page.locator('astro-island[ssr][client="load"]')).toHaveCount(0, {
				timeout: 25_000,
			});
		const fileInput = page.locator('input[type="file"]');
		const output = page.getByTestId('pdf-to-text-output');
		const runButton = page.getByRole('button', { name: 'テキストを抽出' });

		// --- 初回（オンライン）: SW制御後に再読み込みし、このツールのページを通常経路でキャッシュする ---
		await page.goto('/pdf-to-text/');
		await hydrated();
		await page.evaluate(() => navigator.serviceWorker.ready);
		await page.waitForFunction(() => !!navigator.serviceWorker.controller);
		await page.reload();
		await hydrated();

		await fileInput.setInputFiles({
			name: `${MARK_FILE_A}.pdf`,
			mimeType: 'application/pdf',
			buffer: await markerPdf(),
		});
		await expect(page.getByTestId('pdf-to-text-info')).toContainText(
			'全1ページ',
		);
		await runButton.click();
		await expect(output).toHaveValue(`--- 1ページ目 ---\n${MARK_TEXT}`);
		const saved = page.waitForEvent('download');
		await page.getByRole('button', { name: 'TXTで保存' }).click();
		expect((await saved).suggestedFilename()).toBe(`${MARK_FILE_A}_text.txt`);

		// 日本語CMapを含め、必要な資産を通常の抽出操作で取得してからオフラインにする。
		// 全サイトの一括キャッシュ完了はこのツールのACではない。
		await fileInput.setInputFiles({
			name: `${MARK_FILE_B}.pdf`,
			mimeType: 'application/pdf',
			buffer: fs.readFileSync(fixturePath('text-ja.pdf')),
		});
		await expect(page.getByTestId('pdf-to-text-info')).toContainText(
			'全3ページ',
		);
		await page.getByLabel('抽出するページ').fill('1');
		await runButton.click();
		await expect(output).toHaveValue(
			/^--- 1ページ目 ---\n日本語テキストの抽出確認\nPage 1/,
		);

		// --- オフライン: 再読み込みと、日本語CMapを使う2回目の抽出 ---
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
			name: `${MARK_FILE_B}.pdf`,
			mimeType: 'application/pdf',
			buffer: fs.readFileSync(fixturePath('text-ja.pdf')),
		});
		await expect(page.getByTestId('pdf-to-text-info')).toContainText(
			'全3ページ',
		);
		await page.getByLabel('抽出するページ').fill('1');
		await runButton.click();
		await expect(output).toHaveValue(
			/^--- 1ページ目 ---\n日本語テキストの抽出確認\nPage 1/,
		);

		// オフライン中の同一オリジン取得はすべて成功し、Worker と日本語CMapはService Workerが返した
		const sameOrigin = offline.filter((entry) => entry.url.startsWith(origin));
		expect(sameOrigin.every((entry) => entry.status < 400)).toBe(true);
		expect(
			sameOrigin.some(
				(entry) => /UniJIS-UCS2-H.*\.bcmap/.test(entry.url) && entry.fromSW,
			),
		).toBe(true);
		expect(
			sameOrigin.some(
				(entry) => /pdf\.worker\.min.*\.js/.test(entry.url) && entry.fromSW,
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
		// 既存Allowlistの匿名計測だけを許可する。本文/ファイル名マーカーの漏洩検査は全リクエスト対象。
		for (const request of requests.filter(
			(r) =>
				r.method !== 'GET' && r.method !== 'HEAD' && r.url.startsWith(origin),
		)) {
			expect(request.method).toBe('POST');
			expect(new URL(request.url).pathname).toBe('/api/event');
		}
		expect(beacons.length).toBeGreaterThan(0);
		expect(
			beacons.filter((entry) => JSON.parse(entry.body).event === 'tool_run'),
		).toHaveLength(3);
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
			expect(payload.props.tool).toBe('pdf-to-text');
			const keys =
				payload.event === 'tool_run'
					? ['dedupeKey', 'source', 'tool']
					: payload.event === 'settings_restore'
						? ['source', 'tool']
						: ['tool'];
			expect(Object.keys(payload.props).sort()).toEqual(keys);
		}

		expect(
			logs.filter((line) => MARKERS.some((m) => line.includes(m))),
		).toEqual([]);

		const stored = await page.evaluate(async () => {
			const cacheKeys: string[] = [];
			for (const name of await caches.keys()) {
				const cache = await caches.open(name);
				cacheKeys.push(name, ...(await cache.keys()).map((r) => r.url));
			}
			const dbs = (await indexedDB.databases?.()) ?? [];
			return JSON.stringify({
				href: location.href,
				local: { ...localStorage },
				session: { ...sessionStorage },
				cookie: document.cookie,
				cacheKeys,
				dbs: dbs.map((db) => db.name),
				referrer: document.referrer,
			});
		});
		for (const marker of MARKERS)
			expect(stored.toLowerCase()).not.toContain(marker.toLowerCase());
		expect(JSON.parse(stored).local['tool_settings_pdf-to-text']).toBe(
			JSON.stringify({ lineMode: 'internal', pageHeadings: true }),
		);

		// 証跡: 外部オリジンと、送信系リクエストの有無を実行結果に残す
		const evidence = {
			requestsTotal: requests.length,
			observedBeaconBodies: beacons.length,
			requestsWhileOffline: requests.length - onlineRequestCount,
			externalOrigins: external,
			nonGetRequests: requests
				.filter(
					(request) => request.method !== 'GET' && request.method !== 'HEAD',
				)
				.map((request) => `${request.method} ${request.url}`),
			consoleLines: logs.length,
			offlineSameOriginResponses: sameOrigin.length,
			offlineFromServiceWorker: sameOrigin.filter((entry) => entry.fromSW)
				.length,
		};
		console.log(`DELIVERY_EVIDENCE ${JSON.stringify(evidence)}`);
		await test.info().attach('delivery-evidence.json', {
			body: JSON.stringify(evidence, null, 2),
			contentType: 'application/json',
		});
	} finally {
		await context.close();
	}
});
