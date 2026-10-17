import { expect, test } from './fixtures/base';

const SITE_ORIGIN = 'https://tools.codelife.cafe';

/** ファイル拡張子付き（アセット）・外部・アンカー・クエリのみのhrefは対象外とする */
function isInternalPageHref(href: string | null): href is string {
	if (!href) return false;
	if (href.startsWith('#') || href.startsWith('?')) return false;
	if (href.startsWith('http') && !href.startsWith(SITE_ORIGIN)) return false;
	const path = href.startsWith(SITE_ORIGIN)
		? href.slice(SITE_ORIGIN.length) || '/'
		: href;
	if (!path.startsWith('/')) return false;
	const withoutQueryHash = path.split('?')[0].split('#')[0];
	const lastSegment = withoutQueryHash.split('/').pop() ?? '';
	if (lastSegment.includes('.')) return false; // 拡張子付きファイル（favicon等）
	return true;
}

test.describe('内部リンクの末尾スラッシュ統一', () => {
	for (const path of ['/', '/color/']) {
		test(`${path} の内部リンクはすべて末尾スラッシュ形式`, async ({ page }) => {
			await page.goto(path);
			const hrefs = await page
				.locator('a[href]')
				.evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href')));
			const internalHrefs = hrefs.filter(isInternalPageHref);
			expect(internalHrefs.length).toBeGreaterThan(0);
			for (const href of internalHrefs) {
				const withoutQueryHash = href.split('?')[0].split('#')[0];
				expect(withoutQueryHash.endsWith('/'), href).toBe(true);
			}
		});
	}
});

test.describe('トップページのツールカード説明', () => {
	test('全ツールカードに空でない説明文がある', async ({ page }) => {
		await page.goto('/');
		const cards = page.locator('a[data-tool-id]');
		const count = await cards.count();
		expect(count).toBeGreaterThan(0);
		for (let i = 0; i < count; i++) {
			const description = await cards.nth(i).locator('p').last().textContent();
			expect(description?.trim().length ?? 0).toBeGreaterThan(0);
		}
	});
});

test.describe('サイトマップ', () => {
	test('/sitemap-0.xml に /offline/ が含まれない', async ({ request }) => {
		const response = await request.get('/sitemap-0.xml');
		expect(response.status()).toBe(200);
		const body = await response.text();
		expect(body).not.toContain('/offline/');
	});
});
