import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/base';

type Tool = {
	name: string;
	execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
	inputSchema: { required: string[] };
};
type State = Window & { __diffTools: Tool[]; __diffOutbound: string[] };
async function install(page: Page) {
	await page.addInitScript(() => {
		const state = window as unknown as State;
		state.__diffTools = [];
		state.__diffOutbound = [];
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: {
				registerTool(tool: Tool, options?: { signal?: AbortSignal }) {
					state.__diffTools.push(tool);
					options?.signal?.addEventListener('abort', () => {
						state.__diffTools = state.__diffTools.filter((t) => t !== tool);
					});
					return Promise.resolve();
				},
			},
		});
		const original = window.fetch.bind(window);
		window.fetch = (input, init) => {
			state.__diffOutbound.push(
				`${String(input instanceof Request ? input.url : input)} ${String(init?.body ?? '')}`,
			);
			return original(input, init);
		};
		const send = XMLHttpRequest.prototype.send;
		XMLHttpRequest.prototype.send = function (body) {
			state.__diffOutbound.push(String(body ?? ''));
			return send.call(this, body);
		};
		const beacon = navigator.sendBeacon.bind(navigator);
		navigator.sendBeacon = (url, data) => {
			state.__diffOutbound.push(`${url} ${String(data ?? '')}`);
			return beacon(url, data);
		};
		const Socket = window.WebSocket;
		window.WebSocket = class extends Socket {
			constructor(url: string | URL, protocols?: string | string[]) {
				super(url, protocols);
				state.__diffOutbound.push(String(url));
			}
			send(data: Parameters<WebSocket['send']>[0]) {
				state.__diffOutbound.push(String(data));
				super.send(data);
			}
		};
	});
}
async function execute(page: Page, input: Record<string, unknown>) {
	return page.evaluate(async (input) => {
		const tool = (window as unknown as State).__diffTools.find(
			(t) => t.name === 'compare_text',
		);
		if (!tool) throw Error('compare_text未登録');
		return tool.execute(input);
	}, input);
}
async function snapshot(page: Page) {
	return page.evaluate(() => ({
		values: Array.from(document.querySelectorAll('textarea')).map(
			(t) => t.value,
		),
		tabs: Array.from(document.querySelectorAll('[role="tab"]')).map((t) => [
			t.textContent,
			t.getAttribute('aria-selected'),
		]),
		local: { ...localStorage },
		session: { ...sessionStorage },
		url: location.href,
	}));
}

test('実ページ登録→実Workerで両モード実行、UI統計/断片一致・状態不変', async ({
	page,
	createToolPage,
}) => {
	await install(page);
	const toolPage = createToolPage('text-diff');
	await toolPage.goto();
	await toolPage.expectSafetyBadge();
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as State).__diffTools.map((t) => t.name),
			),
		)
		.toContain('compare_text');
	for (const [mode, label] of [
		['lines', '行単位'],
		['chars', '文字単位'],
	] as const) {
		await page.locator('#text-diff-textarea-a').fill('日本語\n旧文😀');
		await page.locator('#text-diff-textarea-b').fill('日本語\n新文😺');
		await page.getByRole('tab', { name: label, exact: true }).click();
		await expect(page.getByText('差分統計:', { exact: true })).toBeVisible();
		const before = await snapshot(page);
		const result = await execute(page, {
			textA: '日本語\n旧文😀',
			textB: '日本語\n新文😺',
			mode,
		});
		expect(result.isError).toBeUndefined();
		expect(result.mode).toBe(mode);
		expect(result.hasChanges).toBe(true);
		await expect(
			page.getByText(
				`追加: ${result.addedLines}行 (${result.addedChars}文字)`,
				{ exact: true },
			),
		).toBeVisible();
		await expect(
			page.getByText(
				`削除: ${result.removedLines}行 (${result.removedChars}文字)`,
				{ exact: true },
			),
		).toBeVisible();
		const expectedRows = (
			result.parts as Array<{ value: string; type: string }>
		).flatMap((part) => {
			const lines = part.value.split('\n');
			if (part.value.endsWith('\n')) lines.pop();
			return lines.map((content) => ({ content, type: part.type }));
		});
		const rows = await page
			.getByRole('region', { name: 'ツール操作エリア' })
			.locator('span.flex-1')
			.evaluateAll((spans) =>
				spans.map((span) => ({
					content: Array.from(span.childNodes)
						.filter((node) => node.nodeType === Node.TEXT_NODE)
						.map((node) => node.textContent)
						.join(''),
					type:
						span.querySelector('span')?.textContent?.trim() === '+'
							? 'added'
							: span.querySelector('span')?.textContent?.trim() === '-'
								? 'removed'
								: 'unchanged',
				})),
			);
		expect(rows).toEqual(expectedRows);
		expect(await snapshot(page)).toEqual(before);
		const other = await execute(page, {
			textA: 'abc',
			textB: 'axc',
			mode: 'chars',
		});
		expect(other.parts).toEqual([
			{ value: 'a', type: 'unchanged' },
			{ value: 'b', type: 'removed' },
			{ value: 'x', type: 'added' },
			{ value: 'c', type: 'unchanged' },
		]);
		expect(await snapshot(page)).toEqual(before);
	}
});

