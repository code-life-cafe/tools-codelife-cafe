import { expect, test } from '@playwright/test';

test.describe('Phase 3h: llms.txt & schema.org JSON-LD E2E', () => {
	test('GET /llms.txt が 200 OK で text/plain を返し、主要テキストを含むこと', async ({
		request,
	}) => {
		const response = await request.get('/llms.txt');
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('text/plain');
		const body = await response.text();
		expect(body).toContain('# tools.codelife.cafe');
		expect(body).toContain('## Tools');
		expect(body).toContain('消費税・税込計算');
	});

	test('GET /llms-full.txt が 200 OK で text/plain を返し、詳細リファレンスを含むこと', async ({
		request,
	}) => {
		const response = await request.get('/llms-full.txt');
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('text/plain');
		const body = await response.text();
		expect(body).toContain('# tools.codelife.cafe — Full Reference');
		expect(body).toContain('ハッシュ値計算');
		expect(body).toContain('用途:');
	});

	test('ツールページ（/hash, /tax）に schema.org JSON-LD script が存在すること', async ({
		page,
	}) => {
		for (const path of ['/hash', '/tax']) {
			await page.goto(path);
			const jsonLdScripts = page.locator('script[type="application/ld+json"]');
			const count = await jsonLdScripts.count();
			expect(count).toBeGreaterThan(0);

			let foundSoftwareApp = false;
			for (let i = 0; i < count; i++) {
				const content = await jsonLdScripts.nth(i).textContent();
				if (content?.includes('SoftwareApplication')) {
					foundSoftwareApp = true;
					break;
				}
			}
			expect(foundSoftwareApp).toBe(true);
		}
	});
});
