import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/base';

type Payload = {
	event: string;
	props: Record<string, unknown>;
	sessionId: string;
	timestamp: number;
	webdriver: boolean;
};

async function collectEvents(page: Page) {
	const events: Payload[] = [];
	await page.route('**/api/event', async (route) => {
		events.push(JSON.parse(route.request().postData() ?? '{}'));
		await route.fulfill({ status: 204 });
	});
	return events;
}

const samples = [
	{ slug: 'color', selector: '#color-input', input: '#FF0000' },
	{
		slug: 'cron-checker',
		selector: '#cron-checker-input',
		input: '0 10 * * 1',
	},
	{ slug: 'dummy-data', selector: 'input[type="number"]', input: '11' },
	{ slug: 'wareki-converter', selector: 'input[type="number"]', input: '2024' },
	{ slug: 'regex-tester', selector: 'textarea', input: '合成テスト100-0001' },
	{
		slug: 'mermaid',
		selector: 'textarea',
		input: 'graph TD\n A[合成入力] --> B[検証]',
	},
];

for (const sample of samples) {
	test(`${sample.slug}: 初期サンプルはrun/engageを送らず入力後に既存形式でrunを送る`, async ({
		page,
	}) => {
		const events = await collectEvents(page);
		await page.goto(`/${sample.slug}`);
		// 最長の初期描画と既存500msデバウンスが確定してから負の条件を検証する。
		if (sample.slug === 'mermaid')
			await expect(page.locator('svg[id^="mermaid-"]').first()).toBeAttached();
		await page.waitForTimeout(1200);
		expect(
			events.filter((event) =>
				['tool_run', 'tool_engage'].includes(event.event),
			),
		).toEqual([]);
		await page.locator(sample.selector).first().fill(sample.input);
		await expect
			.poll(() => events.filter((event) => event.event === 'tool_run').length)
			.toBe(1);
		await page.waitForTimeout(600);
		const runs = events.filter((event) => event.event === 'tool_run');
		expect(runs).toHaveLength(1);
		expect(runs[0].props).toEqual({
			tool: sample.slug,
			source: 'debounced-input',
			dedupeKey: expect.any(String),
		});
		expect(Object.keys(runs[0]).sort()).toEqual([
			'event',
			'props',
			'sessionId',
			'timestamp',
			'webdriver',
		]);
		expect(runs[0].sessionId).toBeTruthy();
		expect(
			events.filter((event) => event.event === 'tool_engage'),
		).toHaveLength(1);
		// 短い数値が既存UUID/timestampへ偶然含まれる場合を入力漏洩と誤判定しない。
		expect(JSON.stringify(events.map((event) => event.props))).not.toContain(
			'合成',
		);
	});
}

test('初期Mermaid import待機中のクリックだけでは初期runを解禁しない', async ({
	page,
}) => {
	const events = await collectEvents(page);
	let releaseImport: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		releaseImport = resolve;
	});
	let importPending = false;
	await page.route('**/mermaid.core.*.js', async (route) => {
		importPending = true;
		await gate;
		await route.continue();
	});
	await page.goto('/mermaid');
	await expect.poll(() => importPending).toBe(true);
	await page.locator('textarea').click();
	releaseImport();
	await expect(page.locator('svg[id^="mermaid-"]').first()).toBeAttached();
	await page.waitForTimeout(700);
	expect(events.filter((event) => event.event === 'tool_run')).toEqual([]);
	await page.locator('textarea').fill('graph TD\n A[合成変更] --> B[検証]');
	await expect
		.poll(() => events.filter((event) => event.event === 'tool_run').length)
		.toBe(1);
});

