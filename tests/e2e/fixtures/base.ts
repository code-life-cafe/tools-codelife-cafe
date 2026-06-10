import { test as baseTest, expect, type Page } from '@playwright/test';
import { ToolPage } from '../helpers/tool-page';

type MyFixtures = {
	createToolPage: (path: string) => ToolPage;
};

// React Island のハイドレーション完了前に fill/click すると controlled component が
// 空文字でリセットされ flaky になるため、client:load の astro-island の ssr 属性削除
// （= ハイドレーション完了）を待つ。client:visible 等の遅延 island は対象外。
async function waitForClientLoadIslands(page: Page) {
	// 並列実行の負荷ピーク時はハイドレーションが15秒を超えて停滞することがある（実測）
	await expect(page.locator('astro-island[ssr][client="load"]')).toHaveCount(
		0,
		{ timeout: 25_000 },
	);
}

export const test = baseTest.extend<MyFixtures>({
	page: async ({ page }, use) => {
		// Block analytics to prevent test timeouts/flakiness
		await page.route('**/*googletagmanager*', (route) => route.abort());
		const originalGoto = page.goto.bind(page);
		page.goto = async (...args: Parameters<Page['goto']>) => {
			const response = await originalGoto(...args);
			await waitForClientLoadIslands(page);
			return response;
		};
		await use(page);
	},
	createToolPage: async ({ page }, use) => {
		await use((path: string) => new ToolPage(page, path));
	},
});

export { expect };
