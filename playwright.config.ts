import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 4 : undefined,
	reporter: process.env.CI ? 'html' : 'list',
	use: {
		baseURL: 'http://localhost:4321',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		// SW は context.route() を素通りし、並列実行時にハイドレーションを遅延させるため無効化
		serviceWorkers: 'block',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
	],
	webServer: {
		command: 'npm run preview:ci',
		port: 4321,
		reuseExistingServer: true,
		timeout: 60_000,
	},
});
