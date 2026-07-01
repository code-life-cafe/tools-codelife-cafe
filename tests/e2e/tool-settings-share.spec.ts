import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/base';

const tools = [
	{
		slug: 'json-formatter',
		settings: { indent: '4' },
		secret: 'secret-json-input-12345',
	},
	{
		slug: 'regex-tester',
		settings: {
			pattern: '[A-Z]+',
			flags: 'gi',
			showReplace: true,
			replacement: '置換',
		},
		secret: 'secret-regex-target-12345',
	},
	{
		slug: 'csv-editor',
		settings: { delimiter: '\t', hasHeader: false },
		secret: 'secret,csv,input,12345',
	},
	{
		slug: 'image-compress',
		settings: {
			format: 'webp',
			quality: 72,
			resizeKind: 'long-edge',
			resizeValue: 1024,
			useTargetSize: false,
			targetKB: 300,
			background: '#ffffff',
		},
		secret: 'secret-image-file-name-12345',
	},
	{
		slug: 'tax',
		settings: {
			mode: 'single',
			direction: 'inclusive-to-exclusive',
			rateSelection: '8-reduced',
			rounding: 'ceil',
		},
		secret: '987654321',
	},
] as const;

function encodeSettings(settings: Record<string, unknown>) {
	return Buffer.from(JSON.stringify(settings), 'utf8').toString('base64');
}

async function fillSensitiveInput(page: Page, slug: string, secret: string) {
	switch (slug) {
		case 'json-formatter':
			await page.locator('#json-input-textarea').fill(secret);
			break;
		case 'regex-tester':
			await page.getByText('テスト文字列').scrollIntoViewIfNeeded();
			await page.locator('textarea').fill(secret);
			break;
		case 'csv-editor':
			await page.locator('textarea').fill(secret);
			break;
		case 'tax':
			await page.getByLabel('金額').fill(secret);
			break;
		case 'image-compress':
			// ファイル名・画像データは共有URL生成対象ではないため、入力操作なしで検証する。
			break;
	}
}

function decodeShareSettings(shareUrl: string) {
	const settings = new URL(shareUrl).searchParams.get('settings');
	if (!settings) return '';
	return Buffer.from(settings, 'base64').toString('utf8');
}

test.describe('ツール設定共有URL', () => {
	for (const tool of tools) {
		test(`${tool.slug}: settings URL は復元・canonical固定に対応する`, async ({
			page,
		}) => {
			const settingsParam = encodeSettings(tool.settings);
			await page.goto(
				`/${tool.slug}?settings=${encodeURIComponent(settingsParam)}`,
			);

			await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
				'href',
				`https://tools.codelife.cafe/${tool.slug}`,
			);

			const restored = await page.evaluate((slug) => {
				const value = localStorage.getItem(`tool_settings_${slug}`);
				return value ? JSON.parse(value) : null;
			}, tool.slug);
			expect(restored).toMatchObject(tool.settings);
		});
	}

	test('共有URLには入力本文やファイル内容に相当する値を含めない', async ({
		page,
	}) => {
		for (const tool of tools) {
			await page.goto(`/${tool.slug}`);
			await fillSensitiveInput(page, tool.slug, tool.secret);

			await page.evaluate(() => {
				Object.defineProperty(navigator, 'clipboard', {
					configurable: true,
					value: {
						writeText: async (text: string) => {
							window.sessionStorage.setItem('lastShareUrl', text);
						},
					},
				});
			});
			await page
				.getByRole('button', { name: /設定を共有/ })
				.first()
				.click();
			const shareUrl = await page.evaluate(() =>
				window.sessionStorage.getItem('lastShareUrl'),
			);
			expect(shareUrl).not.toBeNull();
			if (!shareUrl) {
				throw new Error('共有URLが生成されませんでした');
			}
			expect(shareUrl).toContain(`/${tool.slug}`);
			expect(shareUrl).toContain('settings=');
			expect(shareUrl).not.toContain(tool.secret);
			expect(decodeShareSettings(shareUrl)).not.toContain(tool.secret);
		}
	});
});
