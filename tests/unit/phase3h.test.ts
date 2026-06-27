import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateJsonLd } from '../../src/lib/jsonld.ts';
import { toolCatalog } from '../../src/lib/tools/catalog.ts';
import { provideTools } from '../../src/lib/webmcp.ts';
import { GET as getLlms } from '../../src/pages/llms.txt.ts';
import { GET as getLlmsFull } from '../../src/pages/llms-full.txt.ts';

test('webmcp: navigator が未定義の環境では no-op であること', () => {
	const cleanup = provideTools([]);
	assert.equal(typeof cleanup, 'function');
	cleanup();
});

test('webmcp: navigator.modelContext が存在する場合に provideContext が呼ばれ、戻り値の cleanup が機能すること', () => {
	let providedArgs: unknown = null;
	let disposed = false;

	const mockModelContext = {
		provideContext(args: unknown) {
			providedArgs = args;
			return {
				dispose() {
					disposed = true;
				},
			};
		},
	};

	// モックを設定
	const originalNavigator = globalThis.navigator;
	Object.defineProperty(globalThis, 'navigator', {
		value: { modelContext: mockModelContext },
		configurable: true,
	});

	try {
		const tools = [
			{
				name: 'test_tool',
				description: 'テスト用ツール',
				inputSchema: { type: 'object' },
				execute: () => 'ok',
			},
		];
		const cleanup = provideTools(tools);

		assert.deepEqual(providedArgs, { tools });
		assert.equal(disposed, false);

		cleanup();
		assert.equal(disposed, true);
	} finally {
		Object.defineProperty(globalThis, 'navigator', {
			value: originalNavigator,
			configurable: true,
		});
	}
});

test('llms.txt: GET エンドポイントが正常にテキストを生成し 200 を返すこと', async () => {
	const mockContext = {} as Parameters<typeof getLlms>[0];
	const response = (await getLlms(mockContext)) as Response;

	assert.equal(response.status, 200);
	assert.equal(
		response.headers.get('content-type'),
		'text/plain; charset=utf-8',
	);

	const text = await response.text();
	assert.ok(text.includes('# tools.codelife.cafe'));
	assert.ok(text.includes('## Tools'));

	for (const tool of toolCatalog.filter((t) => t.published !== false)) {
		assert.ok(text.includes(tool.title));
		assert.ok(text.includes(tool.href));
	}
});

test('llms-full.txt: GET エンドポイントが詳細情報を掲載し 200 を返すこと', async () => {
	const mockContext = {} as Parameters<typeof getLlmsFull>[0];
	const response = (await getLlmsFull(mockContext)) as Response;

	assert.equal(response.status, 200);
	assert.equal(
		response.headers.get('content-type'),
		'text/plain; charset=utf-8',
	);

	const text = await response.text();
	assert.ok(text.includes('# tools.codelife.cafe — Full Reference'));

	const hashTool = toolCatalog.find((t) => t.id === 'hash');
	assert.ok(hashTool);
	assert.ok(text.includes(`## ${hashTool.title}`));
	assert.ok(text.includes(`- 用途: ${hashTool.llmsFull?.useCase}`));
});

test('jsonld: generateJsonLd が正しい @graph 構造を生成すること', () => {
	const meta = {
		title: 'テストツール',
		path: '/test-tool',
		summary: 'テスト用の概要です',
		category: '開発ツール',
		hasHowTo: true,
		hasFaq: true,
		faqItems: [{ question: '質問1', answer: '回答1' }],
	};

	const result = generateJsonLd(meta) as {
		'@context': string;
		'@graph': Array<Record<string, unknown>>;
	};

	assert.equal(result['@context'], 'https://schema.org');
	assert.equal(Array.isArray(result['@graph']), true);
	assert.equal(result['@graph'].length, 3);

	const software = result['@graph'][0];
	assert.equal(software['@type'], 'SoftwareApplication');
	assert.equal(software.name, 'テストツール');

	const howto = result['@graph'][1];
	assert.equal(howto['@type'], 'HowTo');
	assert.equal(howto.name, 'テストツールの使い方');

	const faq = result['@graph'][2];
	assert.equal(faq['@type'], 'FAQPage');
});
