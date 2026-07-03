import { expect, test } from './fixtures/base';

interface WebMcpMockTool {
	name: string;
	inputSchema: { required: string[] };
	execute: (input: Record<string, unknown>) => Promise<unknown>;
}

interface WebMcpMockCall {
	tools: WebMcpMockTool[];
}

interface WebMcpMockWindow extends Window {
	__webmcpCalls: WebMcpMockCall[];
	__webmcpDisposed: boolean;
	__webmcpCleared?: boolean;
}

const WEBMCP_INIT_SCRIPT = `
(() => {
  window.__webmcpCalls = [];
  window.__webmcpDisposed = false;

  Object.defineProperty(navigator, 'modelContext', {
    configurable: true,
    value: {
      provideContext(args) {
        window.__webmcpCalls.push(args);
        return {
          dispose() {
            window.__webmcpDisposed = true;
            console.log('__webmcp_disposed__');
          },
        };
      },
      clearContext() {
        window.__webmcpCleared = true;
      },
    },
  });
})();
`;

test.describe('WebMCP Tool Registration — /hash', () => {
	test('generate_hash tool is registered via mock modelContext', async ({
		page,
		createToolPage,
	}) => {
		await page.addInitScript(WEBMCP_INIT_SCRIPT);

		const toolPage = createToolPage('hash');
		await toolPage.goto();

		const calls = await page.evaluate(
			() => (window as unknown as WebMcpMockWindow).__webmcpCalls,
		);
		expect(calls.length).toBeGreaterThan(0);

		const lastCall = calls.at(-1);
		expect(lastCall).toBeDefined();
		if (!lastCall) throw new Error('WebMCP registration call is missing');
		const toolNames = lastCall.tools.map((t: WebMcpMockTool) => t.name);
		expect(toolNames).toContain('generate_hash');

		const hashTool = lastCall.tools.find(
			(t: WebMcpMockTool) => t.name === 'generate_hash',
		);
		expect(hashTool).toBeDefined();
		expect(hashTool!.inputSchema.required).toContain('text');
		expect(hashTool!.inputSchema.required).toContain('algorithm');
	});

	test('generate_hash execute returns correct hash for valid input', async ({
		page,
		createToolPage,
	}) => {
		await page.addInitScript(WEBMCP_INIT_SCRIPT);

		const toolPage = createToolPage('hash');
		await toolPage.goto();

		const result = await page.evaluate(async () => {
			const tool = (window as unknown as WebMcpMockWindow).__webmcpCalls
				.at(-1)
				?.tools.find((t: WebMcpMockTool) => t.name === 'generate_hash');
			if (!tool) throw new Error('generate_hash tool is not registered');
			return await tool.execute({ text: 'hello', algorithm: 'md5' });
		});

		expect(result).toEqual({ hash: '5d41402abc4b2a76b9719d911017c592' });
	});

	test('generate_hash execute returns isError for invalid input', async ({
		page,
		createToolPage,
	}) => {
		await page.addInitScript(WEBMCP_INIT_SCRIPT);

		const toolPage = createToolPage('hash');
		await toolPage.goto();

		const result = (await page.evaluate(async () => {
			const tool = (window as unknown as WebMcpMockWindow).__webmcpCalls
				.at(-1)
				?.tools.find((t: WebMcpMockTool) => t.name === 'generate_hash');
			if (!tool) throw new Error('generate_hash tool is not registered');
			return await tool.execute({ text: null });
		})) as { isError: boolean; error: string };

		expect(result.isError).toBe(true);
		expect(typeof result.error).toBe('string');
	});

	test('cleanup dispose function is returned from provideContext', async ({
		page,
		createToolPage,
	}) => {
		await page.addInitScript(WEBMCP_INIT_SCRIPT);

		const toolPage = createToolPage('hash');
		await toolPage.goto();

		const hasDispose = await page.evaluate(() => {
			const calls = (window as unknown as WebMcpMockWindow).__webmcpCalls;
			return calls.length > 0;
		});
		expect(hasDispose).toBe(true);

		const disposedBefore = await page.evaluate(
			() => (window as unknown as WebMcpMockWindow).__webmcpDisposed,
		);
		expect(disposedBefore).toBe(false);
	});
});

