import { expect, test } from './fixtures/base';

type AnalyticsEvent = {
	eventName: string;
	props?: Record<string, unknown>;
};

declare global {
	interface Window {
		__analyticsEvents?: AnalyticsEvent[];
		cloudflare?: {
			track?: (eventName: string, props?: Record<string, unknown>) => void;
		};
	}
}

async function readEvents(page: import('@playwright/test').Page) {
	return page.evaluate(
		() =>
			JSON.parse(
				localStorage.getItem('__analyticsEvents') ?? '[]',
			) as AnalyticsEvent[],
	);
}

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const pushEvent = (eventName: string, props?: Record<string, unknown>) => {
			const current = JSON.parse(
				localStorage.getItem('__analyticsEvents') ?? '[]',
			) as AnalyticsEvent[];
			const next = [...current, { eventName, props }];
			window.__analyticsEvents = next;
			localStorage.setItem('__analyticsEvents', JSON.stringify(next));
		};

		localStorage.setItem('__analyticsEvents', '[]');
		window.__analyticsEvents = [];
		window.cloudflare = { track: pushEvent };
		window.addEventListener('codelife:analytics', (event) => {
			const detail = (event as CustomEvent<AnalyticsEvent>).detail;
			pushEvent(detail.eventName, detail.props);
		});
	});
});

test('共有URL・実利用開始・実行イベントが入力内容なしで発火する', async ({
	page,
}) => {
	await page.goto('/json-formatter?shared=1');
	await page.locator('textarea').first().fill('{"name":"secret"}');
	await page.getByRole('button', { name: '整形' }).click();

	await expect
		.poll(async () => readEvents(page))
		.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					eventName: 'shared_url_open',
					props: { tool: 'json-formatter' },
				}),
				expect.objectContaining({
					eventName: 'tool_engage',
					props: { tool: 'json-formatter' },
				}),
				expect.objectContaining({
					eventName: 'tool_run',
					props: { tool: 'json-formatter' },
				}),
			]),
		);

	const serialized = JSON.stringify(await readEvents(page));
	expect(serialized).not.toContain('secret');
});

test('検索0件と関連ツールクリックイベントが発火する', async ({ page }) => {
	await page.goto('/base64');
	await page.keyboard.press('Control+k');
	await page.getByPlaceholder(/ツールを検索/).fill('notfound-analytics-query');

	await expect
		.poll(async () => readEvents(page))
		.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					eventName: 'search_empty',
					props: { q: 'notfound-analytics-query' },
				}),
			]),
		);

	await page.keyboard.press('Escape');
	await page
		.locator(
			'section[aria-labelledby="related-tools-heading"] a[href="/url-encoder"]',
		)
		.click();

	await expect
		.poll(async () => readEvents(page))
		.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					eventName: 'related_click',
					props: { from: 'base64', to: 'url-encoder' },
				}),
			]),
		);
});