test('空・末尾LF・Unicode境界・編集距離中止・解放後再実行', async ({
	page,
	createToolPage,
}) => {
	await install(page);
	await createToolPage('text-diff').goto();
	expect(await execute(page, { textA: '', textB: '' })).toMatchObject({
		hasChanges: false,
		parts: [],
		addedLines: 0,
		removedLines: 0,
	});
	expect(await execute(page, { textA: 'a', textB: 'a\n' })).toMatchObject({
		hasChanges: false,
		parts: [{ value: 'a\n', type: 'unchanged' }],
	});
	expect(
		await execute(page, { textA: 'a', textB: 'a\n', mode: 'chars' }),
	).toMatchObject({ hasChanges: true, addedLines: 1, addedChars: 1 });
	expect(
		(
			await execute(page, {
				textA: '😀'.repeat(20000),
				textB: '😀'.repeat(20000),
			})
		).isError,
	).toBeUndefined();
	for (const input of [
		{ textA: 'x'.repeat(20001), textB: '' },
		{ textA: '', textB: null },
		{ textA: '', textB: '', mode: 'words' },
		{ textA: 'a'.repeat(501), textB: 'b'.repeat(501), mode: 'chars' },
	])
		expect((await execute(page, input)).isError).toBe(true);
	expect(await execute(page, { textA: '', textB: '追加' })).toMatchObject({
		hasChanges: true,
		addedLines: 1,
	});
});

test('Worker期限・同時制限・解放（故障注入、実Worker成功は別test）', async ({
	page,
	createToolPage,
}) => {
	await install(page);
	await page.addInitScript(() => {
		const RealWorker = window.Worker;
		let calls = 0;
		window.Worker = class extends RealWorker {
			postMessage(
				message: unknown,
				transfer: Transferable[] | StructuredSerializeOptions = [],
			) {
				calls++;
				if (calls > 1) {
					if (Array.isArray(transfer)) super.postMessage(message, transfer);
					else super.postMessage(message, transfer);
				}
			}
		};
	});
	await createToolPage('text-diff').goto();
	const result = await page.evaluate(async () => {
		const tool = (window as unknown as State).__diffTools.find(
			(t) => t.name === 'compare_text',
		);
		if (!tool) throw Error('未登録');
		const first = tool.execute({ textA: 'a', textB: 'b' });
		const busy = await tool.execute({ textA: 'a', textB: 'b' });
		const expired = await first;
		const recovered = await tool.execute({ textA: 'a', textB: 'b' });
		return { busy, expired, recovered };
	});
	expect(result.busy).toMatchObject({ isError: true });
	expect(String(result.busy.error)).toContain('実行中');
	expect(result.expired).toMatchObject({ isError: true });
	expect(String(result.expired.error)).toContain('2秒');
	expect(result.recovered.isError).toBeUndefined();
	expect(result.recovered.hasChanges).toBe(true);
});

test('入力の通信/ログ/保存なし。実CSPを適用してWorkerを配信', async ({
	page,
	createToolPage,
}) => {
	const policy = fs
		.readFileSync(path.resolve('public/_headers'), 'utf8')
		.split('\n')
		.find((line) => line.trim().startsWith('Content-Security-Policy:'))
		?.trim()
		.slice('Content-Security-Policy:'.length)
		.trim();
	if (!policy) throw Error('実CSPなし');
	await page.route('**/text-diff/', async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: { ...response.headers(), 'content-security-policy': policy },
		});
	});
	await install(page);
	await createToolPage('text-diff').goto();
	const marker = '差分確認用の非公開ダミー';
	const logs: string[] = [],
		requests: string[] = [];
	page.on('console', (message) => logs.push(message.text()));
	page.on('pageerror', (error) => logs.push(error.message));
	page.on('request', (request) =>
		requests.push(`${request.url()} ${request.postData() ?? ''}`),
	);
	const before = await snapshot(page);
	expect(
		(
			await execute(page, {
				textA: marker,
				textB: `${marker}変更`,
				mode: 'chars',
			})
		).isError,
	).toBeUndefined();
	expect(await snapshot(page)).toEqual(before);
	const outbound = await page.evaluate(
		() => (window as unknown as State).__diffOutbound,
	);
	for (const record of [...logs, ...requests, ...outbound]) {
		expect(record).not.toContain(marker);
		expect(record).not.toContain(encodeURIComponent(marker));
	}
});

for (const missing of ['absent', 'partial'] as const)
	test(`WebMCP ${missing}でも通常画面は利用可能`, async ({
		page,
		createToolPage,
	}) => {
		if (missing === 'partial')
			await page.addInitScript(() =>
				Object.defineProperty(document, 'modelContext', {
					value: { registerTool: null },
					configurable: true,
				}),
			);
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await createToolPage('text-diff').goto();
		await page.locator('#text-diff-textarea-a').fill('a');
		await page.locator('#text-diff-textarea-b').fill('b');
		await expect(page.getByText('差分統計:', { exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});