test('document全体のengageを維持し、ヘッダー操作では初期runを解禁しない', async ({
	page,
}) => {
	const events = await collectEvents(page);
	await page.goto('/color');
	await page.getByRole('button', { name: 'ツールを検索', exact: true }).click();
	await page.keyboard.press('Escape');
	await expect
		.poll(() => events.filter((event) => event.event === 'tool_engage').length)
		.toBe(1);
	await page.waitForTimeout(700);
	expect(events.filter((event) => event.event === 'tool_run')).toEqual([]);
	await page.locator('#color-input').fill('#00FF00');
	await expect
		.poll(() => events.filter((event) => event.event === 'tool_run').length)
		.toBe(1);
	expect(events.filter((event) => event.event === 'tool_engage')).toHaveLength(
		1,
	);
});

for (const pathname of [
	'/cron-checker?expr=0%2011%20*%20*%201',
	`/regex-tester?settings=${encodeURIComponent(Buffer.from(JSON.stringify({ pattern: 'a', flags: 'g', showReplace: false, replacement: '' })).toString('base64'))}`,
]) {
	test(`初期URL復元でrunを送らない: ${pathname.split('?')[0]}`, async ({
		page,
	}) => {
		const events = await collectEvents(page);
		await page.goto(pathname);
		await page.waitForTimeout(1200);
		expect(
			events.filter((event) =>
				['tool_run', 'tool_engage'].includes(event.event),
			),
		).toEqual([]);
		if (pathname.startsWith('/cron'))
			await expect(page.locator('#cron-checker-input')).toHaveValue(
				'0 11 * * 1',
			);
		else
			expect(
				events.some(
					(event) =>
						event.event === 'settings_restore' && event.props.source === 'url',
				),
			).toBe(true);
	});
}

test('JSONの不正入力・成功入力とも実行試行として既存runを維持する', async ({
	page,
}) => {
	const events = await collectEvents(page);
	await page.goto('/json-formatter');
	await page.locator('textarea').first().fill('{"合成":');
	await expect(page.locator('.bg-destructive\\/10')).toBeVisible();
	await page.getByRole('button', { name: /整形/ }).click();
	await expect
		.poll(() => events.filter((event) => event.event === 'tool_run').length)
		.toBe(1);
	await page.locator('textarea').first().fill('{"合成":1}');
	await expect(page.locator('pre')).toContainText('"合成": 1');
	await page.getByRole('button', { name: /整形/ }).click();
	await expect
		.poll(() => events.filter((event) => event.event === 'tool_run').length)
		.toBe(2);
	expect(
		events
			.filter((event) => event.event === 'tool_run')
			.every((event) => event.props.source === 'button'),
	).toBe(true);
	expect(events.some((event) => /success/.test(event.event))).toBe(false);
});

for (const pathname of [
	'/transcribe',
	'/video-compress',
	'/tools/transcribe/',
	'/tools/video-compress/',
]) {
	test(`${pathname}: 解析停止のままヘッダー検索・操作を利用できる`, async ({
		page,
	}) => {
		const events = await collectEvents(page);
		await page.goto(pathname);
		if (pathname === '/tools/video-compress/') {
			// 旧Astroの静的meta転送はgotoの後に完了するため移動先のhydrationまで待つ。
			await page.waitForURL(/\/video-compress\/?$/);
			await expect(
				page.locator('astro-island[ssr][client="load"]'),
			).toHaveCount(0);
		}
		expect(
			await page.evaluate(
				() =>
					(window as Window & { __CLC_ANALYTICS_DISABLED__?: boolean })
						.__CLC_ANALYTICS_DISABLED__,
			),
		).toBe(true);
		await expect(page.locator('script[src*="cloudflareinsights"]')).toHaveCount(
			0,
		);
		await page
			.getByRole('button', { name: 'ツールを検索', exact: true })
			.click();
		await page
			.getByRole('dialog')
			.getByRole('combobox')
			.fill('合成未一致検索abcdefgh');
		await page.waitForTimeout(1000);
		expect(events).toEqual([]);
		expect(
			await page.evaluate(() =>
				sessionStorage.getItem('clc_analytics_session_id'),
			),
		).toBeNull();
	});
}
