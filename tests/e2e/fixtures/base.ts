import { test as baseTest, expect } from '@playwright/test';
import { ToolPage } from '../helpers/tool-page';

type MyFixtures = {
	createToolPage: (path: string) => ToolPage;
};

export const test = baseTest.extend<MyFixtures>({
	page: async ({ page }, use) => {
		// Block analytics to prevent test timeouts/flakiness
		await page.route('**/*googletagmanager*', (route) => route.abort());
		await use(page);
	},
	createToolPage: async ({ page }, use) => {
		await use((path: string) => new ToolPage(page, path));
	},
});

export { expect };
