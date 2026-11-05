import { expect, test } from './fixtures/base.ts';

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test.describe('生成済みIDの種類と表示・コピー', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			let copied = '';
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: {
					writeText: async (text: string) => {
						copied = text;
					},
					readText: async () => copied,
				},
			});
			// 大小文字とハイフンを必ず含むnanoidに固定し、乱数による見逃しを防ぐ。
			const original = crypto.getRandomValues.bind(crypto);
			let sequence = 0;
			Object.defineProperty(crypto, 'getRandomValues', {
				configurable: true,
				value: (bytes: Uint8Array<ArrayBuffer>) => {
					if (!(bytes instanceof Uint8Array) || bytes.length !== 21) {
						return original(bytes);
					}
					const pattern = [10, 36, 62, 63, 0]; // Aa-_0
					for (let i = 0; i < bytes.length; i++) {
						bytes[i] = pattern[i % pattern.length];
					}
					bytes[20] = sequence++ % 10;
					return bytes;
				},
			});
		});
	});

	for (const uuidKind of ['UUID v4', 'UUID v7']) {
		test(`nanoidから${uuidKind}へ切り替えても保存済みオプションで変換されない`, async ({
			page,
			createToolPage,
		}) => {
			await page.addInitScript(() => {
				localStorage.setItem(
					'tool_settings_uuid',
					JSON.stringify({
						kind: 'nanoid',
						count: 2,
						uppercase: true,
						hyphens: false,
					}),
				);
			});
			await createToolPage('uuid').goto();
			const results = page.getByTestId('id-result-list').locator('li > span');
			const expected = ['Aa-_0Aa-_0Aa-_0Aa-_00', 'Aa-_0Aa-_0Aa-_0Aa-_01'];
			await expect(results).toHaveText(expected);
			await expect(page.getByLabel(/生成件数/)).toHaveValue('2');
			await page.getByLabel('種類', { exact: true }).click();
			await page.getByRole('option', { name: uuidKind, exact: true }).click();
			await expect(
				page.getByRole('switch', { name: '大文字で表示' }),
			).toBeChecked();
			await expect(
				page.getByRole('switch', { name: 'ハイフンあり' }),
			).not.toBeChecked();
			await expect(results).toHaveText(expected);
			await page
				.getByTestId('id-result-list')
				.locator('li')
				.first()
				.getByRole('button')
				.click();
			await expect
				.poll(() => page.evaluate(() => navigator.clipboard.readText()))
				.toBe(expected[0]);
			await page.getByTestId('id-copy-all').getByRole('button').click();
			await expect
				.poll(() => page.evaluate(() => navigator.clipboard.readText()))
				.toBe(expected.join('\n'));
			await page.getByRole('switch', { name: '大文字で表示' }).click();
			await expect(results).toHaveText(expected);
			await page.getByRole('switch', { name: 'ハイフンあり' }).click();
			await expect(results).toHaveText(expected);
			await page.getByLabel('種類', { exact: true }).click();
			await page.getByRole('option', { name: 'nanoid', exact: true }).click();
			await expect(results).toHaveText(expected);
		});
	}

	test('UUID結果は種類切替で表示・コピーが変わらず、再生成時に結果の種類が更新される', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('uuid').goto();
		const list = page.getByTestId('id-result-list');
		const results = list.locator('li > span');
		await expect(results).toHaveCount(10);
		await page.getByRole('switch', { name: '大文字で表示' }).click();
		await page.getByRole('switch', { name: 'ハイフンあり' }).click();
		await expect(results.first()).toHaveText(/^[0-9A-F]{32}$/);
		const expected = await results.allTextContents();
		await page.getByLabel('種類', { exact: true }).click();
		await page.getByRole('option', { name: 'nanoid', exact: true }).click();
		await expect(results).toHaveText(expected);
		await list.locator('li').first().getByRole('button').click();
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe(expected[0]);
		await page.getByTestId('id-copy-all').getByRole('button').click();
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe(expected.join('\n'));
		await page.getByLabel(/生成件数/).fill('2');
		await page.getByRole('button', { name: '生成する' }).click();
		await expect(results).toHaveText([
			'Aa-_0Aa-_0Aa-_0Aa-_00',
			'Aa-_0Aa-_0Aa-_0Aa-_01',
		]);
		await page.getByLabel('種類', { exact: true }).click();
		await page.getByRole('option', { name: 'UUID v4', exact: true }).click();
		await page.getByRole('button', { name: '生成する' }).click();
		await expect(results).toHaveCount(2);
		await expect(results.first()).toHaveText(/^[0-9A-F]{32}$/);
	});
});

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
