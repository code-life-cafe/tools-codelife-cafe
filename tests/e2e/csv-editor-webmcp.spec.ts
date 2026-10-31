import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/base';

type Tool = {
	name: string;
	execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
type State = Window & { __csvTools: Tool[]; __csvOutbound: string[] };
async function install(
	page: Page,
	mode: 'normal' | 'unsupported' | 'incomplete' | 'throw' | 'legacy' = 'normal',
) {
	await page.addInitScript((mode) => {
		const state = window as unknown as State;
		state.__csvTools = [];
		state.__csvOutbound = [];
		const originalFetch = window.fetch.bind(window);
		window.fetch = (input, init) => {
			state.__csvOutbound.push(
				`${String(input instanceof Request ? input.url : input)} ${String(init?.body ?? '')}`,
			);
			return originalFetch(input, init);
		};
		const send = XMLHttpRequest.prototype.send;
		XMLHttpRequest.prototype.send = function (body) {
			state.__csvOutbound.push(String(body ?? ''));
			return send.call(this, body);
		};
		const beacon = navigator.sendBeacon.bind(navigator);
		navigator.sendBeacon = (url, data) => {
			state.__csvOutbound.push(`${url} ${String(data ?? '')}`);
			return beacon(url, data);
		};
		const Socket = window.WebSocket;
		window.WebSocket = class extends Socket {
			constructor(url: string | URL, protocols?: string | string[]) {
				super(url, protocols);
				state.__csvOutbound.push(String(url));
			}
			send(data: Parameters<WebSocket['send']>[0]) {
				state.__csvOutbound.push(String(data));
				super.send(data);
			}
		};

		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value:
				mode === 'unsupported' || mode === 'legacy'
					? undefined
					: mode === 'incomplete'
						? {}
						: {
								registerTool(tool: Tool, options?: { signal?: AbortSignal }) {
									if (mode === 'throw') throw Error('registration unavailable');
									state.__csvTools.push(tool);
									options?.signal?.addEventListener('abort', () => {
										state.__csvTools = state.__csvTools.filter(
											(t) => t !== tool,
										);
									});
									return Promise.resolve();
								},
							},
		});
		Object.defineProperty(navigator, 'modelContext', {
			configurable: true,
			value:
				mode === 'legacy'
					? {
							provideContext({ tools }: { tools: Tool[] }) {
								state.__csvTools = tools;
								return {
									dispose() {
										state.__csvTools = [];
									},
								};
							},
						}
					: undefined,
		});
	}, mode);
}
async function execute(page: Page, input: Record<string, unknown>) {
	return page.evaluate(async (input) => {
		const tool = (window as unknown as State).__csvTools.find(
			(t) => t.name === 'query_csv',
		);
		if (!tool) throw Error('query_csv未登録');
		return tool.execute(input);
	}, input);
}
async function names(page: Page) {
	return page.evaluate(() =>
		(window as unknown as State).__csvTools.map((t) => t.name),
	);
}
async function snapshot(page: Page) {
	return page.evaluate(() => ({
		values: Array.from(document.querySelectorAll('textarea')).map(
			(t) => t.value,
		),
		fields: Array.from(document.querySelectorAll('input')).map((e) => [
			e.type,
			e.value,
			e.checked,
		]),
		tabs: Array.from(document.querySelectorAll('[role="tab"]')).map((e) => [
			e.textContent,
			e.getAttribute('aria-selected'),
		]),
		combos: Array.from(document.querySelectorAll('[role="combobox"]')).map(
			(e) => e.textContent,
		),
		undoDisabled: document
			.querySelector('button[title="元に戻す (Undo)"]')
			?.getAttribute('disabled'),
		table: Array.from(document.querySelectorAll('table tbody tr')).map((r) =>
			Array.from(r.querySelectorAll('input')).map((e) => e.value),
		),
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

for (const mode of ['normal', 'legacy'] as const)
	test(`${mode}: 実登録・文字/数値UI一致・編集/Undo状態不変・解除再登録`, async ({
		page,
		createToolPage,
	}) => {
		await install(page, mode);
		await createToolPage('csv-editor').goto();
		await expect.poll(() => names(page)).toEqual(['query_csv']);
		for (const kind of ['text', 'number'] as const) {
			// Clear the existing table/conditions by reloading before the next case.
			if (kind === 'number') {
				await page.reload();
				await expect.poll(() => names(page)).toEqual(['query_csv']);
			}
			const text =
				kind === 'text'
					? '品名,価格\nりんご,100\nみかん,80\nバナナ,120\nぶどう,200'
					: '価格,品名\n120,りんご\n80,みかん\n100,バナナ';
			await page.locator('textarea').fill(text);
			await page.getByRole('button', { name: 'パースして編集へ' }).click();
			await page.getByRole('tab', { name: /絞込・ソート/ }).click();
			await page.getByRole('button', { name: /条件を追加/ }).click();
			await page
				.locator('input[placeholder="値"]')
				.fill(kind === 'text' ? 'ん' : '100');
			await page.getByRole('tab', { name: /テーブル/ }).click();
			await page
				.getByRole('columnheader')
				.filter({ hasText: kind === 'text' ? '価格' : '価格' })
				.click();
			const ui = await page
				.locator('table tbody tr')
				.evaluateAll((rows) =>
					rows.map((row) =>
						Array.from(row.querySelectorAll('input[type="text"]')).map(
							(e) => (e as HTMLInputElement).value,
						),
					),
				);
			const before = await snapshot(page);
			const result = await execute(page, {
				text,
				hasHeader: true,
				filterColumn: 'A',
				filterOperator: kind === 'text' ? 'contains' : 'gte',
				filterCompare: kind,
				filterValue: kind === 'text' ? 'ん' : '100',
				sortColumn: kind === 'text' ? 'B' : 'A',
				sortCompare: 'number',
			});
			expect(result).toEqual(
				kind === 'text'
					? {
							result: '品名,価格\r\nみかん,80\r\nりんご,100',
							inputRows: 4,
							outputRows: 2,
							columns: 2,
						}
					: {
							result: '価格,品名\r\n100,バナナ\r\n120,りんご',
							inputRows: 3,
							outputRows: 2,
							columns: 2,
						},
			);
			expect(ui).toEqual(
				kind === 'text'
					? [
							['みかん', '80'],
							['りんご', '100'],
						]
					: [
							['100', 'バナナ'],
							['120', 'りんご'],
						],
			);
			expect(await snapshot(page)).toEqual(before);
			expect(
				await execute(page, { text: '別入力\n001', hasHeader: true }),
			).toEqual({
				result: '別入力\r\n001',
				inputRows: 1,
				outputRows: 1,
				columns: 1,
			});
			expect(await snapshot(page)).toEqual(before);
			// Confirm MCP did not change the undo history by performing a real edit/undo.
			const first = page.locator('table tbody input[type="text"]').first();
			const original = await first.inputValue();
			await first.fill('編集');
			const edited = await snapshot(page);
			await execute(page, { text: 'MCP,DATA', hasHeader: false });
			expect(await snapshot(page)).toEqual(edited);
			await page.getByTitle('元に戻す (Undo)', { exact: true }).click();
			await expect(first).toHaveValue(original);
		}
		await page
			.locator('astro-island[component-url*="CsvEditor"]')
			.evaluate((el) => el.dispatchEvent(new Event('astro:unmount')));
		await expect.poll(() => names(page)).toEqual([]);
		await page.reload();
		await expect.poll(() => names(page)).toEqual(['query_csv']);
	});

test('TSV・型明示・厳密構文・複数エラー優先順位・境界を実登録経路で検証', async ({
	page,
	createToolPage,
}) => {
	await install(page);
	await createToolPage('csv-editor').goto();
	await expect.poll(() => names(page)).toEqual(['query_csv']);
	expect(
		await execute(page, {
			text: 'ID\t値\n001\t2\n010\t1',
			format: 'tsv',
			hasHeader: true,
			sortColumn: 'B',
			sortCompare: 'number',
		}),
	).toEqual({
		result: 'ID\t値\r\n010\t1\r\n001\t2',
		inputRows: 2,
		outputRows: 2,
		columns: 2,
	});
	expect(
		await execute(page, {
			text: '001\n1',
			hasHeader: false,
			filterColumn: 'A',
			filterOperator: 'eq',
			filterValue: '001',
		}),
	).toMatchObject({ result: '001', outputRows: 1 });
	// 自動型推定の修正で、明示numberの既存WebMCP契約を変更しない。
	expect(
		await execute(page, {
			text: '1e2\n0x10\n0b101\n0o17\n1e-3',
			hasHeader: false,
			filterColumn: 'A',
			filterOperator: 'gte',
			filterCompare: 'number',
			filterValue: '0b101',
			sortColumn: 'A',
			sortCompare: 'number',
		}),
	).toMatchObject({ result: '0b101\r\n0o17\r\n0x10\r\n1e2', outputRows: 4 });
	for (const value of ['１２３．５', '－５'])
		expect(
			(
				await execute(page, {
					text: value,
					hasHeader: false,
					sortColumn: 'A',
					sortCompare: 'number',
				})
			).isError,
		).toBe(true);
	expect(
		(await execute(page, { text: '😀'.repeat(100000), hasHeader: false }))
			.result,
	).toBe('😀'.repeat(100000));
	for (const text of ['😀'.repeat(100001), Array(1001).fill('x').join('\n')])
		expect((await execute(page, { text, hasHeader: false })).isError).toBe(
			true,
		);
	expect(
		await execute(page, {
			text: 'a,b\n"PRIVATE',
			hasHeader: false,
			sortColumn: 'AX',
		}),
	).toEqual({
		isError: true,
		error: 'CSVの形式が正しくありません。引用符や区切りを確認してください。',
	});
	for (const input of [
		{ text: 'a' },
		{ text: 'a', hasHeader: false, filterColumn: 'A' },
		{
			text: 'Infinity',
			hasHeader: false,
			sortColumn: 'A',
			sortCompare: 'number',
		},
		{ text: 'a', hasHeader: false, sortColumn: 'AY' },
	])
		expect((await execute(page, input)).isError).toBe(true);
});

test('本文/結果/条件の通信・保存・consoleなし、MCP由来計測なし', async ({
	page,
	createToolPage,
}) => {
	const requests: string[] = [],
		logs: string[] = [];
	page.on('request', (r) => requests.push(`${r.url()} ${r.postData() ?? ''}`));
	page.on('console', (m) => logs.push(m.text()));
	page.on('pageerror', (e) => logs.push(e.message));
	await install(page);
	await createToolPage('csv-editor').goto();
	await expect.poll(() => names(page)).toEqual(['query_csv']);
	const before = await snapshot(page);
	const offset = requests.length;
	const marker = 'CSV_PRIVATE_MARKER_72641';
	const condition = 'FILTER_PRIVATE_824';
	expect(
		await execute(page, {
			text: `${marker},${condition}\n=1+1,<img src=x>`,
			hasHeader: false,
			filterColumn: 'B',
			filterOperator: 'eq',
			filterValue: condition,
		}),
	).toMatchObject({ result: `${marker},${condition}` });
	await page.waitForTimeout(1500);
	expect(await snapshot(page)).toEqual(before);
	const outbound = await page.evaluate(
		() => (window as unknown as State).__csvOutbound,
	);
	for (const line of [...requests, ...logs, ...outbound])
		for (const secret of [marker, condition]) {
			expect(line).not.toContain(secret);
			expect(line).not.toContain(encodeURIComponent(secret));
		}
	expect(requests.slice(offset).join('\n')).not.toMatch(/tool_run|tool_engage/);
});
for (const mode of ['unsupported', 'incomplete', 'throw'] as const)
	test(`${mode}: 通常CSV編集は利用可能`, async ({ page, createToolPage }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await install(page, mode);
		await createToolPage('csv-editor').goto();
		await page.locator('textarea').fill('品名,価格\nりんご,100');
		await page.getByRole('button', { name: 'パースして編集へ' }).click();
		await expect(
			page.locator('table tbody input[type="text"]').first(),
		).toHaveValue('りんご');
		expect(await names(page)).toEqual([]);
		expect(errors).toEqual([]);
	});
