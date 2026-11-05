import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	assertMermaidDiagramNoExternalImages,
	assertMermaidNoExternalImages,
	renderMermaidSvg,
} from '../../src/lib/tools/mermaid.ts';

const image = 'https://example.invalid/pixel';
const bypass = `---\ntitle: '%%{wrap:'\n---\nswimlane-beta\nA@%%{wrap}%%{ img: "${image}", h: 20 }`;

test('F11: frontmatterを先に除去し、swimlaneの分割img構文を拒否する', async () => {
	for (const code of [bypass, bypass.replaceAll('\n', '\r\n')]) {
		await assert.rejects(assertMermaidNoExternalImages(code), /外部リソース/);
		await assert.rejects(
			renderMermaidSvg(code, 'swimlane-bypass'),
			/外部リソース/,
		);
	}
});

test('F11: 図種名に依存せずMermaidが解析したswimlaneのFlowDBを検査する', async () => {
	const { default: mermaid } = await import('mermaid');
	mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
	await mermaid.parse(bypass);
	const diagram = await mermaid.mermaidAPI.getDiagramFromText(bypass);
	assert.equal(diagram.type, 'swimlane');
	assert.ok('getVertices' in diagram.db);
	assert.ok(typeof diagram.db.getVertices === 'function');
	const vertices = diagram.db.getVertices();
	assert.ok(vertices instanceof Map);
	assert.equal(vertices.get('A').img, image);
	for (const type of ['swimlane', 'future-flow-diagram']) {
		// 安全な文字列でもDBに画像があれば拒否する。
		await assert.rejects(
			assertMermaidDiagramNoExternalImages('swimlane-beta\n A --> B', {
				...diagram,
				type,
			}),
			/外部リソース/,
		);
	}
});

test('F12: sequenceのproperties iconは埋め込み識別子以外を拒否する', async () => {
	// NodeにはDOMPurify用のDOMがないため、解析後DBの境界を検査する。
	// Mermaidの実parserから描画までの接続はブラウザE2Eで検証する。
	for (const icon of [
		image,
		`  ${image}  `,
		'//example.invalid/pixel',
		'/pixel',
		'./pixel',
		'data:image/png,test',
		'blob:test',
		'',
		123,
		null,
	]) {
		await assert.rejects(
			assertMermaidDiagramNoExternalImages(
				'sequenceDiagram\n A->>B: 問い合わせ',
				{
					type: 'sequence',
					db: { getActors: () => new Map([['A', { properties: { icon } }]]) },
				},
			),
			/外部リソース/,
		);
	}
	for (const properties of [
		{},
		{ icon: '@clock' },
		{ icon: '  @clock  ' },
		{ description: 'https://example.invalid/説明' },
	]) {
		await assert.doesNotReject(
			assertMermaidDiagramNoExternalImages(
				'sequenceDiagram\n A->>B: 問い合わせ',
				{
					type: 'sequence',
					db: { getActors: () => new Map([['A', { properties }]]) },
				},
			),
		);
	}
});

test('F12: 描画入口でsequenceのDBを検査し、拒否後も正常な描画を続けられる', async (t) => {
	const { default: mermaid } = await import('mermaid');
	const api = mermaid.mermaidAPI;
	t.after(() => {
		mermaid.mermaidAPI = api;
	});
	mermaid.mermaidAPI = {
		...api,
		async getDiagramFromText(code) {
			const diagram = await api.getDiagramFromText(code);
			if (
				'getActors' in diagram.db &&
				typeof diagram.db.getActors === 'function'
			) {
				const actors = diagram.db.getActors();
				if (actors instanceof Map) actors.get('A').properties = { icon: image };
			}
			return diagram;
		},
	};
	const draw = t.mock.method(mermaid, 'render', async () => ({
		svg: '<svg/>',
	}));
	await assert.rejects(
		renderMermaidSvg('sequenceDiagram\n A->>B: hello', 'sequence-icon'),
		/外部リソース/,
	);
	assert.equal(draw.mock.callCount(), 0);
	mermaid.mermaidAPI = api;
	await assert.doesNotReject(
		renderMermaidSvg('sequenceDiagram\n A->>B: hello', 'sequence-safe'),
	);
	assert.equal(draw.mock.callCount(), 1);
});

test('F12: sequenceの画像検査に必要なDBを取得できなければ描画を拒否する', async () => {
	for (const db of [
		null,
		{},
		{ getActors: () => undefined },
		{ getActors: () => [] },
	]) {
		await assert.rejects(
			assertMermaidDiagramNoExternalImages('sequenceDiagram\n A->>B: hello', {
				type: 'sequence',
				db,
			}),
			/画像検査に失敗/,
		);
	}
});

test('画像を持たないswimlane・kanban・sequence metadata・init・shapeを維持する', async () => {
	const { default: mermaid } = await import('mermaid');
	for (const code of [
		'swimlane-beta\n A --> B',
		"kanban\n todo[未着手]\n  task[作業]@{ ticket: MC-2037, assigned: 'knsv' }",
		'sequenceDiagram\n participant A@{ "type": "boundary" }\n A->>B: 問い合わせ',
		'%%{init: {"theme": "base"}}%%\nflowchart TD\n A --> B',
		'flowchart TD\n A@{ shape: rect } --> B',
	]) {
		await assert.doesNotReject(assertMermaidNoExternalImages(code));
		// kanbanのparserはDOMを必要とするため、実描画はE2Eで確認する。
		if (code.startsWith('kanban')) {
			await assert.doesNotReject(
				assertMermaidDiagramNoExternalImages(code, { type: 'kanban', db: {} }),
			);
			continue;
		}
		mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
		await mermaid.parse(code);
		const diagram = await mermaid.mermaidAPI.getDiagramFromText(code);
		await assert.doesNotReject(
			assertMermaidDiagramNoExternalImages(code, diagram),
		);
	}
});
