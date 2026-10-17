import { expect, test } from './fixtures/base';

test('synthetic contexts opt out on navigation and locally consume analytics POSTs', async ({
	page,
	excludedAnalyticsRequests,
}) => {
	const navigation = await page.goto('/color/');
	expect(await navigation?.request().headerValue('X-CLC-Synthetic')).toBe('1');
	const status = await page.evaluate(async () => {
		const response = await fetch('/api/event', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ event: 'tool_engage', props: { tool: 'color' } }),
		});
		return response.status;
	});
	expect(status).toBe(204);
	expect(excludedAnalyticsRequests).toContain(
		new URL('/api/event', page.url()).href,
	);
	await expect(page.locator('#color-input')).toBeVisible();
});

test('RUM script and same-origin collector are blocked before network delivery', async ({
	page,
	excludedAnalyticsRequests,
}) => {
	await page.goto('/color/');
	const results = await page.evaluate(async () => {
		return Promise.all(
			[
				'https://static.cloudflareinsights.com/beacon.min.js',
				'https://cloudflareinsights.com/cdn-cgi/rum',
				'/cdn-cgi/rum',
			].map(async (url) => {
				try {
					await fetch(url);
					return 'sent';
				} catch {
					return 'blocked';
				}
			}),
		);
	});
	expect(results).toEqual(['blocked', 'blocked', 'blocked']);
	// Handler evidence distinguishes interception from CORS/DNS failure.
	for (const url of [
		'https://static.cloudflareinsights.com/beacon.min.js',
		'https://cloudflareinsights.com/cdn-cgi/rum',
		new URL('/cdn-cgi/rum', page.url()).href,
	]) {
		expect(excludedAnalyticsRequests).toContain(url);
	}
	const scriptUrl =
		'https://static.cloudflareinsights.com/beacon.min.js?synthetic-script-test';
	await expect(page.addScriptTag({ url: scriptUrl })).rejects.toThrow();
	expect(excludedAnalyticsRequests).toContain(scriptUrl);
});