test.describe('WebMCP Tool Registration — /tax', () => {
	test('calc_tax tool is registered via mock modelContext', async ({
		page,
		createToolPage,
	}) => {
		await page.addInitScript(WEBMCP_INIT_SCRIPT);

		const toolPage = createToolPage('tax');
		await toolPage.goto();

		const calls = await page.evaluate(
			() => (window as unknown as WebMcpMockWindow).__webmcpCalls,
		);
		expect(calls.length).toBeGreaterThan(0);

		const lastCall = calls.at(-1);
		expect(lastCall).toBeDefined();
		if (!lastCall) throw new Error('WebMCP registration call is missing');
		const toolNames = lastCall.tools.map((t: WebMcpMockTool) => t.name);
		expect(toolNames).toContain('calc_tax');

		const taxTool = lastCall.tools.find(
			(t: WebMcpMockTool) => t.name === 'calc_tax',
		);
		expect(taxTool).toBeDefined();
		expect(taxTool!.inputSchema.required).toContain('amount');
		expect(taxTool!.inputSchema.required).toContain('taxRate');
		expect(taxTool!.inputSchema.required).toContain('mode');
	});

	test('calc_tax execute returns correct result for valid input', async ({
		page,
		createToolPage,
	}) => {
		await page.addInitScript(WEBMCP_INIT_SCRIPT);

		const toolPage = createToolPage('tax');
		await toolPage.goto();

		const result = await page.evaluate(async () => {
			const tool = (window as unknown as WebMcpMockWindow).__webmcpCalls
				.at(-1)
				?.tools.find((t: WebMcpMockTool) => t.name === 'calc_tax');
			if (!tool) throw new Error('calc_tax tool is not registered');
			return await tool.execute({
				amount: 10000,
				taxRate: '10',
				mode: 'tax_excluded',
			});
		});

		expect(result).toEqual({
			base: 10000,
			tax: 1000,
			total: 11000,
			result: 11000,
			taxAmount: 1000,
		});
	});

	test('calc_tax execute returns isError for invalid input', async ({
		page,
		createToolPage,
	}) => {
		await page.addInitScript(WEBMCP_INIT_SCRIPT);

		const toolPage = createToolPage('tax');
		await toolPage.goto();

		const result = (await page.evaluate(async () => {
			const tool = (window as unknown as WebMcpMockWindow).__webmcpCalls
				.at(-1)
				?.tools.find((t: WebMcpMockTool) => t.name === 'calc_tax');
			if (!tool) throw new Error('calc_tax tool is not registered');
			return await tool.execute({ amount: 'not a number' });
		})) as { isError: boolean; error: string };

		expect(result.isError).toBe(true);
		expect(typeof result.error).toBe('string');
	});

	test('cleanup dispose function is returned from provideContext', async ({
		page,
		createToolPage,
	}) => {
		await page.addInitScript(WEBMCP_INIT_SCRIPT);

		const toolPage = createToolPage('tax');
		await toolPage.goto();

		const hasDispose = await page.evaluate(() => {
			const calls = (window as unknown as WebMcpMockWindow).__webmcpCalls;
			return calls.length > 0;
		});
		expect(hasDispose).toBe(true);

		const disposedBefore = await page.evaluate(
			() => (window as unknown as WebMcpMockWindow).__webmcpDisposed,
		);
		expect(disposedBefore).toBe(false);
	});
});

