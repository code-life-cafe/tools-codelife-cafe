import { readFileSync } from 'node:fs';
import { pagesHeadersForPath } from '../helpers/pages-headers.ts';
import { expect, test } from './fixtures/base';

const builtHeaders = readFileSync('dist/_headers', 'utf8');
const imageUrl = 'https://mermaid-privacy.example.invalid/pixel.png';
const bypass = `---\ntitle: '%%{wrap:'\n---\nswimlane-beta\nA@%%{wrap}%%{ img: "${imageUrl}", h: 20 }`;
const sequence = `sequenceDiagram\n participant A\n properties A: {"icon": "${imageUrl}"}\n A->>B: 問い合わせ`;

test.describe('Mermaidの外部画像防止（dist + astro preview）', () => {
	test.beforeEach(async ({ page, context }) => {
		// 共通fixtureの遮断に成功を依存させず、要求イベントを直接観測する。
		await page.unrouteAll();
		await context.unrouteAll();
	});

	for (const [name, code] of [
		['flowchartの既存img', `flowchart TD\n A@{ img: "${imageUrl}", h: 20 }`],
		['swimlaneのfrontmatter回避', bypass],
		['sequenceのproperties icon', sequence],
	]) {
		test(`${name}はCSPなしでも描画前に拒否し画像要求0件`, async ({ page }) => {
			const images: string[] = [];
			page.on('request', (request) => {
				if (
					request.resourceType() === 'image' &&
					new URL(request.url()).origin !== 'http://localhost:4321'
				) {
					images.push(request.url());
				}
			});
			await page.goto('/mermaid/');
			await page.getByRole('switch', { name: /日本語・AI修復/ }).uncheck();
			await page.locator('textarea').fill(code);
			const preview = page.getByRole('tab', { name: /プレビュー/ });
			if (await preview.isVisible()) await preview.click();
			await expect(
				page.getByText(/外部リソースの取得を防ぐため/),
			).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'SVG保存', exact: true }),
			).toBeDisabled();
			expect(images).toEqual([]);
		});
	}

	test('登録済みWebMCPのsequence iconも描画前に拒否し画像要求0件', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			Object.defineProperty(document, 'modelContext', {
				value: {
					registerTool(tool: {
						name: string;
						execute: (input: unknown) => Promise<unknown>;
					}) {
						if (tool.name === 'render_mermaid_svg') {
							Object.assign(window, { renderMermaidTool: tool });
						}
					},
				},
			});
		});
		const images: string[] = [];
		page.on('request', (request) => {
			if (
				request.resourceType() === 'image' &&
				request.url().startsWith('https://')
			)
				images.push(request.url());
		});
		await page.goto('/mermaid/');
		await page.waitForFunction(() => 'renderMermaidTool' in window);
		for (const autoRepair of [false, true]) {
			const result = await page.evaluate(
				async ({ text, autoRepair }) => {
					const tool = (
						window as unknown as {
							renderMermaidTool: {
								execute: (input: unknown) => Promise<unknown>;
							};
						}
					).renderMermaidTool;
					return await tool.execute({ text, autoRepair });
				},
				{ text: sequence, autoRepair },
			);
			expect(JSON.stringify(result)).toContain('外部リソース');
		}
		expect(images).toEqual([]);
	});

	test('distのCSPを注入するとHTMLラベルとCSSの外部画像をブラウザが遮断する', async ({
		page,
	}) => {
		// astro previewは_headersを配信に適用しない。distのルールだけを文書応答に注入。
		// Cloudflareの実レスポンスヘッダー確認はMerge後に別途必要。
		await page.route('**/mermaid/', async (route) => {
			const response = await route.fetch();
			const csp = pagesHeadersForPath(builtHeaders, '/mermaid/').get(
				'Content-Security-Policy',
			);
			expect(csp).toBeTruthy();
			await route.fulfill({
				response,
				headers: {
					...response.headers(),
					'content-security-policy': csp ?? '',
				},
			});
		});
		await page.addInitScript(() => {
			Object.assign(window, { imageViolations: [] });
			document.addEventListener('securitypolicyviolation', (event) => {
				if (event.effectiveDirective === 'img-src') {
					(
						window as unknown as { imageViolations: string[] }
					).imageViolations.push(event.blockedURI);
				}
			});
		});
		let dispatchedImages = 0;
		// CSPの拒否前にrequestイベントは出る場合がある。ネットワークへ進んだ要求を別に数える。
		await page.route(
			'https://mermaid-privacy.example.invalid/**',
			async (route) => {
				dispatchedImages++;
				await route.fulfill({ status: 204 });
			},
		);
		const response = await page.goto('/mermaid/');
		expect(response?.headers()['content-security-policy']).toContain(
			"img-src 'self' data: blob:",
		);
		await expect(
			page.getByRole('button', { name: 'SVG保存', exact: true }),
		).toBeEnabled();
		await page.getByRole('switch', { name: /日本語・AI修復/ }).uncheck();
		await page
			.locator('textarea')
			.fill(`flowchart TD\n A["<img src='${imageUrl}'>"] --> B[完了]`);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as { imageViolations: string[] })
							.imageViolations,
				),
			)
			.toContain(imageUrl);
		// CSS url()の画像取得も同じimg-srcに従うことを独立に検証する。
		await page.evaluate((url) => {
			const element = document.createElement('div');
			element.style.cssText = `width:20px;height:20px;background-image:url("${url}?css")`;
			document.body.append(element);
		}, imageUrl);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as { imageViolations: string[] })
							.imageViolations,
				),
			)
			.toContain(`${imageUrl}?css`);
		expect(dispatchedImages).toBe(0);
		for (const [code, label] of [
			['swimlane-beta\n A[開始] --> B[完了]', '完了'],
			[
				"kanban\n todo[未着手]\n  task[作業]@{ ticket: MC-2037, assigned: 'knsv' }",
				'作業',
			],
			[
				'sequenceDiagram\n participant A@{ "type": "boundary" }\n A->>B: 問い合わせ',
				'問い合わせ',
			],
			[
				'%%{init: {"theme": "base"}}%%\nflowchart TD\n A[開始] --> B[終了]',
				'終了',
			],
			[
				'flowchart TD\n A@{ shape: rect, label: "通常ノード" } --> B',
				'通常ノード',
			],
		]) {
			const editor = page.getByRole('tab', { name: /コード入力/ });
			if (await editor.isVisible()) await editor.click();
			await page.locator('textarea').fill(code);
			const preview = page.getByRole('tab', { name: /プレビュー/ });
			if (await preview.isVisible()) await preview.click();
			const svg = page
				.getByRole('img', { name: /Mermaidダイアグラム/ })
				.locator('svg');
			await expect(svg).toContainText(label);
			await expect(
				page.getByRole('button', { name: 'SVG保存', exact: true }),
			).toBeEnabled();
		}
	});
});
