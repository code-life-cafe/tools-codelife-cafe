import { expect, test } from './fixtures/base';

type RegisteredTool = {
	name: string;
	execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
type MockWindow = Window & { __top3Tools: RegisteredTool[] };
const cases = [
	{
		path: 'mermaid',
		name: 'repair_mermaid_code',
		input: { text: '```mermaid\nflowchart TD\nA((開始)) → B[[処理]]\n```' },
		key: 'code',
		expected: 'A((開始)) --> B[[処理]]',
	},
	{
		path: 'yaml-json-toml',
		name: 'convert_yaml_json_toml',
		input: { text: 'name: sample', from: 'yaml', to: 'json' },
		key: 'output',
		expected: '"name": "sample"',
	},
	{
		path: 'masking',
		name: 'mask_personal_information',
		input: { text: 'alice@example.com' },
		key: 'maskedText',
		expected: '*****************',
	},
];
for (const mode of ['document', 'navigator'] as const) {
	for (const item of cases) {
		test(`${item.path}: ${mode}登録・実行・入力検証・データ非送信`, async ({
			page,
		}) => {
			await page.addInitScript((api) => {
				const state = window as unknown as MockWindow;
				state.__top3Tools = [];
				Object.defineProperty(document, 'modelContext', {
					configurable: true,
					value: undefined,
				});
				Object.defineProperty(navigator, 'modelContext', {
					configurable: true,
					value: undefined,
				});
				const value =
					api === 'document'
						? {
								registerTool(tool: RegisteredTool) {
									state.__top3Tools.push(tool);
									return Promise.resolve();
								},
							}
						: {
								provideContext(context: { tools: RegisteredTool[] }) {
									state.__top3Tools.push(...context.tools);
									return { dispose() {} };
								},
							};
				Object.defineProperty(
					api === 'document' ? document : navigator,
					'modelContext',
					{ configurable: true, value },
				);
			}, mode);
			await page.goto(`/${item.path}`);
			await expect
				.poll(() =>
					page.evaluate(
						(name) =>
							(window as unknown as MockWindow).__top3Tools.some(
								(tool) => tool.name === name,
							),
						item.name,
					),
				)
				.toBe(true);
			const requests: string[] = [];
			page.on('request', (req) =>
				requests.push(`${req.url()} ${req.postData() ?? ''}`),
			);
			const result = await page.evaluate(async ({ name, input }) => {
				const tool = (window as unknown as MockWindow).__top3Tools.find(
					(entry) => entry.name === name,
				);
				if (!tool) throw new Error('登録されていません');
				return tool.execute(input);
			}, item);
			expect(result[item.key]).toContain(item.expected);
			expect(result.isError).toBeUndefined();
			if (item.path === 'yaml-json-toml') {
				const reserved = await page.evaluate(async (name) => {
					const tool = (window as unknown as MockWindow).__top3Tools.find(
						(entry) => entry.name === name,
					);
					if (!tool) throw new Error('登録されていません');
					return tool.execute({
						text: '{"__proto__":{"polluted":true},"a":1}',
						from: 'json',
						to: 'json',
						sortKeys: true,
					});
				}, item.name);
				expect(reserved.isError).toBeUndefined();
				expect(JSON.parse(reserved.output as string)).toEqual(
					JSON.parse('{"__proto__":{"polluted":true},"a":1}'),
				);
			}
			const error = await page.evaluate(async (name) => {
				const tool = (window as unknown as MockWindow).__top3Tools.find(
					(entry) => entry.name === name,
				);
				if (!tool) throw new Error('登録されていません');
				return tool.execute({ text: 123 });
			}, item.name);
			expect(error.isError).toBe(true);
			expect(requests.join('\n')).not.toMatch(
				/alice|example\.com|name%3A|開始|処理/,
			);
		});
	}
}
test('Mermaid: SVG生成と構文エラーをブラウザで確認', async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as MockWindow).__top3Tools = [];
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: {
				registerTool(tool: RegisteredTool) {
					(window as unknown as MockWindow).__top3Tools.push(tool);
					return Promise.resolve();
				},
			},
		});
	});
	await page.goto('/mermaid');
	await expect
		.poll(() =>
			page.evaluate(() => (window as unknown as MockWindow).__top3Tools.length),
		)
		.toBeGreaterThan(0);
	const run = async (text: string) =>
		page.evaluate(async (code) => {
			const tool = (window as unknown as MockWindow).__top3Tools.find(
				(entry) => entry.name === 'render_mermaid_svg',
			);
			if (!tool) throw new Error('登録されていません');
			return tool.execute({ text: code });
		}, text);
	const result = await run('flowchart TD\nA[開始] --> B[終了]');
	expect(result.svg).toContain('<svg');
	const label = await run('flowchart TD\nA[研究開発 R&D] --> B[x < y]');
	expect(label.isError).toBeUndefined();
	expect(label.svg).toContain('<svg');
	for (const text of [
		'flowchart TD\nA -->|R&D| B',
		'flowchart TD\nA -- R&D --> B',
		'sequenceDiagram\nparticipant A as R&D\nA->>B:x',
		'sequenceDiagram\nalt R&D\nA->>B:x\nend',
		`flowchart TD\n%% R&D ${'-->'.repeat(51)}\nA --> B`,
		'flowchart TD\nA>研究開発 R&D] --> B',
		'flowchart TD\nA["user@{home} ![literal]"] --> B',
	]) {
		const labeled = await run(text);
		expect(labeled.isError).toBeUndefined();
		expect(labeled.svg).toContain('<svg');
	}
	const error = await run('not a diagram');
	const entityLabel = await run(
		`flowchart TD\nA -- ${`${'x'.repeat(95)}#59;`.repeat(48)} --> B`,
	);
	expect(entityLabel.isError).toBe(true);
	expect(entityLabel.error).toContain('200文字');
	const entityMessage = await run(
		`sequenceDiagram\nA->>B: ${`${'x'.repeat(95)}#59;`.repeat(48)}`,
	);
	expect(entityMessage.isError).toBe(true);
	expect(entityMessage.error).toContain('200文字');
	const semicolonLabel = await run(`flowchart TD\nA["${'項目;'.repeat(50)}"]`);
	expect(semicolonLabel.isError).toBeUndefined();
	expect(semicolonLabel.svg).toContain('<svg');
	const arrowLabels = await run(
		`flowchart TD\n${Array.from({ length: 26 }, (_, i) => `A${i}[left-->right and up-->down]`).join('\n')}`,
	);
	expect(arrowLabels.isError).toBeUndefined();
	expect(arrowLabels.svg).toContain('<svg');
	expect(error.isError).toBe(true);
	const tooMany = await run(`sequenceDiagram\n${'A->>B:x\n'.repeat(51)}`);
	expect(tooMany.isError).toBe(true);
	const tooLong = await run(`sequenceDiagram\n${'A->>B:x\n'.repeat(6247)}`);
	expect(tooLong.isError).toBe(true);
	const edgeChain = Array.from({ length: 52 }, (_, index) => `A${index}`).join(
		'-->',
	);
	const overEdges = await run(`graph TD\n${edgeChain}`);
	expect(overEdges.isError).toBe(true);
	const timeline = await run(`timeline\n2020 ${': a '.repeat(1000)}`);
	expect(timeline.isError).toBe(true);
});
for (const item of cases) {
	test(`${item.path}: WebMCPなしでもUIを利用できる`, async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(document, 'modelContext', {
				configurable: true,
				value: undefined,
			});
			Object.defineProperty(navigator, 'modelContext', {
				configurable: true,
				value: undefined,
			});
		});
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto(`/${item.path}`);
		await expect(page.locator('textarea').first()).toBeVisible();
		expect(errors).toEqual([]);
	});
}

