import { expect, test } from './fixtures/base';

test.describe('旧 image-crop リダイレクト検証 (/image-crop)', () => {
	test('GET /image-crop リクエスト検証', async ({ request, page }) => {
		// Astro / Cloudflare のリダイレクト設定またはレスポンスを検証
		const res = await request.get('/image-crop', { maxRedirects: 0 });
		expect([200, 301, 302, 308]).toContain(res.status());
	});
});
