import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/base';

type Tool = {
	name: string;
	execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
type State = Window & { __unicodeTools: Tool[]; __unicodeOutbound: string[] };
async function install(
	page: Page,
	mode: 'normal' | 'unsupported' | 'incomplete' | 'throw' = 'normal',
) {
	await page.addInitScript((mode) => {
		const state = window as unknown as State;
		state.__unicodeTools = [];
		state.__unicodeOutbound = [];
		const originalFetch = window.fetch.bind(window);
		window.fetch = (input, init) => {
			state.__unicodeOutbound.push(
				`${String(input instanceof Request ? input.url : input)} ${String(init?.body ?? '')}`,
			);
			return originalFetch(input, init);
		};
		const send = XMLHttpRequest.prototype.send;
		XMLHttpRequest.prototype.send = function (body) {
			state.__unicodeOutbound.push(String(body ?? ''));
			return send.call(this, body);
		};
		const beacon = navigator.sendBeacon.bind(navigator);
		navigator.sendBeacon = (url, data) => {
			state.__unicodeOutbound.push(`${url} ${String(data ?? '')}`);
			return beacon(url, data);
		};
		const Socket = window.WebSocket;
		window.WebSocket = class extends Socket {
			constructor(url: string | URL, protocols?: string | string[]) {
				super(url, protocols);
				state.__unicodeOutbound.push(String(url));
			}
			send(data: Parameters<WebSocket['send']>[0]) {
				state.__unicodeOutbound.push(String(data));
				super.send(data);
			}
		};

		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value:
				mode === 'unsupported'
					? undefined
					: mode === 'incomplete'
						? {}
						: {
								registerTool(tool: Tool, options?: { signal?: AbortSignal }) {
									if (mode === 'throw') throw Error('registration unavailable');
									state.__unicodeTools.push(tool);
									options?.signal?.addEventListener('abort', () => {
										state.__unicodeTools = state.__unicodeTools.filter(
											(t) => t !== tool,
										);
									});
									return Promise.resolve();
								},
							},
		});
		Object.defineProperty(navigator, 'modelContext', {
			configurable: true,
			value: undefined,
		});
	}, mode);
}
async function execute(page: Page, input: Record<string, unknown>) {
	return page.evaluate(async (input) => {
		const tool = (window as unknown as State).__unicodeTools.find(
			(t) => t.name === 'convert_unicode',
		);
		if (!tool) throw Error('convert_unicode未登録');
		return tool.execute(input);
	}, input);
}
async function names(page: Page) {
	return page.evaluate(() =>
		(window as unknown as State).__unicodeTools.map((t) => t.name),
	);
}
async function snapshot(page: Page) {
	return page.evaluate(() => ({
		values: Array.from(document.querySelectorAll('textarea')).map(
			(t) => t.value,
		),
		direction: document
			.querySelector('[role="switch"]')
			?.getAttribute('aria-checked'),
		local: { ...localStorage },
		session: { ...sessionStorage },
		url: location.href,
	}));
}

test.beforeEach(async ({ page, isMobile }) => {
	await page.setViewportSize(
		isMobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
	);
});

test('実ページ登録・両方向の固定結果/UI一致・MCP実行後の画面と保存状態不変', async ({
	page,
	createToolPage,
}) => {
	await install(page);
	const toolPage = createToolPage('unicode-converter');
	await toolPage.goto();
	await toolPage.expectSafetyBadge();
	await expect.poll(() => names(page)).toEqual(['convert_unicode']);
	for (const [action, input, expected] of [
		['encode', '日本語😀', String.raw`\u65e5\u672c\u8a9e\ud83d\ude00`],
		['encode', ' A\n日\\" ', ' A\n\\u65e5\\u005c" '],
		['encode', ' \t\n　', ''],
		['decode', String.raw`\u3042\u{1F600}`, 'あ😀'],
		['decode', String.raw`\uZZZZ\u12\n\t\x41`, String.raw`\uZZZZ\u12\n\t\x41`],
		['decode', String.raw`\\u3042`, '\\あ'],
		['decode', String.raw`\u005cu3042`, String.raw`\u3042`],
	] as const) {
		if (
			(await page.getByRole('switch').getAttribute('aria-checked')) !==
			String(action === 'decode')
		)
			await page.getByRole('switch').click();
		await page.locator('textarea:not([readonly])').fill(input);
		await expect(page.locator('textarea[readonly]')).toHaveValue(expected);
		const before = await snapshot(page);
		expect(await execute(page, { text: input, action })).toEqual({
			result: expected,
		});
		// A different MCP input must not overwrite the user's current text/result/direction.
		expect(await execute(page, { text: '別の入力', action: 'encode' })).toEqual(
			{ result: String.raw`\u5225\u306e\u5165\u529b` },
		);
		expect(await snapshot(page)).toEqual(before);
	}
});