test('Mermaid修復: Worker期限・同時実行制限・解放後の再実行', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const state = window as unknown as MockWindow & {
			__repairTerminated: boolean;
		};
		state.__top3Tools = [];
		state.__repairTerminated = false;
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: {
				registerTool(tool: RegisteredTool) {
					state.__top3Tools.push(tool);
					return Promise.resolve();
				},
			},
		});
		const OriginalWorker = Worker;
		let stall = true;
		Object.defineProperty(window, 'Worker', {
			configurable: true,
			value: new Proxy(OriginalWorker, {
				construct(target, args) {
					if (stall && String(args[0]).includes('mermaid-repair')) {
						stall = false;
						return {
							postMessage() {},
							terminate() {
								state.__repairTerminated = true;
							},
						} as unknown as Worker;
					}
					return Reflect.construct(target, args);
				},
			}),
		});
	});
	await page.goto('/mermaid');
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as MockWindow).__top3Tools.some(
					(tool) => tool.name === 'repair_mermaid_code',
				),
			),
		)
		.toBe(true);
	const results = await page.evaluate(async () => {
		const tool = (window as unknown as MockWindow).__top3Tools.find(
			(entry) => entry.name === 'repair_mermaid_code',
		);
		if (!tool) throw new Error('登録されていません');
		const pending = tool.execute({ text: 'flowchart TD\nA --> B' });
		const busy = await tool.execute({ text: 'flowchart TD\nA --> B' });
		const timed = await pending;
		const retry = await tool.execute({ text: 'flowchart TD\nA --> B' });
		return {
			busy,
			timed,
			retry,
			terminated: (window as unknown as { __repairTerminated: boolean })
				.__repairTerminated,
		};
	});
	expect(results.busy.isError).toBe(true);
	expect(results.busy.error).toContain('実行中');
	expect(results.timed.isError).toBe(true);
	expect(results.timed.error).toContain('5秒');
	expect(results.terminated).toBe(true);
	expect(results.retry.isError).toBeUndefined();
	expect(results.retry.code).toContain('A --> B');
	await expect(
		page.getByRole('heading', {
			name: 'Mermaidプレビュー・自動修復',
			exact: true,
		}),
	).toBeVisible();
});
