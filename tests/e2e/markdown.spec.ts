import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/base';

test.describe('Markdownプレビュー Tool', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('markdown');
		await toolPage.goto();
		await toolPage.expectTitle('Markdownプレビュー');
		await toolPage.expectSafetyBadge();
	});

	test('見出し・テーブル・タスクリストがプレビューに反映されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('markdown');
		await toolPage.goto();

		await page
			.getByLabel('Markdown入力')
			.fill(
				[
					'# 見出し1',
					'',
					'| a | b |',
					'|---|---|',
					'| 1 | 2 |',
					'',
					'- [ ] 未完了',
					'- [x] 完了',
				].join('\n'),
			);

		// モバイル幅ではプレビュータブに切り替えてから検証する
		const previewTab = page.getByRole('tab', { name: 'プレビュー' });
		if (await previewTab.isVisible()) {
			await previewTab.click();
		}

		const preview = page.getByTestId('markdown-preview');
		await expect(preview.locator('h1')).toHaveText('見出し1');
		await expect(preview.locator('table')).toBeVisible();
		await expect(preview.locator('th').first()).toHaveText('a');
		await expect(preview.locator('input[type="checkbox"]')).toHaveCount(2);
		await expect(
			preview.locator('input[type="checkbox"]').nth(1),
		).toBeChecked();
	});

	test('scriptタグがサニタイズされプレビューに注入されないこと', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('markdown');
		await toolPage.goto();

		await page.getByLabel('Markdown入力').fill('<script>alert(1)</script>本文');

		const preview = page.getByTestId('markdown-preview');
		await expect(preview).toContainText('本文');
		await expect(preview.locator('script')).toHaveCount(0);
		const html = await preview.innerHTML();
		expect(html).not.toContain('<script>');
	});

	test('危険な属性・iframe・javascript:リンク・外部画像がサニタイズされること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('markdown');
		await toolPage.goto();

		// 外部画像URLへのリクエストが発生しないことを監視する
		const externalImageRequests: string[] = [];
		page.on('request', (request) => {
			if (request.url().includes('attacker.invalid')) {
				externalImageRequests.push(request.url());
			}
		});

		await page
			.getByLabel('Markdown入力')
			.fill(
				[
					'<img src="https://attacker.invalid/x.png" onerror="alert(1)">',
					'',
					'<iframe src="https://attacker.invalid"></iframe>',
					'',
					'[クリック](javascript:alert(1))',
					'',
					'![外部画像](https://attacker.invalid/pixel.png)',
					'',
					'本文テキスト',
				].join('\n'),
			);

		const preview = page.getByTestId('markdown-preview');
		await expect(preview).toContainText('本文テキスト');

		// iframe・イベントハンドラ属性は除去される
		await expect(preview.locator('iframe')).toHaveCount(0);
		await expect(preview.locator('[onerror]')).toHaveCount(0);

		// javascript: リンクは無害化される
		const html = await preview.innerHTML();
		expect(html).not.toContain('javascript:');

		// 外部URL画像の src は除去され、外部リクエストは発生しない
		await expect(preview.locator('img[src*="attacker.invalid"]')).toHaveCount(
			0,
		);
		expect(externalImageRequests).toEqual([]);
	});

	test('HTMLダウンロードでファイルがダウンロードされ入力由来のテキストを含むこと', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('markdown');
		await toolPage.goto();

		await page.getByLabel('Markdown入力').fill('# ダウンロードテスト見出し');
		await expect(page.getByTestId('markdown-preview').locator('h1')).toHaveText(
			'ダウンロードテスト見出し',
		);

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'HTMLダウンロード' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('document.html');

		const savePath = path.join(
			os.tmpdir(),
			`markdown-download-${Date.now()}.html`,
		);
		await download.saveAs(savePath);
		const content = fs.readFileSync(savePath, 'utf-8');
		expect(content).toContain('<!DOCTYPE html>');
		expect(content).toContain('ダウンロードテスト見出し');
		fs.unlinkSync(savePath);
	});

	test('モバイル幅(375px)でエディタ/プレビューのタブ切替が動作すること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('markdown');
		await page.setViewportSize({ width: 375, height: 667 });
		await toolPage.goto();

		// モバイル: エディタタブが初期表示
		await expect(page.getByLabel('Markdown入力')).toBeVisible();

		await page.getByLabel('Markdown入力').fill('# モバイル見出し');

		// プレビュータブへ切り替え
		await page.getByRole('tab', { name: 'プレビュー' }).click();
		await expect(page.getByTestId('markdown-preview').locator('h1')).toHaveText(
			'モバイル見出し',
		);
	});

	test('レスポンシブ表示（375px / 1440px）', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('markdown');
		await toolPage.goto();

		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByLabel('Markdown入力')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByLabel('Markdown入力')).toBeVisible();
		await expect(page.getByTestId('markdown-preview')).toBeVisible();
	});
});
