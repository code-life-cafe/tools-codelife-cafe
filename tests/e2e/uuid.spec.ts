import { expect, test } from './fixtures/base';

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test.describe('UUID / ULID 生成ツール', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('uuid');
		await toolPage.goto();
		await toolPage.expectTitle('UUID / ULID 生成ツール');
		await toolPage.expectSafetyBadge();
	});

	test('初期表示でUUID v4が10件自動生成されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('uuid');
		await toolPage.goto();

		const list = page.getByTestId('id-result-list');
		await expect(list.locator('li')).toHaveCount(10);
		const firstText = await list
			.locator('li')
			.first()
			.locator('span')
			.first()
			.textContent();
		expect(firstText?.trim()).toMatch(UUID_RE);
	});

	test('種類をULIDに切り替えて生成すると26文字のCrockford Base32になること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('uuid');
		await toolPage.goto();

		await page.getByLabel('種類').click();
		await page.getByRole('option', { name: 'ULID' }).click();
		await page.getByRole('button', { name: '生成する' }).click();

		const list = page.getByTestId('id-result-list');
		await expect(list.locator('li')).toHaveCount(10);
		const text = await list
			.locator('li')
			.first()
			.locator('span')
			.first()
			.textContent();
		expect(text?.trim()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	});

	test('件数エラー: 0件や1001件は日本語エラーを表示し生成を無効化する', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('uuid');
		await toolPage.goto();

		const countInput = page.getByLabel(/生成件数/);
		await countInput.fill('0');
		await expect(page.getByRole('alert')).toContainText(
			'1〜1000件の範囲で指定してください',
		);
		await expect(page.getByRole('button', { name: '生成する' })).toBeDisabled();

		await countInput.fill('1001');
		await expect(page.getByRole('alert')).toContainText(
			'1〜1000件の範囲で指定してください',
		);
	});

	test('UUIDの大文字表示・ハイフンなし表示が切り替わること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('uuid');
		await toolPage.goto();

		const list = page.getByTestId('id-result-list');
		await expect(list.locator('li')).toHaveCount(10);

		await page.getByRole('switch', { name: '大文字で表示' }).click();
		const upperText = await list
			.locator('li')
			.first()
			.locator('span')
			.first()
			.textContent();
		expect(upperText?.trim()).toMatch(/^[0-9A-F-]+$/);

		await page.getByRole('switch', { name: 'ハイフンあり' }).click();
		const noHyphenText = await list
			.locator('li')
			.first()
			.locator('span')
			.first()
			.textContent();
		expect(noHyphenText?.trim()).not.toContain('-');
	});

	test('1件コピーと全件コピーが動作すること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('uuid');
		await toolPage.goto();

		const list = page.getByTestId('id-result-list');
		await expect(list.locator('li')).toHaveCount(10);

		await list
			.locator('li')
			.first()
			.getByRole('button', { name: /コピー/ })
			.click();
		await expect(list.locator('li').first().getByRole('button')).toContainText(
			'コピー済み',
		);

		await page.getByTestId('id-copy-all').getByRole('button').click();
		await expect(page.getByTestId('id-copy-all')).toContainText('コピー済み');
	});

	test('1000件生成できること', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('uuid');
		await toolPage.goto();

		await page.getByLabel(/生成件数/).fill('1000');
		await page.getByRole('button', { name: '生成する' }).click();
		await expect(page.getByText('生成結果（1000件）')).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId('id-result-list').locator('li')).toHaveCount(
			1000,
		);
	});

	test('判定・解析タブでUUID v7の種類と時刻が表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('uuid');
		await toolPage.goto();

		await page.getByRole('tab', { name: '判定・解析' }).click();
		// UUID v7 の既知サンプル（2024-01-15T00:00:00.000Z 相当のタイムスタンプ部を含む）
		await page
			.getByLabel('判定するUUID / ULIDを入力')
			.fill('018cd4b1-a800-7000-8000-000000000000');

		await expect(page.getByTestId('id-analyze-kind')).toContainText('UUID v7');
		await expect(page.getByTestId('id-analyze-timestamp')).toBeVisible();
	});

	test('判定・解析タブで無効な文字列は「不明」と表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('uuid');
		await toolPage.goto();

		await page.getByRole('tab', { name: '判定・解析' }).click();
		await page.getByLabel('判定するUUID / ULIDを入力').fill('not-a-valid-id');

		await expect(page.getByTestId('id-analyze-kind')).toContainText('不明');
	});

	test('判定・解析タブでULIDの時刻が抽出されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('uuid');
		await toolPage.goto();

		await page.getByRole('tab', { name: '判定・解析' }).click();
		await page
			.getByLabel('判定するUUID / ULIDを入力')
			.fill('01ARZ3NDEKTSV4RRFFQ69G5FAV');

		await expect(page.getByTestId('id-analyze-kind')).toContainText('ULID');
		await expect(page.getByTestId('id-analyze-timestamp')).toContainText(
			'2016-07-30',
		);
	});

	test('レスポンシブ表示（375px / 1440px）', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('uuid');
		await toolPage.goto();

		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByLabel('種類')).toBeVisible();
		await expect(page.getByRole('button', { name: '生成する' })).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByLabel('種類')).toBeVisible();
	});
});
