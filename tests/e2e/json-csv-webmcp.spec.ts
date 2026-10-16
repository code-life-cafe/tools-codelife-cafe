import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/base';

type RegisteredTool = {
	name: string;
	inputSchema: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	annotations?: Record<string, unknown>;
	execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
type McpWindow = Window & {
	__jsonCsvTools: RegisteredTool[];
	__outbound: string[];
};

const SECRET = 'canary marker row text';

// ページスクリプトより先に document.modelContext を差し替え、登録された実ツールを捕捉する。
// 通信は共通fixtureの遮断に頼らず、ページ内のAPI呼び出しを直接記録して入力が出ないことを確認する。
async function installProbes(page: Page) {
	await page.addInitScript(() => {
		const state = window as unknown as McpWindow;
		state.__jsonCsvTools = [];
		state.__outbound = [];
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: {
				registerTool(tool: RegisteredTool) {
					state.__jsonCsvTools.push(tool);
					return Promise.resolve();
				},
			},
		});
		const record = (kind: string, url: unknown, body: unknown) =>
			state.__outbound.push(`${kind} ${String(url)} ${String(body ?? '')}`);
		const originalFetch = window.fetch.bind(window);
		window.fetch = (input, init) => {
			record('fetch', input instanceof Request ? input.url : input, init?.body);
			return originalFetch(input, init);
		};
		const originalSend = XMLHttpRequest.prototype.send;
		XMLHttpRequest.prototype.send = function (body) {
			record('xhr', '', body);
			return originalSend.call(this, body);
		};
		const originalBeacon = navigator.sendBeacon?.bind(navigator);
		navigator.sendBeacon = (url, data) => {
			record('beacon', url, data);
			return originalBeacon ? originalBeacon(url, data) : false;
		};
		const OriginalWebSocket = window.WebSocket;
		window.WebSocket = class extends OriginalWebSocket {
			constructor(url: string | URL, protocols?: string | string[]) {
				super(url, protocols);
				record('websocket', url, '');
			}
			send(data: Parameters<WebSocket['send']>[0]) {
				record('websocket-send', '', data);
				super.send(data);
			}
		};
	});
}

// UI入力に伴う既存の匿名計測（セッションID生成）が確定してから基準スナップショットを取る。
// MCP実行による変化と区別するため、計測のデバウンス完了を待つ。
async function settleUiAnalytics(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(() => sessionStorage.getItem('clc_analytics_session_id')),
		)
		.not.toBeNull();
}

async function waitForTools(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(
				() => (window as unknown as McpWindow).__jsonCsvTools.length,
			),
		)
		.toBe(2);
}

async function execute(
	page: Page,
	name: string,
	input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	return page.evaluate(
		async ({ name, input }) => {
			const tool = (window as unknown as McpWindow).__jsonCsvTools.find(
				(entry) => entry.name === name,
			);
			if (!tool) throw new Error('登録されていません');
			return tool.execute(input);
		},
		{ name, input },
	);
}

// UI状態（入力・出力・選択タブ・スイッチ・セレクト・エラー表示）と永続領域の一括スナップショット
async function snapshot(page: Page) {
	return page.evaluate(async () => {
		const read = (storage: Storage) =>
			Object.fromEntries(
				Array.from({ length: storage.length }, (_, i) => {
					const key = storage.key(i) as string;
					return [key, storage.getItem(key)];
				}),
			);
		const textareas = Array.from(document.querySelectorAll('textarea')).map(
			(el) => `${el.getAttribute('aria-label')}=${el.value}`,
		);
		const switches = Array.from(
			document.querySelectorAll('[role="switch"]'),
		).map((el) => `${el.id}=${el.getAttribute('aria-checked')}`);
		const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map(
			(el) => `${el.textContent}=${el.getAttribute('aria-selected')}`,
		);
		const selects = Array.from(
			document.querySelectorAll('[role="combobox"]'),
		).map((el) => `${el.getAttribute('aria-label')}=${el.textContent}`);
		return {
			textareas,
			switches,
			tabs,
			selects,
			errorShown: document.querySelector('[data-testid="json-csv-error"]')
				? document.querySelector('[data-testid="json-csv-error"]')?.textContent
				: null,
			badge: document.body.innerText.match(/\d+行を変換しました/)?.[0] ?? null,
			href: location.href,
			local: read(localStorage),
			session: read(sessionStorage),
			cookie: document.cookie,
			databases: (await indexedDB.databases?.()) ?? [],
			caches: await caches.keys(),
		};
	});
}