test.describe('WebMCP Tool Registration — homepage', () => {
	test('list_tools / search_tools are registered on page load', async ({
		page,
	}) => {
		await page.addInitScript(WEBMCP_INIT_SCRIPT);

		await page.goto('/');

		const calls = await page.evaluate(
			() => (window as unknown as WebMcpMockWindow).__webmcpCalls,
		);
		expect(calls.length).toBeGreaterThan(0);

		const lastCall = calls.at(-1);
		expect(lastCall).toBeDefined();
		if (!lastCall) throw new Error('WebMCP registration call is missing');
		const toolNames = lastCall.tools.map((t: WebMcpMockTool) => t.name);
		expect(toolNames).toContain('list_tools');
		expect(toolNames).toContain('search_tools');
	});

	test('list_tools execute returns the published tool catalog', async ({
		page,
	}) => {
		await page.addInitScript(WEBMCP_INIT_SCRIPT);

		await page.goto('/');

		const result = (await page.evaluate(async () => {
			const tool = (window as unknown as WebMcpMockWindow).__webmcpCalls
				.at(-1)
				?.tools.find((t: WebMcpMockTool) => t.name === 'list_tools');
			if (!tool) throw new Error('list_tools tool is not registered');
			return await tool.execute({});
		})) as { tools: { id: string; url: string }[] };

		expect(result.tools.length).toBeGreaterThan(0);
		const hashEntry = result.tools.find((t) => t.id === 'hash');
		expect(hashEntry?.url).toBe('https://tools.codelife.cafe/hash');
	});

	test('search_tools execute returns matching tools', async ({ page }) => {
		await page.addInitScript(WEBMCP_INIT_SCRIPT);

		await page.goto('/');

		const result = (await page.evaluate(async () => {
			const tool = (window as unknown as WebMcpMockWindow).__webmcpCalls
				.at(-1)
				?.tools.find((t: WebMcpMockTool) => t.name === 'search_tools');
			if (!tool) throw new Error('search_tools tool is not registered');
			return await tool.execute({ query: 'ハッシュ' });
		})) as { tools: { id: string }[] };

		expect(result.tools.map((t) => t.id)).toContain('hash');
	});

	test('homepage loads without error when modelContext is absent', async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));

		await page.goto('/');

		expect(errors).toHaveLength(0);
	});
});

test.describe('WebMCP — no modelContext', () => {
	test('/hash page loads without error when modelContext is absent', async ({
		page,
		createToolPage,
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));

		const toolPage = createToolPage('hash');
		await toolPage.goto();

		expect(errors).toHaveLength(0);
	});

	test('/tax page loads without error when modelContext is absent', async ({
		page,
		createToolPage,
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));

		const toolPage = createToolPage('tax');
		await toolPage.goto();

		expect(errors).toHaveLength(0);
	});
});

test.describe('WebMCP — partial modelContext (provideContext not a function)', () => {
	test('/hash does not throw when modelContext exists but provideContext is not a function', async ({
		page,
		createToolPage,
	}) => {
		await page.addInitScript(`
			Object.defineProperty(navigator, 'modelContext', {
				configurable: true,
				value: { notAFunction: true },
			});
		`);

		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));

		const toolPage = createToolPage('hash');
		await toolPage.goto();

		expect(errors).toHaveLength(0);
	});
});

test.describe('WebMCP — no external network requests with input data', () => {
	test('/hash execute does not trigger external requests containing input data', async ({
		page,
		createToolPage,
	}) => {
		await page.addInitScript(WEBMCP_INIT_SCRIPT);

		const inputDataRequests: string[] = [];
		const secretInput = 'secret_test_data_12345';

		page.on('request', (req) => {
			const url = req.url();
			const postData = req.postData() ?? '';
			if (url.includes(secretInput) || postData.includes(secretInput)) {
				inputDataRequests.push(url);
			}
		});

		const toolPage = createToolPage('hash');
		await toolPage.goto();

		await page.evaluate(async (input) => {
			const tool = (window as unknown as WebMcpMockWindow).__webmcpCalls
				.at(-1)
				?.tools.find((t: WebMcpMockTool) => t.name === 'generate_hash');
			if (!tool) throw new Error('generate_hash tool is not registered');
			await tool.execute({ text: input, algorithm: 'md5' });
		}, secretInput);

		expect(inputDataRequests).toHaveLength(0);
	});
});
