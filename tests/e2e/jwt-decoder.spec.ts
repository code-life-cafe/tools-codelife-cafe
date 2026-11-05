import { expect, test } from './fixtures/base';

const SAMPLE_JWT =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoi5bGx55Sw5aSq6YOOIiwicm9sZSI6IueuoeeQhuiAhSJ9.signature';
const HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
const UNSIGNED_JWT =
	'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJuYW1lIjoi5bGx55Sw5aSq6YOOIiwicm9sZSI6IueuoeeQhuiAhSJ9.';

test.describe('JWT Decoder Tool', () => {
	test('headerまたはpayloadが配列のJSONなら日本語エラーを表示する（#623）', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('jwt-decoder').goto();
		for (const token of ['W10.W10.', 'W10.e30.', 'e30.W10.']) {
			await page.getByLabel('JWT').fill(token);
			await expect(page.getByText('デコードできません')).toBeVisible();
			await expect(
				page.getByText('デコードエラー: JSONオブジェクトではありません。', {
					exact: true,
				}),
			).toBeVisible();
		}
		await page.getByLabel('JWT').fill(SAMPLE_JWT);
		await expect(page.getByText('デコードできません')).toHaveCount(0);
		await expect(page.getByText('"name": "山田太郎"')).toBeVisible();
	});

	test('should decode JWT header and payload locally', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('jwt-decoder');
		await toolPage.goto();
		await toolPage.expectTitle('JWTデコーダー | CODE:LIFE Tools');
		await toolPage.expectSafetyBadge();

		await page.getByLabel('JWT').fill(SAMPLE_JWT);

		await expect(page.getByText('"alg": "HS256"')).toBeVisible();
		await expect(page.getByText('"name": "山田太郎"')).toBeVisible();
		await expect(page.getByText('signature', { exact: true })).toBeVisible();
	});

	test('should allow JWTs with alg none and an empty signature', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('jwt-decoder');
		await toolPage.goto();

		await page.getByLabel('JWT').fill(UNSIGNED_JWT);

		await expect(page.getByText('デコードできません')).toHaveCount(0);
		await expect(page.getByText('"alg": "none"')).toBeVisible();
		await expect(page.getByText('"name": "山田太郎"')).toBeVisible();
	});

	test('should show validation error for invalid token shape', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('jwt-decoder');
		await toolPage.goto();

		await page.getByLabel('JWT').fill('invalid-token');

		await expect(page.getByText('デコードできません')).toBeVisible();
		await expect(page.getByText('3つの部分で構成')).toBeVisible();
	});

	test('should still decode when nbf is outside the valid Date range', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('jwt-decoder');
		await toolPage.goto();

		const payload = Buffer.from(
			JSON.stringify({ name: '山田太郎', nbf: 1e13 }),
		).toString('base64url');
		await page.getByLabel('JWT').fill(`${HEADER}.${payload}.signature`);

		await expect(page.getByText('デコードできません')).toHaveCount(0);
		await expect(page.getByText('"name": "山田太郎"')).toBeVisible();
		await expect(page.getByText('日時に変換できません')).toBeVisible();
		await expect(page.getByText('Invalid time value')).toHaveCount(0);
	});
});