test.describe('JSON↔CSV WebMCP', () => {
	test('実ページ登録: 2ツールのschemaが生成manifestと一致する', async ({
		page,
	}) => {
		await installProbes(page);
		await page.goto('/json-csv');
		await waitForTools(page);
		const registered = await page.evaluate(() =>
			(window as unknown as McpWindow).__jsonCsvTools.map((tool) => ({
				name: tool.name,
				inputSchema: tool.inputSchema,
				outputSchema: tool.outputSchema,
				annotations: tool.annotations,
			})),
		);
		expect(registered.map((tool) => tool.name).sort()).toEqual([
			'csv_to_json',
			'json_to_csv',
		]);
		const manifest = JSON.parse(
			fs.readFileSync(
				path.join(
					process.cwd(),
					'public/.well-known/webmcp/tools.generated.json',
				),
				'utf-8',
			),
		) as { tools: Record<string, unknown>[] };
		for (const tool of registered) {
			const entry = manifest.tools.find((item) => item.name === tool.name);
			expect(entry?.toolId).toBe('json-csv');
			expect(entry?.inputSchema).toEqual(tool.inputSchema);
			expect(entry?.outputSchema).toEqual(tool.outputSchema);
			expect(tool.annotations).toMatchObject({ readOnlyHint: true });
		}
		const input = registered.find((tool) => tool.name === 'json_to_csv')
			?.inputSchema as { properties: Record<string, { enum?: string[] }> };
		expect(input.properties.delimiter.enum).toEqual([
			'comma',
			'tab',
			'semicolon',
		]);
	});

	test('json_to_csv: 引数付き実行がUIの同設定結果と一致しUI状態を変えない', async ({
		page,
	}) => {
		await installProbes(page);
		await page.goto('/json-csv');
		await waitForTools(page);

		const jsonText =
			'[{"name":"山田","note":"a,\\"b\\"\\nc","id":9007199254740993,"tags":["x","y"]}]';
		await page.getByLabel('JSON入力').fill(jsonText);
		// UI既定（カンマ・ヘッダーあり・ネスト展開・CRLF）の結果
		await expect(page.getByLabel('CSV出力')).toHaveValue(/9007199254740993/);
		const uiCsv = await page.getByLabel('CSV出力').inputValue();
		await settleUiAnalytics(page);
		const before = await snapshot(page);

		// 画面と同じ設定をMCPへ明示して実行
		const same = await execute(page, 'json_to_csv', {
			text: jsonText,
			delimiter: 'comma',
			includeHeader: true,
			flattenNested: true,
			newline: 'crlf',
		});
		expect(same.isError).toBeUndefined();
		expect(String(same.output).replace(/\r\n/g, '\n')).toBe(uiCsv);
		expect(same.rowCount).toBe(1);

		// 画面とは異なる設定・別入力での実行（独立実行の確認）
		const other = await execute(page, 'json_to_csv', {
			text: '[{"a":1,"b":{"c":2}}]',
			delimiter: 'tab',
			includeHeader: false,
			flattenNested: false,
			newline: 'lf',
		});
		expect(other).toEqual({ output: '1\t"{""c"":2}"', rowCount: 1 });
		const defaults = await execute(page, 'json_to_csv', {
			text: '[{"a":{"b":1}}]',
		});
		expect(defaults.output).toBe('a\r\n"{""b"":1}"');

		expect(await snapshot(page)).toEqual(before);

		// 画面の設定を同じ値に変えると、UI結果とMCP結果が再び一致する
		await page
			.getByRole('switch', { name: 'ネストを展開（ドット記法）' })
			.click();
		await page.getByRole('switch', { name: 'ヘッダー行を含める' }).click();
		const raw = await execute(page, 'json_to_csv', {
			text: jsonText,
			includeHeader: false,
			flattenNested: false,
		});
		// UIの再変換はdebounceされるため、自動リトライするアサーションで一致を待つ
		await expect(page.getByLabel('CSV出力')).toHaveValue(
			String(raw.output).replace(/\r\n/g, '\n'),
		);
	});

	test('csv_to_json: 引数付き実行がUIの同設定結果と一致しUI状態を変えない', async ({
		page,
	}) => {
		await installProbes(page);
		await page.goto('/json-csv');
		await waitForTools(page);

		await page.getByRole('tab', { name: 'CSV → JSON' }).click();
		const csvText =
			'﻿id,zip,u.n,t.0,memo\r\n9007199254740993,007,太郎,a,"l1\nl2"\r\n2,0,花子,b,x';
		await page.getByLabel('CSV入力').fill(csvText);
		// UI既定（自動判定・ヘッダーあり・型推論ON・展開OFF）の結果
		await expect(page.getByLabel('JSON出力')).toHaveValue(/"zip": "007"/);
		const uiJson = await page.getByLabel('JSON出力').inputValue();
		await settleUiAnalytics(page);
		const before = await snapshot(page);

		const same = await execute(page, 'csv_to_json', {
			text: csvText,
			delimiter: 'auto',
			hasHeader: true,
			inferTypes: true,
			unflattenDotKeys: false,
		});
		expect(same.isError).toBeUndefined();
		expect(String(same.output).replace(/\r\n/g, '\n')).toBe(
			uiJson.replace(/\r\n/g, '\n'),
		);
		expect(same.rowCount).toBe(2);
		const rows = JSON.parse(String(same.output));
		expect(rows[0].id).toBe('9007199254740993');
		expect(rows[0].zip).toBe('007');
		expect(rows[1].zip).toBe(0);

		// 既定値（型推論なし）は全て文字列、UIとは異なる設定でも画面は変わらない
		const defaults = await execute(page, 'csv_to_json', { text: csvText });
		expect(JSON.parse(String(defaults.output))[1].zip).toBe('0');
		const nested = await execute(page, 'csv_to_json', {
			text: csvText,
			unflattenDotKeys: true,
			hasHeader: true,
		});
		expect(JSON.parse(String(nested.output))[0].u).toEqual({ n: '太郎' });

		expect(await snapshot(page)).toEqual(before);

		// UIの設定をMCP既定に合わせると結果が一致する
		await page.getByRole('switch', { name: '型推論' }).click();
		await expect(page.getByLabel('JSON出力')).toHaveValue(/"zip": "0"/);
		const uiStrings = await page.getByLabel('JSON出力').inputValue();
		expect(String(defaults.output).replace(/\r\n/g, '\n')).toBe(
			uiStrings.replace(/\r\n/g, '\n'),
		);
	});

	test('異常系: 型/enum/上限/深さ/不正入力は isError で返り、原文を含まない', async ({
		page,
	}) => {
		await installProbes(page);
		await page.goto('/json-csv');
		await waitForTools(page);

		const bad = await execute(page, 'json_to_csv', {
			text: '[{"a":1}]',
			delimiter: 'pipe',
		});
		expect(bad.isError).toBe(true);
		expect((await execute(page, 'json_to_csv', { text: 1 })).isError).toBe(
			true,
		);
		expect((await execute(page, 'csv_to_json', {})).isError).toBe(true);
		expect(
			(await execute(page, 'csv_to_json', { text: 'a\n1', hasHeader: 'yes' }))
				.isError,
		).toBe(true);

		const syntax = await execute(page, 'json_to_csv', {
			text: `{"k":"${SECRET}"`,
		});
		expect(syntax.isError).toBe(true);
		expect(String(syntax.error)).toContain('JSONの構文エラー');
		expect(String(syntax.error)).not.toContain(SECRET);

		const unclosed = await execute(page, 'csv_to_json', {
			text: `a,b\n"${SECRET},2`,
		});
		expect(unclosed.isError).toBe(true);
		expect(String(unclosed.error)).not.toContain(SECRET);

		const tooLong = await execute(page, 'json_to_csv', {
			text: `[{"a":"${'あ'.repeat(100_000)}"}]`,
		});
		expect(tooLong.isError).toBe(true);
		const atLimit = await execute(page, 'csv_to_json', {
			text: `a\n${'😀'.repeat(99_998)}`,
		});
		expect(atLimit.isError).toBeUndefined();
		expect(atLimit.rowCount).toBe(1);

		const deep = await execute(page, 'json_to_csv', {
			text: `${'['.repeat(51)}${']'.repeat(51)}`,
		});
		expect(deep.isError).toBe(true);
		expect(String(deep.error)).toContain('50段');
		const deepKey = Array.from({ length: 51 }, () => 'k').join('.');
		const deepCsv = await execute(page, 'csv_to_json', {
			text: `${deepKey}\n1`,
			unflattenDotKeys: true,
		});
		expect(deepCsv.isError).toBe(true);
		expect(String(deepCsv.error)).toContain('50段');
	});

	test('入力・結果が通信・ログ・永続化に出ない（fixture遮断に依存しない）', async ({
		page,
	}) => {
		const requests: string[] = [];
		const logs: string[] = [];
		const sockets: string[] = [];
		page.on('request', (req) =>
			requests.push(`${req.method()} ${req.url()} ${req.postData() ?? ''}`),
		);
		page.on('console', (msg) => logs.push(msg.text()));
		page.on('pageerror', (error) => logs.push(error.message));
		page.on('websocket', (socket) => sockets.push(socket.url()));
		await installProbes(page);
		await page.goto('/json-csv');
		await waitForTools(page);
		const before = await snapshot(page);
		const requestCountBefore = requests.length;

		const csv = await execute(page, 'json_to_csv', {
			text: `[{"secret":"${SECRET}","nested":{"v":"${SECRET}-2"}}]`,
			flattenNested: true,
		});
		const json = await execute(page, 'csv_to_json', {
			text: `a,b\n${SECRET},${SECRET}-3`,
			unflattenDotKeys: true,
		});
		await execute(page, 'json_to_csv', { text: `{"x":"${SECRET}"` });
		expect(String(csv.output)).toContain(SECRET);
		expect(String(json.output)).toContain(SECRET);
		// 計測が非同期に飛ぶ余地を与えてから確認する
		await page.waitForTimeout(1500);

		expect(requests.slice(requestCountBefore).join('\n')).not.toContain(SECRET);
		expect(requests.join('\n')).not.toContain(encodeURIComponent(SECRET));
		expect(logs.join('\n')).not.toContain(SECRET);
		expect(sockets).toEqual([]);
		const outbound = await page.evaluate(
			() => (window as unknown as McpWindow).__outbound,
		);
		expect(outbound.join('\n')).not.toContain(SECRET);
		const after = await snapshot(page);
		expect(after).toEqual(before);
		expect(JSON.stringify(after)).not.toContain(SECRET);
		expect(after.href).not.toContain(SECRET);
	});
});
