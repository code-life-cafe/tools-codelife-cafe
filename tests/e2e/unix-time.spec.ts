import { expect, test } from './fixtures/base.ts';

test.describe('UNIXタイムスタンプ⇔日時変換ツール', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();
		await toolPage.expectTitle('UNIXタイムスタンプ⇔日時変換');
		await toolPage.expectSafetyBadge();
	});

	test('ハイドレーションエラーが発生せず現在のUNIX秒が数値で表示されること', async ({
		page,
		createToolPage,
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));

		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		const nowButton = page.getByRole('button', {
			name: '現在のUNIX秒をコピー',
		});
		await expect(nowButton).toHaveText(/^\d+$/);

		expect(errors).toEqual([]);
	});

	test('UNIX秒を入力するとリアルタイムにISO 8601/UNIXミリ秒が表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByLabel('タイムゾーン').click();
		await page.getByRole('option', { name: 'UTC' }).click();

		await page.getByLabel('タイムスタンプまたは日時').fill('1783385779');

		const result = page.getByTestId('unix-time-result');
		await expect(result).toContainText('2026-07-07T00:56:19Z');
		await expect(result).toContainText('1783385779000');
	});

	test('日時文字列からUNIX秒への逆変換ができること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByLabel('タイムゾーン').click();
		await page.getByRole('option', { name: 'UTC' }).click();

		await page
			.getByLabel('タイムスタンプまたは日時')
			.fill('2026-07-07T00:56:19Z');

		const result = page.getByTestId('unix-time-result');
		await expect(result).toContainText('1783385779');
	});

	test('Slack TS形式（秒.マイクロ秒）が自動判定されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByLabel('タイムゾーン').click();
		await page.getByRole('option', { name: 'UTC' }).click();

		await page.getByLabel('タイムスタンプまたは日時').fill('1355517523.000005');

		const result = page.getByTestId('unix-time-result');
		await expect(result).toContainText('2012-12-14T20:38:43.000005Z');
	});

	test('Discordタイムスタンプタグが出力されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByLabel('タイムスタンプまたは日時').fill('1783385779');

		const result = page.getByTestId('unix-time-result');
		await expect(result).toContainText('<t:1783385779:F>');
	});

	test('解釈できない入力では静かにメッセージが表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByLabel('タイムスタンプまたは日時').fill('not-a-timestamp');

		await expect(page.getByText('解釈できません')).toBeVisible();
	});

	test('ミリ秒を含むタイムスタンプでもタイムゾーンオフセットが正しいこと（#586）', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		// 既定のタイムゾーンは Asia/Tokyo
		await page.getByLabel('タイムスタンプまたは日時').fill('1700000000123');

		const result = page.getByTestId('unix-time-result');
		await expect(result).toContainText('2023-11-15T07:13:20.123+09:00');
		await expect(result).not.toContainText('+08:59');
	});

	test('範囲外の小数を入力してもUIが消えず、正常な値で復帰できること（#587）', async ({
		page,
		createToolPage,
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));

		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		const input = page.getByLabel('タイムスタンプまたは日時');
		await input.fill('99999999999999999999.1');
		await expect(page.getByText('解釈できません')).toBeVisible();
		await expect(input).toBeVisible();

		await input.fill('1783385779');
		await expect(page.getByTestId('unix-time-result')).toBeVisible();
		await expect(page.getByText('解釈できません')).toHaveCount(0);

		await page.getByRole('tab', { name: '一括変換' }).click();
		await page
			.getByLabel('一括入力（1行1値）')
			.fill('1783385779\n99999999999999999999.1');
		const table = page.getByTestId('unix-time-batch-result');
		await expect(table.locator('tbody tr')).toHaveCount(2);
		await expect(table.getByText('エラー')).toBeVisible();

		expect(errors).toEqual([]);
	});

	test('DSTの欠落時刻は結果を消してエラー表示し、有効な時刻で復帰する（#582）', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('unix-time').goto();
		await page.getByLabel('タイムゾーン').click();
		await page
			.getByRole('option', { name: 'America/New_York', exact: true })
			.click();

		const input = page.getByLabel('タイムスタンプまたは日時');
		const result = page.getByTestId('unix-time-result');
		await input.fill('2024-03-10 01:30:00');
		await expect(result).toContainText('2024-03-10T01:30:00-05:00');

		for (const value of ['2024-03-10 02:30:00', '2024/03/10 02:30:00']) {
			await input.fill(value);
			await expect(
				page.getByText('解釈できません', { exact: true }),
			).toBeVisible();
			await expect(result).toHaveCount(0);
		}

		await input.fill('2024-03-10 03:30:00');
		await expect(result).toContainText('2024-03-10T03:30:00-04:00');
		await expect(page.getByText('解釈できません', { exact: true })).toHaveCount(
			0,
		);

		for (const [value, isoUtc] of [
			['2024-11-03T01:30:00-04:00', '2024-11-03T05:30:00Z'],
			['2024-11-03T01:30:00-05:00', '2024-11-03T06:30:00Z'],
		]) {
			await input.fill(value);
			await expect(result).toContainText(isoUtc);
		}
	});

	test('一括変換ではDSTの欠落時刻の行だけエラーになる（#582）', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('unix-time').goto();
		await page.getByLabel('タイムゾーン').click();
		await page
			.getByRole('option', { name: 'America/New_York', exact: true })
			.click();
		await page.getByRole('tab', { name: '一括変換' }).click();
		await page
			.getByLabel('一括入力（1行1値）')
			.fill(
				[
					'2024-03-10 01:30:00',
					'2024-03-10 02:30:00',
					'2024/03/10 02:30:00',
					'2024-03-10 03:30:00',
				].join('\n'),
			);
		const rows = page.getByTestId('unix-time-batch-result').locator('tbody tr');
		await expect(rows).toHaveCount(4);
		await expect(rows.nth(0)).toContainText('2024-03-10T06:30:00Z');
		await expect(rows.nth(3)).toContainText('2024-03-10T07:30:00Z');
		for (const index of [1, 2]) {
			await expect(
				rows.nth(index).getByText('エラー', { exact: true }),
			).toBeVisible();
			await expect(rows.nth(index)).toContainText('解釈できません');
			await expect(rows.nth(index).getByRole('cell').nth(3)).toHaveText('-');
		}
	});

	test('現在時刻ボタンで入力欄に値が入り結果が表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByRole('button', { name: '現在時刻を入力欄へ' }).click();

		await expect(page.getByTestId('unix-time-result')).toBeVisible();
	});

	test('一括変換タブで複数行を変換できること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.getByRole('tab', { name: '一括変換' }).click();
		await page
			.getByLabel('一括入力（1行1値）')
			.fill('1783385779\n2026-07-07T00:56:19Z\ninvalid-line');

		const table = page.getByTestId('unix-time-batch-result');
		await expect(table).toBeVisible();
		await expect(table.getByText('エラー')).toBeVisible();
		await expect(table.locator('tbody tr')).toHaveCount(3);
	});

	test('レスポンシブ表示（375px / 1440px）', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unix-time');
		await toolPage.goto();

		await page.setViewportSize({ width: 375, height: 667 });
		await page.getByLabel('タイムスタンプまたは日時').fill('1783385779');
		await expect(page.getByTestId('unix-time-result')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByTestId('unix-time-result')).toBeVisible();
	});
});
