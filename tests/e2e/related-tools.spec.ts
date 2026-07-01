import { expect, test } from './fixtures/base';

const section = (page: import('@playwright/test').Page) =>
	page.locator('section[aria-labelledby="related-tools-heading"]');

test.describe('関連ツール 回遊カード', () => {
	test('ワークフロー所属ツールはステップカードフロー（現在地非リンク、他ステップリンク）を表示する', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('base64');
		await toolPage.goto();

		const related = section(page);
		await expect(
			related.getByRole('heading', { name: 'この作業の続きに' }),
		).toBeVisible();
		// base64.workflow = json-formatter / hash / base64 / regex-tester
		await expect(related.locator('a[href="/json-formatter"]')).toHaveCount(1);
		await expect(related.locator('a[href="/hash"]')).toHaveCount(1);
		await expect(related.locator('a[href="/regex-tester"]')).toHaveCount(1);
		// 現在地の base64 は <a> ではなく <div> として出力されるため、リンクは 0 件
		await expect(related.locator('a[href="/base64"]')).toHaveCount(0);
		// 現在地であることを示すテキストが存在することを確認
		await expect(related.locator('text=現在地')).toBeVisible();
	});

	test('related 未指定ツールは同カテゴリで補完表示する', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('char-count');
		await toolPage.goto();

		const related = section(page);
		await expect(
			related.getByRole('heading', { name: 'あわせて使いたいツール' }),
		).toBeVisible();
		// テキスト解析カテゴリの他ツール（text-diff）が補完される
		await expect(related.locator('a[href="/text-diff"]')).toHaveCount(1);
		await expect(related.locator('a[href="/char-count"]')).toHaveCount(0);
	});

	test('カードから関連ツールへ遷移できる', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('base64');
		await toolPage.goto();

		await section(page).locator('a[href="/hash"]').click();
		await expect(page).toHaveURL(/\/hash$/);
	});

	const workflows = [
		{
			name: 'CSV前処理',
			from: 'csv-fixer',
			to: 'csv-editor',
			toHref: '/csv-editor',
		},
		{
			name: '画像最適化',
			from: 'image-compress',
			to: 'image-crop',
			toHref: '/image-crop',
		},
		{
			name: '請求・帳票作成',
			from: 'tax',
			to: 'pdf-merge',
			toHref: '/pdf-merge',
		},
		{
			name: '開発者ツール',
			from: 'json-formatter',
			to: 'hash',
			toHref: '/hash',
		},
	];

	for (const wf of workflows) {
		test(`${wf.name} ワークフローの遷移と計測イベント発火を検証する`, async ({
			page,
			createToolPage,
		}) => {
			const toolPage = createToolPage(wf.from);
			await toolPage.goto();

			let relatedClickPayload: { from: string; to: string } | null = null;
			await page.route('**/api/event', async (route) => {
				const request = route.request();
				if (request.method() === 'POST') {
					const data = request.postDataJSON();
					if (data.event === 'related_click') {
						relatedClickPayload = data.props;
					}
				}
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ success: true }),
				});
			});

			const related = section(page);
			const nextLink = related.locator(`a[href="${wf.toHref}"]`);
			await expect(nextLink).toBeVisible();
			await Promise.all([
				page.waitForRequest(
					(req) =>
						req.url().endsWith('/api/event') &&
						req.method() === 'POST' &&
						JSON.parse(req.postData() || '{}').event === 'related_click',
				),
				nextLink.click(),
			]);

			await expect(page).toHaveURL(new RegExp(`${wf.toHref}$`));
			expect(relatedClickPayload).toEqual({
				from: wf.from,
				to: wf.to,
			});
		});
	}
});