test('実登録経路の境界・異常系とReactアンマウント解除/再登録', async ({
	page,
	createToolPage,
}) => {
	await install(page);
	await createToolPage('unicode-converter').goto();
	await expect.poll(() => names(page)).toEqual(['convert_unicode']);
	for (const action of ['encode', 'decode']) {
		const text = '😀'.repeat(20000);
		expect(await execute(page, { text, action })).toEqual({
			result:
				action === 'encode' ? String.raw`\ud83d\ude00`.repeat(20000) : text,
		});
		for (const text of ['😀'.repeat(20001), ' '.repeat(20001)]) {
			const result = await execute(page, { text, action });
			expect(result.isError).toBe(true);
			expect(result.error).toMatch(/上限/);
		}
	}
	for (const input of [
		{},
		{ text: 'a' },
		{ text: 1, action: 'encode' },
		{ text: 'a', action: 'invalid' },
	])
		expect((await execute(page, input)).isError).toBe(true);
	expect(
		await execute(page, {
			text: String.raw`PRIVATE_INPUT\u{110000}`,
			action: 'decode',
		}),
	).toEqual({
		isError: true,
		error: 'デコードに失敗しました。ユニコード形式が正しいか確認してください。',
	});
	await page
		.locator('astro-island[component-url*="UnicodeConverter"]')
		.evaluate((island) => island.dispatchEvent(new Event('astro:unmount')));
	await expect.poll(() => names(page)).toEqual([]);
	await page.reload();
	await expect.poll(() => names(page)).toEqual(['convert_unicode']);
});

test('MCP入力と結果は通信・console・storage・URLへ流れず、MCP由来の計測を追加しない', async ({
	page,
	createToolPage,
}) => {
	const requests: string[] = [];
	const messages: string[] = [];
	page.on('request', (r) => requests.push(`${r.url()} ${r.postData() ?? ''}`));
	page.on('console', (m) => messages.push(m.text()));
	page.on('pageerror', (e) => messages.push(e.message));
	await install(page);
	await createToolPage('unicode-converter').goto();
	await expect.poll(() => names(page)).toEqual(['convert_unicode']);
	const before = await snapshot(page);
	const marker = 'UNICODE_PRIVATE_593218';
	const offset = requests.length;
	expect(
		await execute(page, { text: `${marker}日本語😀`, action: 'encode' }),
	).toEqual({ result: `${marker}\\u65e5\\u672c\\u8a9e\\ud83d\\ude00` });
	expect(
		await execute(page, { text: `${marker}\\u3042`, action: 'decode' }),
	).toEqual({ result: `${marker}あ` });
	// Allow the existing analytics debounce interval to expire.
	await page.waitForTimeout(1500);
	expect(await snapshot(page)).toEqual(before);
	expect(requests.join('\n')).not.toContain(marker);
	expect(messages.join('\n')).not.toContain(marker);
	const outbound = await page.evaluate(
		() => (window as unknown as State).__unicodeOutbound,
	);
	for (const record of outbound) {
		expect(record).not.toContain(marker);
		expect(record).not.toContain(encodeURIComponent(marker));
	}
	expect(requests.slice(offset).join('\n')).not.toMatch(/tool_run|tool_engage/);
});

for (const mode of ['unsupported', 'incomplete', 'throw'] as const)
	test(`WebMCP ${mode}でも通常UIが動く`, async ({ page, createToolPage }) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await install(page, mode);
		await createToolPage('unicode-converter').goto();
		await page.locator('textarea:not([readonly])').fill('あ😀');
		await expect(page.locator('textarea[readonly]')).toHaveValue(
			String.raw`\u3042\ud83d\ude00`,
		);
		await page.getByRole('switch').click();
		await page
			.locator('textarea:not([readonly])')
			.fill(String.raw`\u3042\u{1F600}`);
		await expect(page.locator('textarea[readonly]')).toHaveValue('あ😀');
		expect(await names(page)).toEqual([]);
		expect(errors).toEqual([]);
	});
